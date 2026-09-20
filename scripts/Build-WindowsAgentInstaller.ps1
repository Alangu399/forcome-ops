$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$compiler = 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$source = Join-Path $projectRoot 'installer\windows\ForcomeAgentSetup.cs'
$manifest = Join-Path $projectRoot 'installer\windows\ForcomeAgentSetup.manifest'
$agentMsi = Join-Path $projectRoot 'runtime\downloads\zabbix_agent2-7.0.30-windows-amd64-openssl.msi'
$outputDirectory = Join-Path $projectRoot 'console\public\downloads'
$output = Join-Path $outputDirectory 'Forcome-Windows-Agent-Setup.exe'

foreach ($requiredFile in @($compiler, $source, $manifest, $agentMsi)) {
    if (-not (Test-Path -LiteralPath $requiredFile -PathType Leaf)) {
        throw "Required file not found: $requiredFile"
    }
}

New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null

& $compiler `
    /nologo `
    /target:winexe `
    /platform:anycpu `
    /optimize+ `
    "/win32manifest:$manifest" `
    /reference:System.dll `
    /reference:System.Drawing.dll `
    /reference:System.Windows.Forms.dll `
    "/resource:$agentMsi,ForcomeAgent.msi" `
    "/out:$output" `
    $source

if ($LASTEXITCODE -ne 0) {
    throw 'Forcome Windows Agent installer compilation failed.'
}

$file = Get-Item -LiteralPath $output
$hash = Get-FileHash -LiteralPath $output -Algorithm SHA256
Write-Host "Installer: $($file.FullName)"
Write-Host "Size: $($file.Length) bytes"
Write-Host "SHA256: $($hash.Hash)"
