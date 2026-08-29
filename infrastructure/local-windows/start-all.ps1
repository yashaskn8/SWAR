[CmdletBinding()]
param([string]$EnvFile = (Join-Path (Resolve-Path (Join-Path $PSScriptRoot '..\..')) '.env'))

$ErrorActionPreference = 'Stop'
try {
    & (Join-Path $PSScriptRoot 'check-prerequisites.ps1') -EnvFile $EnvFile
    & (Join-Path $PSScriptRoot 'init-postgres.ps1') -EnvFile $EnvFile
    & (Join-Path $PSScriptRoot 'start-livekit.ps1') -EnvFile $EnvFile
    & (Join-Path $PSScriptRoot 'start-ml.ps1') -EnvFile $EnvFile
    & (Join-Path $PSScriptRoot 'start-backend.ps1') -EnvFile $EnvFile
    Write-Output 'SWAR native services are ready: PostgreSQL, LiveKit, ML, and backend.'
} catch {
    try { & (Join-Path $PSScriptRoot 'stop-all.ps1') | Out-Null } catch {}
    throw
}
