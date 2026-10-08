const viewTitles = {
  overview: "运行总览",
  hosts: "主机监控",
  alerts: "告警中心",
  thresholds: "阈值设置",
  services: "服务监控",
  ports: "端口监控",
  notifications: "通知渠道"
};

const state = {
  data: null,
  notificationStatus: null,
  serviceCatalog: null,
  serviceHostId: null,
  serviceSelection: new Set(),
  portCatalog: null,
  portHostId: null,
  view: "overview",
  loading: false
};
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function clampPercent(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(100, number)) : 0;
}

function formatPercent(value) {
  return Number.isFinite(Number(value)) ? `${Number(value).toFixed(1)}%` : "--";
}

function formatAge(timestamp) {
  const seconds = Math.max(0, Math.floor(Date.now() / 1000) - Number(timestamp || 0));
  if (!timestamp) return "从未上报";
  if (seconds < 60) return `${seconds} 秒前`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟前`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} 小时前`;
  return `${Math.floor(seconds / 86400)} 天前`;
}

function levelClass(value, threshold) {
  if (!Number.isFinite(Number(value))) return "";
  if (Number(value) >= Math.max(95, threshold + 10)) return "high";
  if (Number(value) >= threshold) return "warning";
  return "";
}

function metric(value, threshold) {
  const level = levelClass(value, threshold);
  return `<div class="metric-inline"><strong>${formatPercent(value)}</strong><div class="bar ${level}"><span style="width:${clampPercent(value)}%"></span></div></div>`;
}

function setView(view) {
  if (!viewTitles[view]) return;
  state.view = view;
  $$(".nav-item[data-view]").forEach((button) => button.classList.toggle("is-active", button.dataset.view === view));
  $$(".view").forEach((panel) => panel.classList.toggle("is-active", panel.dataset.viewPanel === view));
  $("#page-title").textContent = viewTitles[view];
  if (view === "notifications") loadNotificationStatus();
  if (view === "services") loadServiceCatalog();
  if (view === "ports") loadPortCatalog();
}

function formatDateTime(value) {
  if (!value) return "尚未发送";
  return new Date(value).toLocaleString("zh-CN", { hour12: false });
}

async function loadNotificationStatus() {
  try {
    const response = await fetch("/api/notifications/status", { cache: "no-store" });
    const status = await response.json();
    if (!response.ok) throw new Error(status.error || "读取失败");
    applyNotificationStatus(status);
  } catch (error) {
    $("#dingtalk-status").textContent = "读取失败";
    $("#dingtalk-result").textContent = error.message;
    $("#dingtalk-result").className = "result-error";
  }
}

function applyNotificationStatus(status) {
  state.notificationStatus = status;
  $("#dingtalk-status").textContent = status.enabled
    ? "已启用"
    : status.configured ? "未选择设备" : "未配置";
  $("#dingtalk-status").className = `channel-status ${status.enabled ? "is-enabled" : ""}`;
  $("#dingtalk-interval").textContent = `${status.checkIntervalSeconds} 秒`;
  $("#dingtalk-selected-count").textContent = `${status.selectedHostIds.length} 台`;
  $("#dingtalk-last-sent").textContent = formatDateTime(status.lastSentAt);
  $("#dingtalk-result").textContent = status.lastError
    ? `发送失败：${status.lastError}`
    : status.lastSentAt ? "发送成功" : "等待首次发送";
  $("#dingtalk-result").className = status.lastError ? "result-error" : "";
  $("#dingtalk-test-button").disabled = !status.configured;
  renderNotificationHosts(status.selectedHostIds);
}

function renderNotificationHosts(selectedHostIds) {
  const hosts = state.data?.hosts || [];
  const selected = new Set(selectedHostIds.map(String));
  $("#notification-host-list").innerHTML = hosts.length
    ? hosts.map((host) => `<label class="device-option">
        <input type="checkbox" name="notification-host" value="${escapeHtml(host.id)}" ${selected.has(String(host.id)) ? "checked" : ""}>
        <span><strong>${escapeHtml(host.name)}</strong><small>${escapeHtml(host.technicalName)} · ${host.online ? "在线" : "离线"}</small></span>
      </label>`).join("")
    : '<div class="empty-state">还没有可选择的设备</div>';
}

