import { createServer } from "node:http";
import { createHmac } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = fileURLToPath(new URL(".", import.meta.url));
const publicDir = join(rootDir, "public");
const dataDir = process.env.DATA_DIR || join(rootDir, "data");
const thresholdFile = join(dataDir, "thresholds.json");
const notificationStateFile = join(dataDir, "notification-state.json");
const notificationSettingsFile = join(dataDir, "notification-settings.json");
const port = Number(process.env.PORT || 8080);
const apiUrl = process.env.ZABBIX_API_URL || "http://zabbix-web:8080/api_jsonrpc.php";
const apiUser = process.env.ZABBIX_API_USER || "";
const apiPassword = process.env.ZABBIX_API_PASSWORD || "";
const configuredToken = process.env.ZABBIX_API_TOKEN || "";
const dingTalkWebhookUrl = process.env.DINGTALK_WEBHOOK_URL || "";
const dingTalkSecret = process.env.DINGTALK_SECRET || "";
const onlineGraceSeconds = Number(process.env.ONLINE_GRACE_SECONDS || 180);
const alertCheckIntervalSeconds = Math.max(15, Number(process.env.ALERT_CHECK_INTERVAL_SECONDS || 30));
const defaults = Object.freeze({
  cpu: Number(process.env.CPU_WARNING_THRESHOLD || 80),
  memory: Number(process.env.MEMORY_WARNING_THRESHOLD || 90),
  disk: Number(process.env.DISK_WARNING_THRESHOLD || 80)
});

let requestId = 0;
let authToken = configuredToken;
let cache = { expiresAt: 0, value: null };
let notificationCheckRunning = false;
let notificationState = {
  initialized: false,
  active: {},
  lastSentAt: null,
  lastErrorAt: null,
  lastError: null
};
let notificationSettings = { selectedHostIds: [] };

function sendJson(response, status, payload) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });
  response.end(JSON.stringify(payload));
}

async function readJsonRequest(request) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 10240) throw new Error("Request body too large");
  }
  return JSON.parse(body || "{}");
}

async function rpc(method, params, auth = authToken) {
  const payload = { jsonrpc: "2.0", method, params, id: ++requestId };
  if (auth) payload.auth = auth;

  const response = await fetch(apiUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json-rpc" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(8000)
  });

  if (!response.ok) throw new Error(`Zabbix API HTTP ${response.status}`);
  const body = await response.json();
  if (body.error) throw new Error(body.error.data || body.error.message || "Zabbix API error");
  return body.result;
}

async function ensureAuth() {
  if (authToken) return authToken;
  if (!apiUser || !apiPassword) throw new Error("Zabbix API credentials are not configured");
  authToken = await rpc("user.login", { username: apiUser, password: apiPassword }, "");
  return authToken;
}

async function authenticatedRpc(method, params) {
  await ensureAuth();
  try {
    return await rpc(method, params);
  } catch (error) {
    if (configuredToken || !/session|auth|token/i.test(error.message)) throw error;
    authToken = "";
    await ensureAuth();
    return rpc(method, params);
  }
}

function normalizeThresholds(value) {
  const output = {};
  for (const key of ["cpu", "memory", "disk"]) {
    const number = Number(value?.[key]);
    output[key] = Number.isFinite(number) && number >= 1 && number <= 100
      ? Math.round(number)
      : defaults[key];
  }
  return output;
}

async function readThresholds() {
  try {
    return normalizeThresholds(JSON.parse(await readFile(thresholdFile, "utf8")));
  } catch {
    return normalizeThresholds(defaults);
  }
}

async function saveThresholds(value) {
  const thresholds = normalizeThresholds(value);
  await mkdir(dataDir, { recursive: true });
  await writeFile(thresholdFile, `${JSON.stringify(thresholds, null, 2)}\n`, "utf8");
  cache.expiresAt = 0;
  return thresholds;
}

async function readNotificationState() {
  try {
    const saved = JSON.parse(await readFile(notificationStateFile, "utf8"));
    return {
      ...notificationState,
      ...saved,
      active: saved?.active && typeof saved.active === "object" ? saved.active : {}
    };
  } catch {
    return notificationState;
  }
}

async function saveNotificationState(nextState) {
  notificationState = nextState;
  await mkdir(dataDir, { recursive: true });
  await writeFile(notificationStateFile, `${JSON.stringify(nextState, null, 2)}\n`, "utf8");
}

