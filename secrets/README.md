# Runtime secrets

Before starting the stack, create a file named `postgres_password` in this
directory. It must contain a unique, randomly generated database password and
must not be committed.

Do not store SMTP passwords, DingTalk webhook URLs, Zabbix API tokens, Agent 2
PSKs, SSH private keys, or WinRM credentials in tracked files. Configure them
through the relevant product secret store or protected runtime files.
