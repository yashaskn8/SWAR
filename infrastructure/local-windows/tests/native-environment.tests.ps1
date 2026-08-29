$ErrorActionPreference = 'Stop'
$scriptRoot = Split-Path $PSScriptRoot -Parent
$repoRoot = (Resolve-Path (Join-Path $scriptRoot '..\..')).Path
Import-Module (Join-Path $scriptRoot 'Swar.Local.psm1') -Force

$failures = [System.Collections.Generic.List[string]]::new()
function Invoke-TestCase {
    param([string]$Name, [scriptblock]$Test)
    try { & $Test; Write-Output "PASS $Name" } catch { $failures.Add("${Name}: $($_.Exception.Message)"); Write-Output "FAIL $Name" }
}

Invoke-TestCase 'missing tool produces an actionable error' {
    $message = $null
    try {
        & (Join-Path $scriptRoot 'check-prerequisites.ps1') -RequiredTools @('node') -ToolPathOverrides @{ node = (Join-Path $env:TEMP 'swar-missing-node.exe') } -SkipPortChecks -SkipPostgresReadiness
        throw 'Expected prerequisite failure did not occur.'
    } catch { $message = $_.Exception.Message }
    if ($message -notmatch 'missing executable') { throw "Unexpected error: $message" }
}

Invoke-TestCase 'occupied TCP port is rejected' {
    $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
    $listener.ExclusiveAddressUse = $true
    $listener.Start()
    try {
        $port = ([System.Net.IPEndPoint]$listener.LocalEndpoint).Port
        $message = $null
        try {
            & (Join-Path $scriptRoot 'check-prerequisites.ps1') -SkipToolChecks -RequiredTcpPorts @($port) -RequiredUdpPorts @(65534) -SkipPostgresReadiness
            throw 'Expected occupied-port failure did not occur.'
        } catch { $message = $_.Exception.Message }
        if ($message -notmatch "TCP port $port.*occupied") { throw "Unexpected error: $message" }
    } finally { $listener.Stop() }
}

Invoke-TestCase 'stop targets only the recorded process' {
    $pwsh = (Get-Process -Id $PID).Path
    $managed = Start-Process -FilePath $pwsh -ArgumentList '-NoProfile -Command "Start-Sleep -Seconds 60"' -PassThru -WindowStyle Hidden
    $unrelated = Start-Process -FilePath $pwsh -ArgumentList '-NoProfile -Command "Start-Sleep -Seconds 60"' -PassThru -WindowStyle Hidden
    try {
        Save-SwarProcessRecord -Name lifecycle-test -Process $managed -ExecutablePath $pwsh -CommandMarker 'lifecycle-test'
        if (-not (Stop-SwarManagedProcess -Name lifecycle-test)) { throw 'Recorded process was not stopped.' }
        if (-not $managed.HasExited) { throw 'Recorded process remained running.' }
        if ($unrelated.HasExited) { throw 'Unrelated process was stopped.' }
    } finally {
        if (-not $managed.HasExited) { Stop-Process -Id $managed.Id -Force }
        if (-not $unrelated.HasExited) { Stop-Process -Id $unrelated.Id -Force }
        $record = Join-Path $repoRoot '.runtime\pids\lifecycle-test.json'
        if (Test-Path -LiteralPath $record) { Remove-Item -LiteralPath $record }
    }
}

if ($failures.Count) {
    throw ("Native environment tests failed:`n- " + ($failures -join "`n- "))
}
Write-Output 'All native environment failure-path tests passed.'