async function readNotificationSettings() {
  try {
    const saved = JSON.parse(await readFile(notificationSettingsFile, "utf8"));
    const selectedHostIds = Array.isArray(saved?.selectedHostIds)
      ? [...new Set(saved.selectedHostIds.map(String).filter((id) => /^\d+$/.test(id)))]
      : [];
    return { selectedHostIds };
  } catch {
    return { selectedHostIds: [] };
  }
}

async function saveNotificationSettings(value) {
  const nextHostIds = Array.isArray(value?.selectedHostIds)
    ? [...new Set(value.selectedHostIds.map(String).filter((id) => /^\d+$/.test(id)))]
    : [];
  const previousHostIds = new Set(notificationSettings.selectedHostIds);
  const retainedHostIds = new Set(nextHostIds.filter((id) => previousHostIds.has(id)));
  const retainedAlerts = Object.fromEntries(
    Object.entries(notificationState.active || {}).filter(([, alert]) => retainedHostIds.has(String(alert.hostId)))
  );

  notificationSettings = { selectedHostIds: nextHostIds };
  await mkdir(dataDir, { recursive: true });
  await writeFile(notificationSettingsFile, `${JSON.stringify(notificationSettings, null, 2)}\n`, "utf8");
  await saveNotificationState({ ...notificationState, active: retainedAlerts });
  return notificationSettings;
}

function notificationStatus() {
  const configured = Boolean(dingTalkWebhookUrl && dingTalkSecret);
  return {
    channel: "钉钉群机器人",
    configured,
    enabled: configured && notificationSettings.selectedHostIds.length > 0,
    selectedHostIds: notificationSettings.selectedHostIds,
    checkIntervalSeconds: alertCheckIntervalSeconds,
    lastSentAt: notificationState.lastSentAt,
    lastErrorAt: notificationState.lastErrorAt,
    lastError: notificationState.lastError
  };
}

function signedDingTalkUrl() {
  const timestamp = Date.now();
  const sign = createHmac("sha256", dingTalkSecret)
    .update(`${timestamp}\n${dingTalkSecret}`)
    .digest("base64");
  const url = new URL(dingTalkWebhookUrl);
  url.searchParams.set("timestamp", String(timestamp));
  url.searchParams.set("sign", sign);
  return url;
}

async function sendDingTalk(title, markdown) {
  if (!dingTalkWebhookUrl || !dingTalkSecret) throw new Error("钉钉机器人尚未配置");
  const response = await fetch(signedDingTalkUrl(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      msgtype: "markdown",
      markdown: { title, text: markdown },
      at: { isAtAll: false }
    }),
    signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) throw new Error(`钉钉接口 HTTP ${response.status}`);
  const result = await response.json();
  if (Number(result.errcode) !== 0) throw new Error(result.errmsg || `钉钉接口错误 ${result.errcode}`);
  return result;
}

function alertKey(alert) {
  return `${alert.hostId}:${alert.type}:${alert.title}`;
}

function formatAlertLine(alert) {
  return `- **${alert.hostName}** · ${alert.title} · ${alert.value}`;
}

async function sendAlertChanges() {
  if (!dingTalkWebhookUrl || !dingTalkSecret || notificationCheckRunning) return;
  notificationCheckRunning = true;
  try {
    const overview = await buildOverview();
    const selectedHostIds = new Set(notificationSettings.selectedHostIds);
    const current = Object.fromEntries(
      overview.alerts
        .filter((alert) => selectedHostIds.has(String(alert.hostId)))
        .map((alert) => [alertKey(alert), alert])
    );
    const previous = Object.fromEntries(
      Object.entries(notificationState.active || {})
        .filter(([, alert]) => selectedHostIds.has(String(alert.hostId)))
    );
    const added = Object.entries(current).filter(([key]) => !previous[key]).map(([, alert]) => alert);
    const resolved = Object.entries(previous).filter(([key]) => !current[key]).map(([, alert]) => alert);

    if (!added.length && !resolved.length) {
      if (!notificationState.initialized || Object.keys(notificationState.active || {}).length !== Object.keys(current).length) {
        await saveNotificationState({ ...notificationState, initialized: true, active: current });
      }
      return;
    }

    const lines = ["### Forcome Ops 监控通知", `> ${new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}`];
    if (added.length) lines.push("", `#### 新增告警（${added.length}）`, ...added.map(formatAlertLine));
    if (resolved.length) lines.push("", `#### 已恢复（${resolved.length}）`, ...resolved.map(formatAlertLine));
    lines.push("", `已选设备 ${selectedHostIds.size} 台，活动告警 ${Object.keys(current).length} 条。`);
    await sendDingTalk("Forcome Ops 监控通知", lines.join("\n"));
    await saveNotificationState({
      ...notificationState,
      initialized: true,
      active: current,
      lastSentAt: new Date().toISOString(),
      lastErrorAt: null,
      lastError: null
    });
  } catch (error) {
    console.error("DingTalk notification failed:", error.message);
    await saveNotificationState({
      ...notificationState,
      lastErrorAt: new Date().toISOString(),
      lastError: error.message || "钉钉通知发送失败"
    });
  } finally {
    notificationCheckRunning = false;
  }
}

