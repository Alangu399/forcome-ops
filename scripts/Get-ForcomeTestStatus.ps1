$ErrorActionPreference = 'Stop'

$distro = 'Forcome-Ubuntu'
$projectRoot = Split-Path -Parent $PSScriptRoot
$resolvedProjectRoot = (Resolve-Path $projectRoot).Path
$drive = $resolvedProjectRoot.Substring(0, 1).ToLowerInvariant()
$relativePath = $resolvedProjectRoot.Substring(2).Replace('\', '/')
$wslProjectRoot = "/mnt/$drive$relativePath"

& wsl.exe -d $distro -u root -- sh -lc "cd '$wslProjectRoot' && docker compose ps"
if ($LASTEXITCODE -ne 0) {
    throw 'Unable to read the Forcome monitoring stack status.'
}

try {
    $response = Invoke-WebRequest -Uri 'http://127.0.0.1:8080' -UseBasicParsing -TimeoutSec 10
    Write-Host "Zabbix web HTTP status: $($response.StatusCode)"
}
catch {
    Write-Warning "Zabbix web is not ready: $($_.Exception.Message)"
}

try {
    $response = Invoke-WebRequest -Uri 'http://127.0.0.1:8090/api/health' -UseBasicParsing -TimeoutSec 10
    Write-Host "Forcome Ops HTTP status: $($response.StatusCode)"
}
catch {
    Write-Warning "Forcome Ops is not ready: $($_.Exception.Message)"
}
