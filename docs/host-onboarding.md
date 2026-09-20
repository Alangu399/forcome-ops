# Host Onboarding Through the Zabbix Web UI

The first rollout uses manual host creation in the Zabbix frontend. Agents use
active checks, so each monitored host initiates its connection to TCP 10051.

## Naming and grouping

Use the operating-system hostname as the Zabbix technical host name. Use a
readable display name only in the visible-name field.

Create these host groups before onboarding:

- `Forcome/Linux`
- `Forcome/Windows Server`
- `Forcome/Windows 11`
- `Forcome/Production`
- `Forcome/Test`

Apply these tags to every host:

- `environment`: `production`, `test`, or `development`
- `site`: site identifier
- `role`: `application`, `database`, `web`, `file`, or another stable role
- `owner`: responsible team
- `automation`: initially `notify-only`

## Linux host

1. Install the Zabbix Agent 2 package from the same supported release line as the server.
2. Set `ServerActive` to the Zabbix server's internal address and port 10051.
3. Set `Hostname` to exactly the same value used in the Zabbix frontend.
4. Configure PSK encryption before production enrollment.
5. In the frontend, open **Data collection > Hosts > Create host**.
6. Add the Linux, environment, and role groups and the standard tags.
7. Link `Linux by Zabbix agent active` from the server's own 7.0 template set.
8. Start the agent and confirm that active-check data arrives.

## Windows host

For the current LAN test environment, download
`Forcome-Windows-Agent-Setup.exe` from the Forcome Ops **主机** page and run it
as administrator on the target computer. It embeds the tested Zabbix Agent 2
7.0.30 package and configures active checks to `192.168.16.70:10051`.

The installer detects Windows Server versus a workstation, uses the Windows
computer name as the Zabbix host name, and sends one of these metadata values:

- `Forcome-Windows-Workstation`
- `Forcome-Windows-Server`

The matching Zabbix autoregistration action adds the host, places it in
`Forcome/Windows 11` or `Forcome/Windows Server`, and links
`Windows by Zabbix agent active`. Allow one or two minutes for initial data.

This test package uses unencrypted active checks inside the trusted LAN. Before
production rollout, issue per-host PSKs and sign the installer executable.

## Acceptance checks

- Agent availability and latest data are visible.
- CPU, memory, filesystem, network, process, and uptime values are populated.
- A controlled test trigger reaches both configured notification channels.
- Recovery notifications are delivered after the test condition clears.
- The host has an owner, environment, site, role, and automation policy tag.

Never import the 8.0 templates from `zabbix-master` into a 7.0 server.
