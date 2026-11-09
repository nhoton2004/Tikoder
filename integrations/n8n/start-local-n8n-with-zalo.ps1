$ErrorActionPreference = 'Stop'
$configPath = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'Tikoder\n8n-zalo-env.json'
$nodePath = Join-Path $env:APPDATA 'fnm\aliases\default\node.exe'
$n8nBin = Join-Path $env:APPDATA 'fnm\aliases\default\node_modules\n8n\bin\n8n'
if (-not (Test-Path -LiteralPath $configPath) -or -not (Test-Path -LiteralPath $nodePath) -or -not (Test-Path -LiteralPath $n8nBin)) {
    throw 'Missing private n8n configuration or installed n8n executable'
}
$settings = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
$required = @('ZALO_PERSONAL_EVENT_SECRET', 'N8N_DATA_API_SECRET', 'N8N_DATA_API_TENANT', 'ZALO_PERSONAL_COMMAND_SECRET', 'NODE_FUNCTION_ALLOW_BUILTIN', 'N8N_BLOCK_ENV_ACCESS_IN_NODE', 'N8N_BLOCK_RUNNER_ENV_ACCESS')
foreach ($name in $required) {
    $value = [string]$settings.$name
    if (-not $value) { throw ('Missing n8n setting: ' + $name) }
    [Environment]::SetEnvironmentVariable($name, $value, 'Process')
}
foreach ($name in @('TIKODER_DATA_API_URL', 'TIKODER_DATA_API_IMAGE_URL', 'ZALO_PERSONAL_COMMAND_URL')) {
    $value = [string]$settings.$name
    if ($value) { [Environment]::SetEnvironmentVariable($name, $value, 'Process') }
}
if ($env:ZALO_N8N_DRY_RUN -eq '1') { Write-Output 'n8n launcher ready (secret values suppressed)'; exit 0 }
& $nodePath $n8nBin start
exit $LASTEXITCODE
