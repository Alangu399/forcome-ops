$ErrorActionPreference = 'Stop'

$distro = 'Forcome-Ubuntu'
$projectRoot = Split-Path -Parent $PSScriptRoot
$resolvedProjectRoot = (Resolve-Path $projectRoot).Path
$drive = $resolvedProjectRoot.Substring(0, 1).ToLowerInvariant()
$relativePath = $resolvedProjectRoot.Substring(2).Replace('\', '/')
$wslProjectRoot = "/mnt/$drive$relativePath"

& wsl.exe -d $distro -u root -- sh -lc "cd '$wslProjectRoot' && docker compose stop"
if ($LASTEXITCODE -ne 0) {
    throw 'Forcome monitoring stack failed to stop cleanly.'
}

& wsl.exe --terminate $distro
if ($LASTEXITCODE -ne 0) {
    throw 'Forcome-Ubuntu failed to terminate.'
}