async function saveNotificationHosts(event) {
  event.preventDefault();
  const message = $("#notification-host-message");
  const selectedHostIds = $$('input[name="notification-host"]:checked').map((input) => input.value);
  message.textContent = "正在保存...";
  try {
    const response = await fetch("/api/notifications/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ selectedHostIds })
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "保存失败");
    applyNotificationStatus(body.status);
    message.textContent = selectedHostIds.length
      ? `已保存，将提醒 ${selectedHostIds.length} 台设备`
      : "已清空，不会发送自动提醒";
  } catch (error) {
    message.textContent = `保存失败：${error.message}`;
  }
  setTimeout(() => { message.textContent = ""; }, 4000);
}

function setAllNotificationHosts(checked) {
  $$('input[name="notification-host"]').forEach((input) => { input.checked = checked; });
}

async function loadServiceCatalog() {
  try {
    const response = await fetch("/api/services", { cache: "no-store" });
    const catalog = await response.json();
    if (!response.ok) throw new Error(catalog.error || "读取服务失败");
    state.serviceCatalog = catalog;
    const hosts = catalog.hosts || [];
    $("#service-host-select").innerHTML = hosts.length
      ? hosts.map((host) => `<option value="${escapeHtml(host.id)}">${escapeHtml(host.name)}</option>`).join("")
      : '<option value="">没有 Windows 主机</option>';
    const selectedHost = hosts.find((host) => host.id === state.serviceHostId) || hosts[0];
    state.serviceHostId = selectedHost?.id || null;
    if (state.serviceHostId) $("#service-host-select").value = state.serviceHostId;
    applyServiceHostSelection();
  } catch (error) {
    $("#service-list").innerHTML = `<div class="empty-state">读取服务失败：${escapeHtml(error.message)}</div>`;
  }
}

function currentServiceHost() {
  return state.serviceCatalog?.hosts?.find((host) => host.id === state.serviceHostId) || null;
}

function applyServiceHostSelection() {
  const host = currentServiceHost();
  state.serviceSelection = new Set(host?.monitoredServiceNames || []);
  $("#service-search").value = "";
  renderServiceList();
}

function renderServiceList() {
  const host = currentServiceHost();
  const query = $("#service-search").value.trim().toLocaleLowerCase("zh-CN");
  const services = (host?.services || []).filter((service) => (
    !query
    || service.name.toLocaleLowerCase().includes(query)
    || service.displayName.toLocaleLowerCase().includes(query)
  ));
  $("#service-selected-count").textContent = state.serviceSelection.size;
  $("#service-list").innerHTML = services.length
    ? services.map((service) => `<label class="service-option">
        <input type="checkbox" name="monitored-service" value="${escapeHtml(service.name)}" ${state.serviceSelection.has(service.name) ? "checked" : ""}>
        <span class="service-option-name"><strong>${escapeHtml(service.displayName)}</strong><small>${escapeHtml(service.name)}</small></span>
        <span class="service-state ${service.state === 0 ? "is-running" : "is-error"}">${escapeHtml(service.stateLabel)}</span>
      </label>`).join("")
    : '<div class="empty-state">没有匹配的服务</div>';
}

function setAllServices(selected) {
  const host = currentServiceHost();
  state.serviceSelection = selected
    ? new Set((host?.services || []).map((service) => service.name))
    : new Set();
  renderServiceList();
}

async function saveServiceSettings(event) {
  event.preventDefault();
  const message = $("#service-save-message");
  if (!state.serviceHostId) return;
  message.textContent = "正在保存...";
  try {
    const response = await fetch("/api/services/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        hostId: state.serviceHostId,
        serviceNames: [...state.serviceSelection]
      })
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "保存失败");
    const host = currentServiceHost();
    if (host) host.monitoredServiceNames = body.serviceNames;
    message.textContent = body.serviceNames.length
      ? `已监控 ${body.serviceNames.length} 个服务`
      : "已清空，不会产生服务告警";
    await refresh();
  } catch (error) {
    message.textContent = `保存失败：${error.message}`;
  }
  setTimeout(() => { message.textContent = ""; }, 4000);
}

