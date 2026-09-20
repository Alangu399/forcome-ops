param(
    [string]$Distro = 'Forcome-Ubuntu',
    [string]$ListenAddress = '192.168.16.70',
    [int]$Port = 10051
)

$ErrorActionPreference = 'Stop'

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Run this script as Administrator.'
}

$wslAddresses = (& wsl.exe -d $Distro -u root -- hostname -I).Trim()
$wslAddress = ($wslAddresses -split '\s+')[0]
if ($wslAddress -notmatch '^\d{1,3}(\.\d{1,3}){3}$') {
    throw "Unable to determine the $Distro IPv4 address."
}

Set-Service -Name iphlpsvc -StartupType Automatic
Start-Service -Name iphlpsvc

& netsh interface portproxy delete v4tov4 listenaddress=$ListenAddress listenport=$Port | Out-Null
& netsh interface portproxy add v4tov4 `
    listenaddress=$ListenAddress `
    listenport=$Port `
    connectaddress=$wslAddress `
    connectport=$Port | Out-Null
if ($LASTEXITCODE -ne 0) {
    throw 'Unable to configure the Windows port proxy.'
}

$firewallRuleName = 'Forcome Zabbix Server 10051'
Get-NetFirewallRule -DisplayName $firewallRuleName -ErrorAction SilentlyContinue |
    Remove-NetFirewallRule
New-NetFirewallRule `
    -DisplayName $firewallRuleName `
    -Direction Inbound `
    -Action Allow `
    -Enabled True `
    -Profile Private `
    -Protocol TCP `
    -LocalAddress $ListenAddress `
    -LocalPort $Port `
    -RemoteAddress LocalSubnet | Out-Null

$test = Test-NetConnection -ComputerName $ListenAddress -Port $Port -WarningAction SilentlyContinue
if (-not $test.TcpTestSucceeded) {
    throw "Port proxy verification failed for ${ListenAddress}:$Port."
}

Write-Host "Forcome Agent endpoint: ${ListenAddress}:$Port"
Write-Host "WSL destination: ${wslAddress}:$Port"
Write-Host 'Firewall scope: Private profile, local subnet only'
