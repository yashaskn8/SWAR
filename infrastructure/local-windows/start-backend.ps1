[CmdletBinding()]
param(
    [string]$EnvFile = (Join-Path (Resolve-Path (Join-Path $PSScriptRoot '..\..')) '.env'),
    [switch]$SkipBuild
)

$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'Swar.Local.psm1') -Force
Import-SwarEnvironment -Path $EnvFile

$node = Resolve-SwarTool -Name node
$npm = Resolve-SwarTool -Name npm
$backendRoot = Join-Path (Get-SwarRepositoryRoot) 'backend'
$hostName = Get-SwarSetting -Name BACKEND_HOST -Default '127.0.0.1'
$port = [int](Get-SwarSetting -Name BACKEND_PORT -Default '3000')
Assert-SwarTcpPortAvailable -Port $port -Purpose 'NestJS backend'
if (-not $SkipBuild) {
    & $npm run build --prefix $backendRoot
    if ($LASTEXITCODE -ne 0) { throw "Backend build failed with exit code $LASTEXITCODE." }
}
if (-not (Test-Path -LiteralPath (Join-Path $backendRoot 'dist\main.js'))) { throw 'Backend build output dist/main.js is missing.' }

try {
    $process = Start-SwarManagedProcess -Name backend -ExecutablePath $node -ArgumentList @('dist/main.js') -WorkingDirectory $backendRoot -CommandMarker 'dist/main.js'
    Wait-SwarHttpHealth -Uri "http://127.0.0.1:$port/health" | Out-Null
    Write-Output "SWAR backend is healthy on TCP $port (PID $($process.Id))."
} catch {
    try { Stop-SwarManagedProcess -Name backend | Out-Null } catch {}
    throw
}
