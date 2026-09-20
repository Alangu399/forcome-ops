# Local Test Environment

## Host

- Windows computer: `ALAN-NOTE`
- Operating system: Windows 10 Pro 22H2, build 19045
- CPU: Intel Core i5-1135G7, 8 logical processors
- Memory: 15.7 GB
- LAN address observed during setup: `192.168.16.70/22`
- WSL distribution: `Forcome-Ubuntu`
- Ubuntu version: 24.04.5 LTS
- WSL data location: `E:\WSL\Forcome-Ubuntu`

## Services

- Zabbix: 7.0.30
- PostgreSQL: 16
- Forcome Ops URL: `http://127.0.0.1:8090`
- Zabbix administration URL: `http://127.0.0.1:8080`
- Agent active-check port: `127.0.0.1:10051`
- Database port is not published to Windows.

The Forcome Ops console is the daily operations interface. Its initial scope is
host online status, offline alerts, CPU, memory, disk usage, and configurable
resource thresholds. The Zabbix frontend remains available for administrator
configuration and template maintenance.

## Windows test agent

- Agent: Zabbix Agent 2 7.0.30, installed as the automatic Windows service
  `Zabbix Agent 2`.
- Technical host name: `ALAN-NOTE`
- Visible name: `ALAN-NOTE (Windows test)`
- Active server: `127.0.0.1:10051`
- Host groups: `Forcome/Windows 11` and `Forcome/Test`
- Template: `Windows by Zabbix agent active`
- Tags: `environment=test`, `site=local`, `role=workstation`,
  `owner=forcome-ops`, and `automation=notify-only`

## Validation record

Validated on 2026-09-18:

- PostgreSQL and the Zabbix web container were healthy; the Zabbix server
  container was running.
- The web health check returned HTTP 200.
- The Windows service was running with automatic startup.
- The standard groups `Forcome/Linux`, `Forcome/Windows Server`,
  `Forcome/Windows 11`, `Forcome/Production`, and `Forcome/Test` were created.
- The agent log changed from `host [ALAN-NOTE] not found` to
  `active checks on server are active again` after frontend enrollment.
- Zabbix created 76 items, 31 triggers, 14 graphs, and 4 discovery rules for
  the Windows test host. Latest data included CPU metrics, and filesystem and
  network discovery completed.
- Trigger evaluation produced four test-host problems: low free space on
  `C:`, high memory utilization, and two automatic Windows services that were
  not running. These are left visible for notification-channel testing.
- The unused built-in `Zabbix server` host was disabled because this Compose
  deployment does not run an agent at its configured `127.0.0.1:10050`.

The web interface is intentionally limited to Windows localhost and uses HTTP.
Do not expose this test instance to the LAN or Internet.

## Lifecycle

Run `scripts/Start-ForcomeTest.ps1` after a Windows restart. It starts a hidden
WSL keepalive process, Docker, and the Compose stack. Run
`scripts/Get-ForcomeTestStatus.ps1` to verify status. Run
`scripts/Stop-ForcomeTest.ps1` to stop the containers and WSL while retaining
the database volume.

The initial Zabbix web login uses the vendor default credentials. Change the
administrator password through the local web interface before adding real
systems. Do not record the new password in this repository.
