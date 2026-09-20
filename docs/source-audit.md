# Local Zabbix Source Audit

Audit date: 2026-09-18

## Findings

- The workspace contains a full upstream source snapshot, not a configured deployment.
- There is no Docker Compose file, environment file, Forcome inventory, or deployment runbook.
- The source implements the JSON-RPC API, audit logging, host auto-registration,
  configuration import/export, scripts, actions, and webhook media types.
- Official active-check templates exist for Linux and Windows.
- The bundled Event-Driven Ansible media type is disabled by default and sends
  trigger and host context to an HTTPS endpoint.
- The template tree covers applications, databases, network equipment, operating
  systems, storage, servers, power equipment, telephony, and alert integrations.

## Version inconsistency

- `zabbix-master/publiccode.yml`: Zabbix 7.4.14.
- `zabbix-master/include/version.h`: Zabbix 8.0.0rc1.
- Active Linux and Windows templates: export version 8.0 and Agent 8.0 minimum.

This snapshot is useful for studying capabilities and template implementation,
but it must not be used as the source of production binaries or templates until
all components are pinned to one supported release.

## Automation boundary

Zabbix should detect and classify an incident. Semaphore/Ansible should execute
the change. High-risk operations such as rebooting, firewall changes, database
recovery, account changes, and destructive cleanup require explicit approval.