async function loadPortCatalog() {
  try {
    const response = await fetch("/api/ports", { cache: "no-store" });
    const catalog = await response.json();
    if (!response.ok) throw new Error(catalog.error || "读取端口监控失败");
    state.portCatalog = catalog;
    const hosts = catalog.hosts || [];
    $("#port-host-select").innerHTML = hosts.length
      ? hosts.map((host) => "<option value=\"" + escapeHtml(host.id) + "\">" + escapeHtml(host.name) + "</option>").join("")
      : '<option value="">没有已接入主机</option>';
    const selected = hosts.find((host) => String(host.id) === String(state.portHostId))
      || hosts.find((host) => host.technicalName === "ALAN-NOTE")
      || hosts[0];
    state.portHostId = selected?.id || null;
    if (state.portHostId) $("#port-host-select").value = state.portHostId;
    renderPortList();
  } catch (error) {
    $("#port-list").innerHTML = '<div class="empty-state">读取失败：' + escapeHtml(error.message) + "</div>";
  }
}

function currentPortHost() {
  return state.portCatalog?.hosts?.find((host) => String(host.id) === String(state.portHostId)) || null;
}

function renderPortList() {
  const host = currentPortHost();
  const ports = host?.ports || [];
  $("#port-count").textContent = ports.length + " 个";
  $("#port-list").innerHTML = ports.length
    ? ports.map((monitor) => {
      const stateClass = monitor.state === 1 ? "is-running"
        : monitor.state === 0 ? "is-error" : "is-pending";
      return '<div class="port-row"><div><strong>TCP ' + escapeHtml(monitor.port) + '</strong>'
        + '<small>本机连接检查 · ' + escapeHtml(formatAge(monitor.lastSeen)) + '</small></div>'
        + '<span class="port-state ' + stateClass + '">' + escapeHtml(monitor.stateLabel) + '</span>'
        + '<button class="text-button port-remove" type="button" data-remove-port="' + escapeHtml(monitor.port) + '" aria-label="移除端口 ' + escapeHtml(monitor.port) + '" title="移除">移除</button></div>';
    }).join("")
    : '<div class="empty-state">这台主机还没有监控端口</div>';
}

async function updatePortSettings(ports, successMessage) {
  const message = $("#port-message");
  if (!state.portHostId) return;
  message.textContent = "正在保存...";
  try {
    const response = await fetch("/api/ports/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hostId: state.portHostId, ports })
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "保存失败");
    message.textContent = successMessage;
    message.className = "";
    await refresh();
    await loadPortCatalog();
  } catch (error) {
    message.textContent = "保存失败：" + error.message;
    message.className = "result-error";
  }
  setTimeout(() => {
    message.textContent = "";
    message.className = "";
  }, 5000);
}

async function addPortMonitor(event) {
  event.preventDefault();
  const host = currentPortHost();
  const portNumber = Number($("#port-number").value);
  if (!host || !Number.isInteger(portNumber) || portNumber < 1 || portNumber > 65535) return;
  const existing = (host.ports || []).map((monitor) => monitor.port);
  if (existing.includes(portNumber)) {
    $("#port-message").textContent = "这个端口已经在监控中";
    return;
  }
  await updatePortSettings([...existing, portNumber], "端口监控已添加");
}

async function removePortMonitor(portNumber) {
  const host = currentPortHost();
  if (!host) return;
  const ports = (host.ports || [])
    .map((monitor) => monitor.port)
    .filter((value) => value !== Number(portNumber));
  await updatePortSettings(ports, "端口监控已移除");
}

async function sendDingTalkTest() {
  const button = $("#dingtalk-test-button");
  const message = $("#dingtalk-test-message");
  button.disabled = true;
  message.textContent = "正在发送...";
  try {
    const response = await fetch("/api/notifications/test", { method: "POST" });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "发送失败");
    message.textContent = "测试通知已发送";
  } catch (error) {
    message.textContent = `发送失败：${error.message}`;
  } finally {
    await loadNotificationStatus();
    setTimeout(() => { message.textContent = ""; }, 4000);
  }
}

function renderTableRow(host, thresholds) {
  const highestDisk = host.metrics.disks.length
    ? host.metrics.disks.reduce((max, disk) => Math.max(max, disk.used), 0)
    : null;
  return `<tr>
    <td><span class="host-name">${escapeHtml(host.name)}</span><span class="host-tech">${escapeHtml(host.technicalName)}</span></td>
    <td><span class="status ${host.online ? "online" : ""}">${host.online ? "在线" : "离线"}</span></td>
    <td>${metric(host.metrics.cpu, thresholds.cpu)}</td>
    <td>${metric(host.metrics.memory, thresholds.memory)}</td>
    <td>${highestDisk !== null ? metric(highestDisk, thresholds.disk) : "--"}</td>
    <td>${escapeHtml(formatAge(host.lastSeen))}</td>
  </tr>`;
}

