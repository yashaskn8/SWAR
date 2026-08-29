[CmdletBinding()]
param(
    [string]$EnvFile = (Join-Path (Resolve-Path (Join-Path $PSScriptRoot '..\..')) '.env'),
    [string[]]$RequiredTools = @('node', 'npm', 'python', 'java', 'gradle', 'psql', 'pg_isready', 'pg_ctl', 'initdb', 'livekit'),
    [int[]]$RequiredTcpPorts = @(),
    [int[]]$RequiredUdpPorts = @(),
    [hashtable]$ToolPathOverrides = @{},
    [switch]$SkipToolChecks,
    [switch]$SkipPortChecks,
    [switch]$SkipPostgresReadiness
)

$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'Swar.Local.psm1') -Force
Import-SwarEnvironment -Path $EnvFile

if (-not $RequiredTcpPorts.Count) {
    $RequiredTcpPorts = @(
        [int](Get-SwarSetting -Name BACKEND_PORT -Default '3000'),
        [int](Get-SwarSetting -Name ML_PORT -Default '8000'),
        [int](Get-SwarSetting -Name LIVEKIT_PORT -Default '7880'),
        [int](Get-SwarSetting -Name LIVEKIT_RTC_TCP_PORT -Default '7881')
    )
}
if (-not $RequiredUdpPorts.Count) {
    $RequiredUdpPorts = @([int](Get-SwarSetting -Name LIVEKIT_RTC_UDP_PORT -Default '7882'))
}

$errors = [System.Collections.Generic.List[string]]::new()
$resolved = @{}
if (-not $SkipToolChecks) {
    foreach ($tool in $RequiredTools) {
        try {
            $path = Resolve-SwarTool -Name $tool -PathOverrides $ToolPathOverrides
            $resolved[$tool] = $path
            if ($tool -eq 'java') {
                $javaBin = Split-Path -Parent $path
                $javaHome = Split-Path -Parent $javaBin
                if ([string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable('JAVA_HOME', 'Process'))) {
                    [Environment]::SetEnvironmentVariable('JAVA_HOME', $javaHome, 'Process')
                }
                if (($env:Path -split ';') -notcontains $javaBin) {
                    $env:Path = "$javaBin;$env:Path"
                }
            }
            $versionArgs = if ($tool -eq 'java') { @('-version') } else { @('--version') }
            $versionOutput = @(& $path $versionArgs 2>&1)
            if ($tool -eq 'gradle') {
                $versionLine = $versionOutput | Where-Object { $_.ToString() -match '^Gradle\s+\d' } | Select-Object -First 1
            } else {
                $versionLine = $versionOutput | Where-Object { -not [string]::IsNullOrWhiteSpace($_.ToString()) } | Select-Object -First 1
            }
            if ($null -eq $versionLine -or [string]::IsNullOrWhiteSpace($versionLine.ToString())) {
                throw "$tool version check failed using $path."
            }
            if ($versionLine.ToString() -match '^\s*(ERROR|FATAL):') {
                throw "$tool version check failed using ${path}: $($versionLine.ToString().Trim())"
            }
            $version = $versionLine.ToString().Trim()
            Write-Output ("{0,-12} {1}" -f $tool, $version)
        } catch {
            $errors.Add($_.Exception.Message)
        }
    }
}

if (-not $SkipPortChecks) {
    foreach ($port in ($RequiredTcpPorts | Sort-Object -Unique)) {
        try { Assert-SwarTcpPortAvailable -Port $port -Purpose 'SWAR native runtime' } catch { $errors.Add($_.Exception.Message) }
    }
    foreach ($port in ($RequiredUdpPorts | Sort-Object -Unique)) {
        try { Assert-SwarUdpPortAvailable -Port $port -Purpose 'LiveKit RTC media' } catch { $errors.Add($_.Exception.Message) }
    }
}

if (-not $SkipPostgresReadiness) {
    try {
        $pgIsReady = if ($resolved.ContainsKey('pg_isready')) { $resolved.pg_isready } else { Resolve-SwarTool -Name pg_isready -PathOverrides $ToolPathOverrides }
        $pgHost = Get-SwarSetting -Name POSTGRES_HOST -Default '127.0.0.1'
        $pgPort = [int](Get-SwarSetting -Name POSTGRES_PORT -Default '5432')
        & $pgIsReady -h $pgHost -p $pgPort -q
        if ($LASTEXITCODE -ne 0) {
            $errors.Add("PostgreSQL is not accepting connections at ${pgHost}:$pgPort. Start the native service before SWAR.")
        } else {
            Write-Output "postgresql   ready at ${pgHost}:$pgPort"
        }
    } catch {
        $errors.Add($_.Exception.Message)
    }
}

if ($errors.Count) {
    throw ("SWAR prerequisite check failed:`n- " + ($errors -join "`n- "))
}
Write-Output 'SWAR prerequisite check passed.'
