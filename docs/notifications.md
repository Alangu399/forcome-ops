# Email and DingTalk Notifications

## TCP port monitoring

Open 端口监控, choose a host, and add the port to check. Forcome Ops creates
a Zabbix Agent active item that connects to 127.0.0.1 on that host every 30
seconds. A failed connection is a high-severity alert; the alert clears after
the port becomes reachable again. The selected host must also be enabled under
通知渠道 > 选择提醒设备 for DingTalk delivery.

Port selections persist in the forcome-console-data volume. Removing a port
disables only the item created by Forcome Ops and keeps its existing history.
Items that already existed in Zabbix are reused and are not disabled when their
port monitoring selection is removed.

## Email

Configure email in **Alerts > Media types** using the built-in Email media type.
Prefer STARTTLS or TLS and a dedicated sender account. Add the media to an
operations user or user group, then create one action for problem notifications
and recovery notifications.

Required private values are the SMTP host, port, sender address, authentication
method, account name, and password or OAuth credentials. Keep these out of this
repository.

## DingTalk

Forcome Ops sends signed Markdown messages directly to a DingTalk group robot.
Store `DINGTALK_WEBHOOK_URL` and `DINGTALK_SECRET` only in the ignored `.env`
file. Neither value is returned by the API or rendered in the browser.

The webhook should send a Markdown payload containing at least:

- event status and severity
- host name and IP
- problem name and operational data
- event time and event ID
- a link back to the Zabbix problem page once HTTPS is configured

Use **通知渠道 > 发送测试通知** to verify delivery. The background check sends
each newly active alert once, then sends a recovery message when it clears. Its
state persists in the `forcome-console-data` volume so container restarts do not
repeat all active alerts.

Automatic notifications are opt-in per host. Select hosts under **通知渠道 >
选择提醒设备** and save the list. An empty list disables all automatic alerts;
removing a host stops its notifications silently without sending a recovery.

## Windows service monitoring

Open **服务监控**, select a Windows host, and check only the services that must
remain running. Services that are not checked never create service alerts.

When a checked service is stopped, paused, missing, or otherwise not in the
Windows `Running` state, Forcome Ops creates a high-severity alert. The alert is
shown in the console immediately. DingTalk receives it only when the same host
is also checked under **通知渠道 > 选择提醒设备**. A recovery message is sent when
the service returns to `Running`.

The service selection is stored per host in the `forcome-console-data` volume
and remains in place after a container restart. Removing a service from the
selection stops monitoring it silently, without sending a false recovery.