function renderAlerts(alerts, target) {
  const container = $(target);
  if (!alerts.length) {
    container.innerHTML = '<div class="empty-state">当前没有掉线、资源阈值、服务或端口告警</div>';
    return;
  }
  container.innerHTML = alerts.map((alert) => `<article class="alert-row ${alert.level === "high" ? "high" : ""}">
    <span class="alert-indicator"></span>
    <div><div class="alert-title">${escapeHtml(alert.title)}</div><div class="alert-host">${escapeHtml(alert.hostName)}</div></div>
    <div class="alert-detail">${escapeHtml(alert.detail)}</div>
    <div class="alert-value">${escapeHtml(alert.value)}</div>
  </article>`).join("");
}

function renderHostCard(host, thresholds) {
  const disks = host.metrics.disks.length
    ? host.metrics.disks.map((disk) => `<div class="host-metric"><span>${escapeHtml(disk.name)} 磁盘</span><div class="bar ${levelClass(disk.used, thresholds.disk)}"><span style="width:${clampPercent(disk.used)}%"></span></div><strong>${formatPercent(disk.used)}</strong></div>`).join("")
    : '<div class="empty-state">没有磁盘数据</div>';
  const services = host.services?.length
    ? `<div class="monitored-services"><div class="disk-title">重点服务</div>${host.services.map((service) => `<div class="monitored-service-row">
        <span>${escapeHtml(service.displayName)}</span>
        <strong class="service-state ${service.state === 0 ? "is-running" : "is-error"}">${escapeHtml(service.stateLabel)}</strong>
      </div>`).join("")}</div>`
    : "";
  return `<article class="host-card">
    <header class="host-card-head">
      <div><h3>${escapeHtml(host.name)}</h3><p>${escapeHtml(host.technicalName)} · ${escapeHtml(formatAge(host.lastSeen))}</p></div>
      <div class="host-card-actions">
        <span class="status ${host.online ? "online" : ""}">${host.online ? "在线" : "离线"}</span>
        <button class="delete-host-button" type="button" data-delete-host="${escapeHtml(host.id)}">删除</button>
      </div>
    </header>
    <div class="host-card-body">
      <div class="host-metric"><span>CPU</span><div class="bar ${levelClass(host.metrics.cpu, thresholds.cpu)}"><span style="width:${clampPercent(host.metrics.cpu)}%"></span></div><strong>${formatPercent(host.metrics.cpu)}</strong></div>
      <div class="host-metric"><span>内存</span><div class="bar ${levelClass(host.metrics.memory, thresholds.memory)}"><span style="width:${clampPercent(host.metrics.memory)}%"></span></div><strong>${formatPercent(host.metrics.memory)}</strong></div>
      <div class="disk-list"><div class="disk-title">磁盘使用率</div>${disks}</div>
      ${services}
    </div>
  </article>`;
}

function render(data) {
  state.data = data;
  const { summary, hosts, alerts, thresholds } = data;
  $("#summary-total").textContent = summary.total;
  $("#summary-online").textContent = summary.online;
  $("#summary-offline").textContent = summary.offline;
  $("#summary-alerts").textContent = summary.alerts;
  $("#nav-alert-count").textContent = summary.alerts;
  $("#last-updated").textContent = `更新于 ${new Date(data.generatedAt * 1000).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`;
  $("#connection-label").textContent = "监控服务正常";
  $("#connection-dot").className = "connection-dot is-online";

  $("#overview-hosts").innerHTML = hosts.length
    ? hosts.map((host) => renderTableRow(host, thresholds)).join("")
    : '<tr><td colspan="6" class="empty-cell">还没有接入主机</td></tr>';
  $("#host-grid").innerHTML = hosts.length
    ? hosts.map((host) => renderHostCard(host, thresholds)).join("")
    : '<div class="empty-state">还没有接入主机</div>';
  renderAlerts(alerts.slice(0, 5), "#overview-alerts");
  renderAlerts(alerts, "#all-alerts");

  $("#cpu-threshold").value = thresholds.cpu;
  $("#memory-threshold").value = thresholds.memory;
  $("#disk-threshold").value = thresholds.disk;
}

