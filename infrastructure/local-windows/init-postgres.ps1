[CmdletBinding()]
param([string]$EnvFile = (Join-Path (Resolve-Path (Join-Path $PSScriptRoot '..\..')) '.env'))

$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'Swar.Local.psm1') -Force
Import-SwarEnvironment -Path $EnvFile

$psql = Resolve-SwarTool -Name psql
$pgIsReady = Resolve-SwarTool -Name pg_isready
$hostName = Get-SwarSetting -Name POSTGRES_HOST -Default '127.0.0.1'
$port = [int](Get-SwarSetting -Name POSTGRES_PORT -Default '5432')
$adminDatabase = Get-SwarSetting -Name POSTGRES_ADMIN_DATABASE -Default 'postgres'
$adminUser = Get-SwarSetting -Name POSTGRES_ADMIN_USER -Default 'postgres'
$adminPassword = Get-SwarSetting -Name POSTGRES_ADMIN_PASSWORD -Required
$appDatabase = Get-SwarSetting -Name POSTGRES_APP_DATABASE -Default 'swar'
$appUser = Get-SwarSetting -Name POSTGRES_APP_USER -Default 'swar_app'
$appPassword = Get-SwarSetting -Name POSTGRES_APP_PASSWORD -Required
Assert-SwarSecret -Name POSTGRES_ADMIN_PASSWORD -Value $adminPassword -MinimumLength 12
Assert-SwarSecret -Name POSTGRES_APP_PASSWORD -Value $appPassword -MinimumLength 16

& $pgIsReady -h $hostName -p $port -q
if ($LASTEXITCODE -ne 0) {
    throw "PostgreSQL is not ready at ${hostName}:$port. Start the native service and retry."
}

$bootstrap = Join-Path (Get-SwarRepositoryRoot) 'infrastructure\postgres\bootstrap.sql'
$priorPassword = [Environment]::GetEnvironmentVariable('PGPASSWORD', 'Process')
try {
    [Environment]::SetEnvironmentVariable('PGPASSWORD', $adminPassword, 'Process')
    & $psql -X --set ON_ERROR_STOP=1 -h $hostName -p $port -U $adminUser -d $adminDatabase -v "app_user=$appUser" -v "app_password=$appPassword" -v "app_database=$appDatabase" -f $bootstrap
    if ($LASTEXITCODE -ne 0) { throw "PostgreSQL bootstrap failed with exit code $LASTEXITCODE." }
} finally {
    [Environment]::SetEnvironmentVariable('PGPASSWORD', $priorPassword, 'Process')
}
Write-Output "PostgreSQL role '$appUser' and database '$appDatabase' are present; no schema or migration was applied."
