# Email and DingTalk Notifications

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
