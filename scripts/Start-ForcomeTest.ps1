$ErrorActionPreference = 'Stop'

$distro = 'Forcome-Ubuntu'
$projectRoot = Split-Path -Parent $PSScriptRoot
$resolvedProjectRoot = (Resolve-Path $projectRoot).Path
$drive = $resolvedProjectRoot.Substring(0, 1).ToLowerInvariant()
$relativePath = $resolvedProjectRoot.Substring(2).Replace('\', '/')
$wslProjectRoot = "/mnt/$drive$relativePath"

$keepalive = Get-CimInstance Win32_Process -Filter "Name = 'wsl.exe'" |
    Where-Object { $_.CommandLine -like "*${distro}*sleep*infinity*" }

if (-not $keepalive) {
    Start-Process `
        -FilePath "$env:WINDIR\System32\wsl.exe" `
        -ArgumentList '-d', $distro, '--exec', '/usr/bin/sleep', 'infinity' `
        -WindowStyle Hidden
    Start-Sleep -Seconds 3
}

& wsl.exe -d $distro -u root -- systemctl start docker
if ($LASTEXITCODE -ne 0) {
    throw 'Docker failed to start in Forcome-Ubuntu.'
}

& wsl.exe -d $distro -u root -- sh -lc "cd '$wslProjectRoot' && docker compose up -d && docker compose ps"
if ($LASTEXITCODE -ne 0) {
    throw 'Forcome monitoring stack failed to start.'
}

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if ($principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    & (Join-Path $PSScriptRoot 'Enable-ForcomeLanAccess.ps1')
}
else {
    Write-Warning 'Run this startup script as Administrator if the WSL network address changed.'
}

Write-Host 'Forcome Ops: http://127.0.0.1:8090'
Write-Host 'Zabbix administration: http://127.0.0.1:8080'
