$ErrorActionPreference = 'Stop'
$scriptRoot = Split-Path $PSScriptRoot -Parent
$repoRoot = (Resolve-Path (Join-Path $scriptRoot '..\..')).Path
Import-Module (Join-Path $scriptRoot 'Swar.Local.psm1') -Force

$testId = [Guid]::NewGuid().ToString('N')
$testRoot = Join-Path $env:TEMP "swar-phase-d-$testId"
$dataRoot = Join-Path $testRoot 'pgdata'
$pgLog = Join-Path $testRoot 'postgres.log'
New-Item -ItemType Directory -Force -Path $testRoot | Out-Null

$initdb = Resolve-SwarTool -Name initdb
$pgCtl = Resolve-SwarTool -Name pg_ctl
$psql = Resolve-SwarTool -Name psql
$pgIsReady = Resolve-SwarTool -Name pg_isready
$postgresStarted = $false

try {
    Write-Output 'SMOKE stage 1/8: validating clean ports'
    foreach ($port in @(3000, 5432, 7880, 7881, 8000)) { Assert-SwarTcpPortAvailable -Port $port -Purpose 'Phase D smoke test' }
    Assert-SwarUdpPortAvailable -Port 7882 -Purpose 'Phase D smoke test'

    Write-Output 'SMOKE stage 2/8: initializing temporary PostgreSQL cluster'
    $initProcess = Start-Process -FilePath $initdb -ArgumentList (ConvertTo-SwarArgumentString @('-D', $dataRoot, '-U', 'postgres', '-A', 'trust', '--no-locale', '--encoding', 'UTF8')) -PassThru -WindowStyle Hidden -RedirectStandardOutput (Join-Path $testRoot 'initdb.out.log') -RedirectStandardError (Join-Path $testRoot 'initdb.err.log')
    if (-not $initProcess.WaitForExit(60000)) { Stop-Process -Id $initProcess.Id -Force; throw 'initdb timed out after 60 seconds.' }
    if ($initProcess.ExitCode -ne 0) { throw "initdb failed with exit code $($initProcess.ExitCode)." }
    $startProcess = Start-Process -FilePath $pgCtl -ArgumentList (ConvertTo-SwarArgumentString @('-D', $dataRoot, '-l', $pgLog, '-o', '-h 127.0.0.1 -p 5432', '-w', 'start')) -PassThru -WindowStyle Hidden -RedirectStandardOutput (Join-Path $testRoot 'pg-start.out.log') -RedirectStandardError (Join-Path $testRoot 'pg-start.err.log')
    if (-not $startProcess.WaitForExit(30000)) { Stop-Process -Id $startProcess.Id -Force; throw 'pg_ctl start timed out after 30 seconds.' }
    if ($startProcess.ExitCode -ne 0) { throw "pg_ctl start failed with exit code $($startProcess.ExitCode)." }
    $postgresStarted = $true

    $env:SWAR_ENV = 'test'
    $env:POSTGRES_HOST = '127.0.0.1'
    $env:POSTGRES_PORT = '5432'
    $env:POSTGRES_ADMIN_DATABASE = 'postgres'
    $env:POSTGRES_ADMIN_USER = 'postgres'
    $env:POSTGRES_ADMIN_PASSWORD = 'phase_d_test_admin_only'
    $env:POSTGRES_APP_DATABASE = 'swar'
    $env:POSTGRES_APP_USER = 'swar_app'
    $env:POSTGRES_APP_PASSWORD = 'phase_d_test_app_password_only'
    $env:BACKEND_HOST = '127.0.0.1'
    $env:BACKEND_PORT = '3000'
    $env:ML_HOST = '127.0.0.1'
    $env:ML_PORT = '8000'
    $env:LIVEKIT_BIND_ADDRESS = '127.0.0.1'
    $env:LIVEKIT_NODE_IP = '127.0.0.1'
    $env:LIVEKIT_PORT = '7880'
    $env:LIVEKIT_RTC_TCP_PORT = '7881'
    $env:LIVEKIT_RTC_UDP_PORT = '7882'
    $env:LIVEKIT_API_KEY = 'phase_d_test_key'
    $env:LIVEKIT_API_SECRET = 'phase_d_test_secret_not_for_reuse'

    Write-Output 'SMOKE stage 3/8: running first PostgreSQL bootstrap'
    & (Join-Path $scriptRoot 'init-postgres.ps1') -EnvFile (Join-Path $testRoot 'absent.env')
    Write-Output 'SMOKE stage 4/8: running idempotent PostgreSQL bootstrap'
    & (Join-Path $scriptRoot 'init-postgres.ps1') -EnvFile (Join-Path $testRoot 'absent.env')
    Write-Output 'SMOKE stage 5/8: verifying bootstrap state'
    $roleCount = & $psql -X -h 127.0.0.1 -p 5432 -U postgres -d postgres -Atc "SELECT count(*) FROM pg_roles WHERE rolname = 'swar_app'"
    $databaseCount = & $psql -X -h 127.0.0.1 -p 5432 -U postgres -d postgres -Atc "SELECT count(*) FROM pg_database WHERE datname = 'swar'"
    if ($roleCount.Trim() -ne '1' -or $databaseCount.Trim() -ne '1') { throw 'Repeated bootstrap did not leave exactly one app role and database.' }

    Write-Output 'SMOKE stage 6/8: starting native SWAR services'
    & (Join-Path $scriptRoot 'start-all.ps1') -EnvFile (Join-Path $testRoot 'absent.env')
    Write-Output 'SMOKE stage 7/8: probing native SWAR services'
    $backend = Invoke-RestMethod -Uri 'http://127.0.0.1:3000/health'
    $ml = Invoke-RestMethod -Uri 'http://127.0.0.1:8000/health'
    if ($backend.status -ne 'ok' -or $ml.status -ne 'ok') { throw 'HTTP liveness response was not healthy.' }
    Wait-SwarTcpEndpoint -HostName 127.0.0.1 -Port 7880 | Out-Null

    $records = @('backend', 'ml', 'livekit') | ForEach-Object { Get-SwarManagedProcess -Name $_ }
    if (($records | Where-Object { $null -eq $_ }).Count) { throw 'One or more managed process records were missing.' }
    $managedPids = @($records | ForEach-Object { $_.Process.Id })
    Write-Output 'SMOKE stage 8/8: stopping only recorded service PIDs'
    & (Join-Path $scriptRoot 'stop-all.ps1') | Out-Null
    foreach ($managedPid in $managedPids) {
        if (Get-Process -Id $managedPid -ErrorAction SilentlyContinue) { throw "Managed PID $managedPid remained after stop-all." }
    }
    if (Test-Path -LiteralPath (Join-Path $repoRoot '.runtime\config\livekit.dev.runtime.yaml')) { throw 'Generated LiveKit credential configuration remained after stop-all.' }
    Write-Output 'PASS PostgreSQL bootstrap is idempotent; backend, ML, and LiveKit start, report healthy, and stop by recorded PID.'
} finally {
    try { & (Join-Path $scriptRoot 'stop-all.ps1') | Out-Null } catch {}
    if ($postgresStarted) {
        try {
            $stopProcess = Start-Process -FilePath $pgCtl -ArgumentList (ConvertTo-SwarArgumentString @('-D', $dataRoot, '-m', 'fast', '-w', 'stop')) -PassThru -WindowStyle Hidden -RedirectStandardOutput (Join-Path $testRoot 'pg-stop.out.log') -RedirectStandardError (Join-Path $testRoot 'pg-stop.err.log')
            if (-not $stopProcess.WaitForExit(30000)) { Stop-Process -Id $stopProcess.Id -Force; throw 'pg_ctl stop timed out after 30 seconds.' }
            if ($stopProcess.ExitCode -ne 0) { throw "pg_ctl stop failed with exit code $($stopProcess.ExitCode)." }
        } catch {}
    }
    $resolvedTestRoot = [System.IO.Path]::GetFullPath($testRoot)
    $resolvedTempRoot = [System.IO.Path]::GetFullPath($env:TEMP).TrimEnd('\') + '\'
    if ($resolvedTestRoot.StartsWith($resolvedTempRoot, [System.StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath $resolvedTestRoot)) {
        Remove-Item -LiteralPath $resolvedTestRoot -Recurse -Force
    }
}
