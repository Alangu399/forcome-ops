$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$environmentFile = Join-Path $projectRoot '.env'
$apiUrl = 'http://127.0.0.1:8080/api_jsonrpc.php'
$actionDefinitions = @(
    @{
        Name = 'Forcome Windows 工作站自动接入'
        Metadata = 'Forcome-Windows-Workstation'
        Group = 'Forcome/Windows 11'
    },
    @{
        Name = 'Forcome Windows Server 自动接入'
        Metadata = 'Forcome-Windows-Server'
        Group = 'Forcome/Windows Server'
    }
)

function Read-DotEnv {
    param([string]$Path)

    $values = @{}
    foreach ($line in Get-Content -LiteralPath $Path) {
        if ($line -match '^\s*#' -or $line -notmatch '=') { continue }
        $name, $value = $line -split '=', 2
        $values[$name.Trim()] = $value.Trim()
    }
    return $values
}

$script:requestId = 0
function Invoke-ZabbixRpc {
    param(
        [string]$Method,
        [object]$Params,
        [string]$AuthToken = ''
    )

    $script:requestId++
    $request = [ordered]@{
        jsonrpc = '2.0'
        method = $Method
        params = $Params
        id = $script:requestId
    }
    if ($AuthToken) { $request.auth = $AuthToken }

    $response = Invoke-RestMethod `
        -Uri $apiUrl `
        -Method Post `
        -ContentType 'application/json-rpc' `
        -Body ($request | ConvertTo-Json -Depth 12 -Compress) `
        -TimeoutSec 15

    if ($response.error) {
        throw "Zabbix API $Method failed: $($response.error.data)"
    }
    return $response.result
}

if (-not (Test-Path -LiteralPath $environmentFile -PathType Leaf)) {
    throw '.env was not found.'
}

$environment = Read-DotEnv -Path $environmentFile
$apiUser = $environment['ZABBIX_API_USER']
$apiPassword = $environment['ZABBIX_API_PASSWORD']
if (-not $apiUser -or -not $apiPassword) {
    throw 'Zabbix API credentials are not configured in .env.'
}

$authToken = Invoke-ZabbixRpc -Method 'user.login' -Params @{
    username = $apiUser
    password = $apiPassword
}

$template = @(Invoke-ZabbixRpc -Method 'template.get' -AuthToken $authToken -Params @{
    output = @('templateid', 'host', 'name')
    filter = @{ host = @('Windows by Zabbix agent active') }
}) | Select-Object -First 1
if (-not $template) {
    throw 'Template "Windows by Zabbix agent active" was not found.'
}

foreach ($definition in $actionDefinitions) {
    $group = @(Invoke-ZabbixRpc -Method 'hostgroup.get' -AuthToken $authToken -Params @{
        output = @('groupid', 'name')
        filter = @{ name = @($definition.Group) }
    }) | Select-Object -First 1

    if (-not $group) {
        $createdGroup = Invoke-ZabbixRpc -Method 'hostgroup.create' -AuthToken $authToken -Params @{
            name = $definition.Group
        }
        $group = [pscustomobject]@{ groupid = $createdGroup.groupids[0]; name = $definition.Group }
    }

    $existingAction = @(Invoke-ZabbixRpc -Method 'action.get' -AuthToken $authToken -Params @{
        output = @('actionid', 'name', 'status')
        eventsource = 2
        filter = @{ name = @($definition.Name) }
    }) | Select-Object -First 1

    if ($existingAction) {
        Write-Host "Already configured: $($definition.Name)"
        continue
    }

    $createdAction = Invoke-ZabbixRpc -Method 'action.create' -AuthToken $authToken -Params @{
        name = $definition.Name
        eventsource = 2
        status = 0
        filter = @{
            evaltype = 0
            conditions = @(
                @{
                    conditiontype = 24
                    operator = 2
                    value = $definition.Metadata
                }
            )
        }
        operations = @(
            @{ operationtype = 2 },
            @{
                operationtype = 4
                opgroup = @(@{ groupid = $group.groupid })
            },
            @{
                operationtype = 6
                optemplate = @(@{ templateid = $template.templateid })
            }
        )
    }
    Write-Host "Configured: $($definition.Name) ($($createdAction.actionids[0]))"
}
