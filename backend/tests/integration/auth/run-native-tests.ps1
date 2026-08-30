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
$clusterRoot = [IO.Path]::GetFullPath((Join-Path $temporaryRoot ("swar-phase-g-{0}" -f ([guid]::NewGuid().ToString('N')))))
$clusterData = Join-Path $clusterRoot 'data'
$clusterLog = Join-Path $clusterRoot 'postgresql.log'
$clusterStarted = $false
$savedEnvironment = @{}
$phaseFailure = $null

function Invoke-Checked {
    param([Parameter(Mandatory)][string]$Executable, [Parameter(Mandatory)][string[]]$Arguments)
    & $Executable @Arguments
    if ($LASTEXITCODE -ne 0) { throw "Command failed with exit code ${LASTEXITCODE}: $Executable $($Arguments -join ' ')" }
}

function Get-AvailableLoopbackPort {
    $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
    try { $listener.Start(); return ([Net.IPEndPoint]$listener.LocalEndpoint).Port } finally { $listener.Stop() }
}

function Assert-TemporaryClusterPath {
    $resolved = [IO.Path]::GetFullPath($clusterRoot)
    if (-not $resolved.StartsWith($temporaryRoot, [StringComparison]::OrdinalIgnoreCase) -or -not (Split-Path -Leaf $resolved).StartsWith('swar-phase-g-', [StringComparison]::Ordinal)) {
        throw "Refusing temporary-cluster cleanup outside the validated SWAR Phase G path: $resolved"
    }
}

$testEnvironment = @{
    SWAR_ENV = 'test'
    SWAR_RUN_AUTH_TESTS = 'true'
    BACKEND_HOST = '127.0.0.1'
    BACKEND_PORT = '3000'
    PUBLIC_API_URL = 'http://127.0.0.1:3000/api/v1'
    SECURITY_WS_URL = 'ws://127.0.0.1:3000/ws/security'
    CORS_ALLOWED_ORIGINS = 'http://127.0.0.1:5173'
    HTTP_BODY_LIMIT_BYTES = '100000'
    HTTP_REQUEST_TIMEOUT_MS = '30000'
    SHUTDOWN_TIMEOUT_MS = '5000'
    POSTGRES_POOL_MAX = '5'
    POSTGRES_IDLE_TIMEOUT_MS = '10000'
    POSTGRES_CONNECTION_TIMEOUT_MS = '5000'
    ML_INTERNAL_URL = 'http://127.0.0.1:8000'
    ML_EVIDENCE_MODE = 'SHADOW'
    RISK_INTERVENTION_MODE = 'ENGINEERING_ONLY'
    PHASE_O_SCIENTIFIC_STATUS = 'BLOCKED'
    PHASE_P_PRODUCTION_STATUS = 'BLOCKED_BY_PHASE_O'
    PHASE_Q_PRODUCTION_STATUS = 'ENGINEERING_ONLY'
    ML_CONTROL_MAX_ATTEMPTS = '2'
    ML_CONTROL_RETRY_BACKOFF_MS = '10'
    INTERNAL_AUTH_CLOCK_SKEW_SECONDS = '30'
    ML_INTERNAL_SECRET = 'phase-g-ml-internal-secret-for-tests-only'
    VERIFICATION_CALLBACK_SECRET = 'phase-j-verification-callback-secret-tests'
    LIVEKIT_URL = 'ws://127.0.0.1:7880'
    LIVEKIT_API_KEY = 'phase-g-test-key'
    LIVEKIT_API_SECRET = 'phase-g-livekit-secret-for-tests-only'
    DOWNSTREAM_HTTP_TIMEOUT_MS = '500'
    DOWNSTREAM_WEBSOCKET_TIMEOUT_MS = '500'
    LIVEKIT_PARTICIPANT_GRANT_TTL_SECONDS = '300'
    ANALYSIS_SESSION_TTL_SECONDS = '900'
    API_RATE_LIMIT_WINDOW_SECONDS = '60'
    API_SENSITIVE_RATE_LIMIT_MAX = '10'
    API_MUTATION_RATE_LIMIT_MAX = '60'
    API_QUERY_RATE_LIMIT_MAX = '300'
    SECURITY_WS_REPLAY_MAX_EVENTS = '100'
    SECURITY_WS_SUBSCRIPTION_MAX_CALLS = '50'
    SECURITY_WS_INBOUND_RATE_LIMIT_MAX = '60'
    ENROLLMENT_MAX_SAMPLES = '5'
    ENROLLMENT_MAX_SAMPLE_BYTES = '1048576'
    ENROLLMENT_MAX_TOTAL_BYTES = '5242880'
    ENROLLMENT_MAX_DECLARED_DURATION_MS = '30000'
    STEP_UP_CHALLENGE_TTL_SECONDS = '300'
    JWT_ACCESS_SECRET = 'phase-g-access-secret-for-native-tests-only'
    JWT_REFRESH_SECRET = 'phase-g-refresh-secret-for-native-tests-only'
    JWT_ISSUER = 'swar-native-auth-test'
    JWT_AUDIENCE = 'swar-native-auth-test-api'
    JWT_ACCESS_TTL_SECONDS = '300'
    JWT_CLOCK_TOLERANCE_SECONDS = '0'
    REFRESH_SESSION_TTL_SECONDS = '3600'
    AUTH_LOGIN_MAX_ATTEMPTS = '10'
    AUTH_LOGIN_WINDOW_SECONDS = '300'
    IDEMPOTENCY_TTL_SECONDS = '3600'
    IDEMPOTENCY_MAX_ENTRIES = '1000'
    VOICEPRINT_ENCRYPTION_KEY = 'BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc='
    VOICEPRINT_ENCRYPTION_KEY_VERSION = 'test-key-v1'
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
    $testEnvironment.DATABASE_URL = "postgresql://swar_test_app@127.0.0.1:$port/swar_test"
    foreach ($name in $testEnvironment.Keys) {
        $savedEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
        [Environment]::SetEnvironmentVariable($name, $testEnvironment[$name], 'Process')
    }
    Push-Location $backendRoot
    try {
        Invoke-Checked -Executable $npm -Arguments @('run', 'prisma:generate')
        Invoke-Checked -Executable $npm -Arguments @('run', 'db:migrate:deploy')
        Invoke-Checked -Executable $npm -Arguments @('run', 'test:auth')
    } finally { Pop-Location }
} catch { $phaseFailure = $_ } finally {
    foreach ($name in $testEnvironment.Keys) { [Environment]::SetEnvironmentVariable($name, $savedEnvironment[$name], 'Process') }
    if ($clusterStarted) { & $pgCtl -D $clusterData -m fast -w stop }
    if (Test-Path -LiteralPath $clusterRoot) { Assert-TemporaryClusterPath; Remove-Item -LiteralPath $clusterRoot -Recurse -Force }
}

if ($null -ne $phaseFailure) { Write-Error $phaseFailure; exit 1 }
