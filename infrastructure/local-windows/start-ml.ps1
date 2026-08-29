[CmdletBinding()]
param([string]$EnvFile = (Join-Path (Resolve-Path (Join-Path $PSScriptRoot '..\..')) '.env'))

$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'Swar.Local.psm1') -Force
Import-SwarEnvironment -Path $EnvFile

$python = Resolve-SwarTool -Name python
$mlRoot = Join-Path (Get-SwarRepositoryRoot) 'ml'
$hostName = Get-SwarSetting -Name ML_HOST -Default '127.0.0.1'
$port = [int](Get-SwarSetting -Name ML_PORT -Default '8000')
Assert-SwarTcpPortAvailable -Port $port -Purpose 'FastAPI ML service'

try {
    $process = Start-SwarManagedProcess -Name ml -ExecutablePath $python -ArgumentList @('-m', 'uvicorn', 'app.main:app', '--host', $hostName, '--port', $port.ToString(), '--no-access-log') -WorkingDirectory $mlRoot -CommandMarker 'uvicorn app.main:app'
    Wait-SwarHttpHealth -Uri "http://127.0.0.1:$port/health" | Out-Null
    Write-Output "SWAR ML service is healthy on TCP $port (PID $($process.Id)); no model-readiness claim was made."
} catch {
    try { Stop-SwarManagedProcess -Name ml | Out-Null } catch {}
    throw
}