async function refresh() {
  if (state.loading) return;
  state.loading = true;
  $("#refresh-button").classList.add("is-loading");
  try {
    const response = await fetch("/api/overview", { cache: "no-store" });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "无法读取监控数据");
    render(body);
    $("#error-banner").hidden = true;
  } catch (error) {
    $("#error-banner").textContent = `监控数据读取失败：${error.message}`;
    $("#error-banner").hidden = false;
    $("#connection-label").textContent = "连接异常";
    $("#connection-dot").className = "connection-dot is-error";
  } finally {
    state.loading = false;
    $("#refresh-button").classList.remove("is-loading");
  }
}

async function saveThresholds(event) {
  event.preventDefault();
  const payload = {
    cpu: Number($("#cpu-threshold").value),
    memory: Number($("#memory-threshold").value),
    disk: Number($("#disk-threshold").value)
  };
  const response = await fetch("/api/thresholds", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const body = await response.json();
  if (!response.ok) {
    $("#threshold-message").textContent = body.error || "保存失败";
    return;
  }
  $("#threshold-message").textContent = "已保存";
  await refresh();
  setTimeout(() => { $("#threshold-message").textContent = ""; }, 2000);
}

async function deleteHost(hostId) {
  const host = state.data?.hosts.find((item) => String(item.id) === String(hostId));
  if (!host) return;
  if (!window.confirm(`确定删除主机“${host.name}”吗？\n\n删除后将停止监控和告警。`)) return;

  const button = document.querySelector(`[data-delete-host="${CSS.escape(String(hostId))}"]`);
  if (button) {
    button.disabled = true;
    button.textContent = "删除中";
  }

  try {
    const response = await fetch(`/api/hosts/${encodeURIComponent(hostId)}`, { method: "DELETE" });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "删除失败");
    await refresh();
    if (state.notificationStatus) await loadNotificationStatus();
  } catch (error) {
    $("#error-banner").textContent = `删除主机失败：${error.message}`;
    $("#error-banner").hidden = false;
    if (button) {
      button.disabled = false;
      button.textContent = "删除";
    }
  }
}

$$(".nav-item[data-view]").forEach((button) => button.addEventListener("click", () => setView(button.dataset.view)));
$$("[data-open-view]").forEach((button) => button.addEventListener("click", () => setView(button.dataset.openView)));
$("#refresh-button").addEventListener("click", refresh);
$("#threshold-form").addEventListener("submit", saveThresholds);
$("#dingtalk-test-button").addEventListener("click", sendDingTalkTest);
$("#notification-host-form").addEventListener("submit", saveNotificationHosts);
$("#select-all-hosts").addEventListener("click", () => setAllNotificationHosts(true));
$("#clear-all-hosts").addEventListener("click", () => setAllNotificationHosts(false));
$("#service-host-select").addEventListener("change", (event) => {
  state.serviceHostId = event.target.value;
  applyServiceHostSelection();
});
$("#service-search").addEventListener("input", renderServiceList);
$("#service-list").addEventListener("change", (event) => {
  if (!event.target.matches('input[name="monitored-service"]')) return;
  if (event.target.checked) state.serviceSelection.add(event.target.value);
  else state.serviceSelection.delete(event.target.value);
  $("#service-selected-count").textContent = state.serviceSelection.size;
});
$("#select-running-services").addEventListener("click", () => setAllServices(true));
$("#clear-services").addEventListener("click", () => setAllServices(false));
$("#service-monitor-form").addEventListener("submit", saveServiceSettings);
$("#port-host-select").addEventListener("change", (event) => {
  state.portHostId = event.target.value;
  renderPortList();
});
$("#port-add-form").addEventListener("submit", addPortMonitor);
$("#port-list").addEventListener("click", (event) => {
  const button = event.target.closest("[data-remove-port]");
  if (button) removePortMonitor(button.dataset.removePort);
});
$("#host-grid").addEventListener("click", (event) => {
  const button = event.target.closest("[data-delete-host]");
  if (button) deleteHost(button.dataset.deleteHost);
});

refresh();
setInterval(refresh, 30000);
