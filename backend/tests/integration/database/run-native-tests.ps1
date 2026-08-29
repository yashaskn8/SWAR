[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..\..')).Path
$backendRoot = Join-Path $repositoryRoot 'backend'
Import-Module (Join-Path $repositoryRoot 'infrastructure\local-windows\Swar.Local.psm1') -Force

$initdb = Resolve-SwarTool -Name initdb
$pgCtl = Resolve-SwarTool -Name pg_ctl
$psql = Resolve-SwarTool -Name psql
$npm = Resolve-SwarTool -Name npm
$temporaryRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$clusterRoot = [IO.Path]::GetFullPath((Join-Path $temporaryRoot ("swar-phase-f-{0}" -f ([guid]::NewGuid().ToString('N')))))
$clusterData = Join-Path $clusterRoot 'data'
$clusterLog = Join-Path $clusterRoot 'postgresql.log'
$clusterStarted = $false
$originalDatabaseUrl = [Environment]::GetEnvironmentVariable('DATABASE_URL', 'Process')
$originalSwarEnvironment = [Environment]::GetEnvironmentVariable('SWAR_ENV', 'Process')
$originalRunFlag = [Environment]::GetEnvironmentVariable('SWAR_RUN_DATABASE_TESTS', 'Process')
$phaseFailure = $null

function Invoke-Checked {
    param([Parameter(Mandatory)][string]$Executable, [Parameter(Mandatory)][string[]]$Arguments)
    & $Executable @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "Command failed with exit code ${LASTEXITCODE}: $Executable $($Arguments -join ' ')"
    }
}

function Get-AvailableLoopbackPort {
    $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
    try {
        $listener.Start()
        return ([Net.IPEndPoint]$listener.LocalEndpoint).Port
    } finally {
        $listener.Stop()
    }
}

function Assert-TemporaryClusterPath {
    $resolved = [IO.Path]::GetFullPath($clusterRoot)
    $leaf = Split-Path -Leaf $resolved
    if (-not $resolved.StartsWith($temporaryRoot, [StringComparison]::OrdinalIgnoreCase) -or
        -not $leaf.StartsWith('swar-phase-f-', [StringComparison]::Ordinal)) {
        throw "Refusing temporary-cluster cleanup outside the validated SWAR Phase F path: $resolved"
    }
}

try {
    Assert-TemporaryClusterPath
    New-Item -ItemType Directory -Path $clusterData -Force | Out-Null
    $port = Get-AvailableLoopbackPort

    Invoke-Checked -Executable $initdb -Arguments @('-D', $clusterData, '-U', 'postgres', '-A', 'trust', '--no-locale', '--encoding=UTF8')
    Invoke-Checked -Executable $pgCtl -Arguments @('-D', $clusterData, '-l', $clusterLog, '-o', "-h 127.0.0.1 -p $port -F", '-w', 'start')
    $clusterStarted = $true
    Wait-SwarTcpEndpoint -HostName '127.0.0.1' -Port $port -TimeoutSeconds 30 | Out-Null

    Invoke-Checked -Executable $psql -Arguments @('-h', '127.0.0.1', '-p', "$port", '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c', 'CREATE ROLE swar_test_app LOGIN;')
    Invoke-Checked -Executable $psql -Arguments @('-h', '127.0.0.1', '-p', "$port", '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c', 'CREATE DATABASE swar_test OWNER swar_test_app;')

    [Environment]::SetEnvironmentVariable('DATABASE_URL', "postgresql://swar_test_app@127.0.0.1:$port/swar_test", 'Process')
    [Environment]::SetEnvironmentVariable('SWAR_ENV', 'test', 'Process')
    [Environment]::SetEnvironmentVariable('SWAR_RUN_DATABASE_TESTS', 'true', 'Process')

    Push-Location $backendRoot
    try {
        Invoke-Checked -Executable $npm -Arguments @('run', 'prisma:generate')
        Invoke-Checked -Executable $npm -Arguments @('run', 'db:migrate:deploy')
        Invoke-Checked -Executable $npm -Arguments @('run', 'db:migrate:status')
        Invoke-Checked -Executable $npm -Arguments @('run', 'db:seed')
        Invoke-Checked -Executable $npm -Arguments @('run', 'db:seed')
        Invoke-Checked -Executable $npm -Arguments @('run', 'test:database')
        Invoke-Checked -Executable $npm -Arguments @('run', 'db:migrate:deploy')
        Invoke-Checked -Executable $npm -Arguments @('run', 'db:migrate:status')
    } finally {
        Pop-Location
    }
} catch {
    $phaseFailure = $_
} finally {
    [Environment]::SetEnvironmentVariable('DATABASE_URL', $originalDatabaseUrl, 'Process')
    [Environment]::SetEnvironmentVariable('SWAR_ENV', $originalSwarEnvironment, 'Process')
    [Environment]::SetEnvironmentVariable('SWAR_RUN_DATABASE_TESTS', $originalRunFlag, 'Process')
    if ($clusterStarted) {
        & $pgCtl -D $clusterData -m fast -w stop
    }
    if (Test-Path -LiteralPath $clusterRoot) {
        Assert-TemporaryClusterPath
        Remove-Item -LiteralPath $clusterRoot -Recurse -Force
    }
}

if ($null -ne $phaseFailure) {
    Write-Error $phaseFailure
    exit 1
}