function numberValue(item) {
  const number = Number(item?.lastvalue);
  return Number.isFinite(number) ? number : null;
}

function itemTimestamp(item) {
  const value = Number(item?.lastclock || 0);
  return Number.isFinite(value) ? value : 0;
}

function findItem(items, key) {
  return items.find((item) => item.key_ === key);
}

function mapHost(host, items, now, thresholds) {
  const heartbeat = findItem(items, "agent.ping")
    || findItem(items, "zabbix[host,active_agent,available]");
  const lastSeen = Math.max(0, ...items.map(itemTimestamp));
  const heartbeatTime = itemTimestamp(heartbeat) || lastSeen;
  const heartbeatOk = heartbeat ? String(heartbeat.lastvalue) === "1" : lastSeen > 0;
  const online = heartbeatOk && now - heartbeatTime <= onlineGraceSeconds;
  const cpu = numberValue(findItem(items, "system.cpu.util"));
  const memory = numberValue(findItem(items, "vm.memory.util"));
  const uptime = numberValue(findItem(items, "system.uptime"));
  const disks = items
    .filter((item) => /^vfs\.fs\.(?:dependent\.)?size\[[^,]+,pused\]$/.test(item.key_))
    .map((item) => ({
      name: item.key_.match(/\[([^,]+),pused\]/)?.[1] || item.name,
      used: numberValue(item),
      lastSeen: itemTimestamp(item)
    }))
    .filter((disk) => disk.used !== null)
    .sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));

  const alerts = [];
  if (!online) {
    alerts.push({
      type: "offline",
      level: "high",
      title: "主机掉线",
      detail: `${host.name} 已停止上报`,
      value: "离线"
    });
  }
  if (cpu !== null && cpu >= thresholds.cpu) {
    alerts.push({
      type: "cpu",
      level: cpu >= 95 ? "high" : "warning",
      title: "CPU 使用率过高",
      detail: `${host.name} 超过 ${thresholds.cpu}% 阈值`,
      value: `${cpu.toFixed(1)}%`
    });
  }
  if (memory !== null && memory >= thresholds.memory) {
    alerts.push({
      type: "memory",
      level: memory >= 95 ? "high" : "warning",
      title: "内存使用率过高",
      detail: `${host.name} 超过 ${thresholds.memory}% 阈值`,
      value: `${memory.toFixed(1)}%`
    });
  }
  for (const disk of disks) {
    if (disk.used < thresholds.disk) continue;
    alerts.push({
      type: "disk",
      level: disk.used >= 95 ? "high" : "warning",
      title: `${disk.name} 磁盘空间不足`,
      detail: `${host.name} 超过 ${thresholds.disk}% 阈值`,
      value: `${disk.used.toFixed(1)}%`
    });
  }

  return {
    id: host.hostid,
    name: host.name || host.host,
    technicalName: host.host,
    online,
    lastSeen: heartbeatTime || lastSeen,
    uptime,
    tags: host.tags || [],
    metrics: { cpu, memory, disks },
    alerts
  };
}

