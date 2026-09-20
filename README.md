# Forcome Server Operations

This directory is the deployment and automation layer for Forcome infrastructure.
The adjacent `zabbix-master` directory is treated as read-only upstream reference
source and must not contain environment-specific configuration or secrets.

## Current decision

- Use Zabbix as the monitoring, discovery, alerting, and event source.
- Use active Zabbix Agent 2 checks for Linux and Windows wherever possible.
- Use Ansible with Semaphore for approved remediation and batch operations.
- Keep human SSH and RDP access separate from automated remediation.
- Store no passwords, API tokens, TLS private keys, or PSKs in this repository.

## Version warning

The local source snapshot is not a production release package. Its
`publiccode.yml` identifies 7.4.14, while `include/version.h` identifies
8.0.0rc1 and the active Linux and Windows templates require Agent 8.0 or newer.
Do not build or deploy this snapshot directly.

For production, use a single supported Zabbix release line for the server,
web frontend, database schema, Agent 2 packages, and imported templates. The
initial recommendation is the current Zabbix LTS release unless Forcome has a
tested reason to use a standard or release-candidate branch.

## Target flow

```text
Linux / Windows Agent 2 -> Zabbix Server -> alerting
                               |
                               +-> approved webhook -> Semaphore -> SSH / WinRM
```

Automatic remediation must be allow-listed by event tag and severity. The
first implementation will notify an operator and require approval. Fully
automatic repair is enabled only for idempotent, tested actions with rollback.

## Delivery phases

1. Record sites, hosts, operating systems, roles, network zones, and ownership.
2. Select the supported Zabbix release and deploy PostgreSQL, server, and web UI.
3. Enroll a non-production Linux host and Windows host with encrypted active checks.
4. Define host groups, tags, templates, severity policy, and alert routing.
5. Add Semaphore inventories and read-only health-check playbooks.
6. Connect selected Zabbix events to approved remediation templates.
7. Add backup, restore testing, audit retention, and upgrade runbooks.

Start by copying the structure of `inventory/hosts.example.yml` into the private
inventory source used for the real environment. Do not place credentials in it.

## Prepared deployment files

- `compose.yaml`: PostgreSQL, Zabbix server, and Zabbix web frontend.
- `.env.example`: non-secret deployment settings and bind addresses.
- `docs/host-onboarding.md`: manual Linux and Windows frontend enrollment.
- `docs/notifications.md`: email and DingTalk notification design.
- `docker/daemon.json`: test-environment Docker Hub mirror and log rotation.
- `scripts/Start-ForcomeTest.ps1`: start WSL, Docker, and the test stack.
- `scripts/Get-ForcomeTestStatus.ps1`: show containers and test the Web UI.
- `scripts/Stop-ForcomeTest.ps1`: stop the test stack without deleting data.
- `docs/local-test-environment.md`: machine-specific test environment notes.
- `console/`: the focused Forcome Ops web interface backed by the Zabbix API.

The web frontend binds to `127.0.0.1:8080` by default. Change the bind address
only after the target server address and HTTPS approach are known.

The Forcome Ops console binds to `127.0.0.1:8090`. Its first release exposes
only host availability, offline alerts, CPU, memory, disk usage, and configurable
resource thresholds. Reserved navigation entries remain disabled until their
features are implemented.