async function buildOverview() {
  const nowMs = Date.now();
  if (cache.value && cache.expiresAt > nowMs) return cache.value;

  const thresholds = await readThresholds();
  const hosts = await authenticatedRpc("host.get", {
    output: ["hostid", "host", "name", "status"],
    filter: { status: 0 },
    selectTags: ["tag", "value"]
  });
  const hostIds = hosts.map((host) => host.hostid);
  const items = hostIds.length
    ? await authenticatedRpc("item.get", {
        output: ["hostid", "name", "key_", "lastvalue", "lastclock", "units", "state"],
        hostids: hostIds,
        filter: { status: 0 }
      })
    : [];
  const itemsByHost = new Map();
  for (const item of items) {
    if (!itemsByHost.has(item.hostid)) itemsByHost.set(item.hostid, []);
    itemsByHost.get(item.hostid).push(item);
  }

  const now = Math.floor(nowMs / 1000);
  const mappedHosts = hosts
    .map((host) => mapHost(host, itemsByHost.get(host.hostid) || [], now, thresholds))
    .sort((a, b) => Number(a.online) - Number(b.online) || a.name.localeCompare(b.name, "zh-CN"));
  const alerts = mappedHosts.flatMap((host) => host.alerts.map((alert) => ({ ...alert, hostId: host.id, hostName: host.name })));
  const value = {
    generatedAt: now,
    thresholds,
    summary: {
      total: mappedHosts.length,
      online: mappedHosts.filter((host) => host.online).length,
      offline: mappedHosts.filter((host) => !host.online).length,
      alerts: alerts.length
    },
    hosts: mappedHosts,
    alerts
  };
  cache = { value, expiresAt: nowMs + 8000 };
  return value;
}

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml"
};

async function serveStatic(pathname, response) {
  const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const safeRelative = normalize(relative);
  if (safeRelative.startsWith("..")) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }
  try {
    const content = await readFile(join(publicDir, safeRelative));
    response.writeHead(200, {
      "Content-Type": mimeTypes[extname(safeRelative)] || "application/octet-stream",
      "Cache-Control": "no-cache",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; connect-src 'self'"
    });
    response.end(content);
  } catch {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
  }
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
    if (request.method === "GET" && url.pathname === "/api/health") {
      sendJson(response, 200, { ok: true });
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/overview") {
      sendJson(response, 200, await buildOverview());
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/notifications/status") {
      sendJson(response, 200, notificationStatus());
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/thresholds") {
      sendJson(response, 200, { thresholds: await saveThresholds(await readJsonRequest(request)) });
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/notifications/settings") {
      const body = await readJsonRequest(request);
      const validHostIds = new Set((await buildOverview()).hosts.map((host) => String(host.id)));
      const selectedHostIds = Array.isArray(body.selectedHostIds)
        ? body.selectedHostIds.map(String).filter((id) => validHostIds.has(id))
        : [];
      await saveNotificationSettings({ selectedHostIds });
      sendJson(response, 200, { ok: true, status: notificationStatus() });
      setTimeout(sendAlertChanges, 0);
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/notifications/test") {
      await sendDingTalk(
        "Forcome Ops 测试通知",
        `### Forcome Ops 钉钉通知测试\n> ${new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}\n\n钉钉机器人已经连接成功，后续将发送主机掉线和资源阈值告警。`
      );
      await saveNotificationState({
        ...notificationState,
        lastSentAt: new Date().toISOString(),
        lastErrorAt: null,
        lastError: null
      });
      sendJson(response, 200, { ok: true, status: notificationStatus() });
      return;
    }
    const deleteHostMatch = url.pathname.match(/^\/api\/hosts\/(\d+)$/);
    if (request.method === "DELETE" && deleteHostMatch) {
      const hostId = deleteHostMatch[1];
      const hosts = await authenticatedRpc("host.get", {
        output: ["hostid", "host", "name", "status"],
        hostids: [hostId]
      });
      const host = hosts[0];
      if (!host) {
        sendJson(response, 404, { error: "找不到这台主机" });
        return;
      }

      await authenticatedRpc("host.update", { hostid: hostId, status: 1 });
      await saveNotificationSettings({
        selectedHostIds: notificationSettings.selectedHostIds.filter((id) => id !== hostId)
      });
      cache = { expiresAt: 0, value: null };
      sendJson(response, 200, {
        ok: true,
        deletedHost: { id: hostId, name: host.name || host.host }
      });
      return;
    }
    if (request.method !== "GET") {
      sendJson(response, 405, { error: "Method not allowed" });
      return;
    }
    await serveStatic(decodeURIComponent(url.pathname), response);
  } catch (error) {
    sendJson(response, 502, { error: error.message || "Forcome Ops service error" });
  }
});

notificationState = await readNotificationState();
notificationSettings = await readNotificationSettings();

server.listen(port, "0.0.0.0", () => {
  console.log(`Forcome Ops listening on ${port}`);
  setTimeout(sendAlertChanges, 3000);
  setInterval(sendAlertChanges, alertCheckIntervalSeconds * 1000);
});
