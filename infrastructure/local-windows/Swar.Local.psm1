Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-SwarRepositoryRoot {
    return (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
}

function Import-SwarEnvironment {
    param(
        [string]$Path = (Join-Path (Get-SwarRepositoryRoot) '.env'),
        [switch]$Force
    )

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        return
    }

    foreach ($line in Get-Content -LiteralPath $Path) {
        $trimmed = $line.Trim()
        if (-not $trimmed -or $trimmed.StartsWith('#')) {
            continue
        }

        $separator = $trimmed.IndexOf('=')
        if ($separator -lt 1) {
            throw "Invalid environment entry in ${Path}: expected KEY=VALUE."
        }

        $name = $trimmed.Substring(0, $separator).Trim()
        $value = $trimmed.Substring($separator + 1).Trim()
        if ($value.Length -ge 2 -and (($value[0] -eq '"' -and $value[-1] -eq '"') -or ($value[0] -eq "'" -and $value[-1] -eq "'"))) {
            $value = $value.Substring(1, $value.Length - 2)
        }

        if ($name -notmatch '^[A-Z][A-Z0-9_]*$') {
            throw "Invalid environment variable name '$name' in $Path."
        }

        if ($Force -or [string]::IsNullOrEmpty([Environment]::GetEnvironmentVariable($name, 'Process'))) {
            [Environment]::SetEnvironmentVariable($name, $value, 'Process')
        }
    }
}

function Get-SwarSetting {
    param(
        [Parameter(Mandatory)][string]$Name,
        [string]$Default,
        [switch]$Required
    )

    $value = [Environment]::GetEnvironmentVariable($Name, 'Process')
    if ([string]::IsNullOrWhiteSpace($value)) {
        $value = $Default
    }
    if ($Required -and [string]::IsNullOrWhiteSpace($value)) {
        throw "Required setting $Name is missing. Copy .env.example to .env and configure it."
    }
    return $value
}

function Assert-SwarSecret {
    param(
        [Parameter(Mandatory)][string]$Name,
        [Parameter(Mandatory)][string]$Value,
        [int]$MinimumLength = 16
    )

    if ($Value.Length -lt $MinimumLength -or $Value -match '^(replace_with|change_me|devkey$|secret$)' -or $Value -match '^example') {
        throw "$Name is missing, insecure, or still uses an example placeholder."
    }
}

function Get-SwarToolDefinition {
    param([Parameter(Mandatory)][string]$Name)

    $root = Get-SwarRepositoryRoot
    $userTools = Join-Path $env:LOCALAPPDATA 'SWAR\tools'
    $definitions = @{
        node = @{ Env = 'SWAR_NODE_PATH'; Commands = @('node.exe', 'node'); Patterns = @() }
        npm = @{ Env = 'SWAR_NPM_PATH'; Commands = @('npm.cmd', 'npm'); Patterns = @() }
        python = @{ Env = 'SWAR_PYTHON_PATH'; Commands = @('python.exe', 'python'); Patterns = @((Join-Path $root 'ml\.venv\Scripts\python.exe')) }
        java = @{ Env = 'SWAR_JAVA_PATH'; Commands = @('java.exe', 'java'); Patterns = @((Join-Path $userTools 'jdk-*\bin\java.exe')) }
        gradle = @{ Env = 'SWAR_GRADLE_PATH'; Commands = @('gradle.bat', 'gradle'); Patterns = @((Join-Path $userTools 'gradle-*\bin\gradle.bat')) }
        psql = @{ Env = 'SWAR_PSQL_PATH'; Commands = @('psql.exe', 'psql'); Patterns = @('C:\Program Files\PostgreSQL\*\bin\psql.exe', (Join-Path $userTools 'postgresql-*\pgsql\bin\psql.exe')) }
        pg_isready = @{ Env = 'SWAR_PG_ISREADY_PATH'; Commands = @('pg_isready.exe', 'pg_isready'); Patterns = @('C:\Program Files\PostgreSQL\*\bin\pg_isready.exe', (Join-Path $userTools 'postgresql-*\pgsql\bin\pg_isready.exe')) }
        pg_ctl = @{ Env = 'SWAR_PG_CTL_PATH'; Commands = @('pg_ctl.exe', 'pg_ctl'); Patterns = @('C:\Program Files\PostgreSQL\*\bin\pg_ctl.exe', (Join-Path $userTools 'postgresql-*\pgsql\bin\pg_ctl.exe')) }
        initdb = @{ Env = 'SWAR_INITDB_PATH'; Commands = @('initdb.exe', 'initdb'); Patterns = @('C:\Program Files\PostgreSQL\*\bin\initdb.exe', (Join-Path $userTools 'postgresql-*\pgsql\bin\initdb.exe')) }
        livekit = @{ Env = 'SWAR_LIVEKIT_PATH'; Commands = @('livekit-server.exe', 'livekit-server'); Patterns = @((Join-Path $userTools 'livekit-*\livekit-server.exe')) }
    }

    if (-not $definitions.ContainsKey($Name)) {
        throw "Unknown SWAR prerequisite tool '$Name'."
    }
    return $definitions[$Name]
}

function Resolve-SwarTool {
    param(
        [Parameter(Mandatory)][string]$Name,
        [hashtable]$PathOverrides = @{}
    )

    $definition = Get-SwarToolDefinition -Name $Name
    $explicitPath = $null
    if ($PathOverrides.ContainsKey($Name)) {
        $explicitPath = [string]$PathOverrides[$Name]
    } else {
        $explicitPath = [Environment]::GetEnvironmentVariable($definition.Env, 'Process')
    }

    if (-not [string]::IsNullOrWhiteSpace($explicitPath)) {
        if (-not (Test-Path -LiteralPath $explicitPath -PathType Leaf)) {
            throw "$Name override points to a missing executable: $explicitPath"
        }
        return (Resolve-Path -LiteralPath $explicitPath).Path
    }

    foreach ($pattern in $definition.Patterns) {
        $match = Get-Item -Path $pattern -ErrorAction SilentlyContinue | Sort-Object FullName -Descending | Select-Object -First 1
        if ($match) {
            return $match.FullName
        }
    }

    foreach ($commandName in $definition.Commands) {
        $command = Get-Command $commandName -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($command) {
            return $command.Source
        }
    }

    throw "$Name is not installed or discoverable. Install it or set $($definition.Env) to its absolute executable path."
}

function Test-SwarTcpPortAvailable {
    param([Parameter(Mandatory)][ValidateRange(1, 65535)][int]$Port)
    $listener = $null
    try {
        $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Any, $Port)
        $listener.ExclusiveAddressUse = $true
        $listener.Start()
        return $true
    } catch [System.Net.Sockets.SocketException] {
        return $false
    } finally {
        if ($listener) { $listener.Stop() }
    }
}

function Test-SwarUdpPortAvailable {
    param([Parameter(Mandatory)][ValidateRange(1, 65535)][int]$Port)
    $client = $null
    try {
        $client = [System.Net.Sockets.UdpClient]::new($Port)
        return $true
    } catch [System.Net.Sockets.SocketException] {
        return $false
    } finally {
        if ($client) { $client.Dispose() }
    }
}

function Assert-SwarTcpPortAvailable {
    param([Parameter(Mandatory)][int]$Port, [string]$Purpose = 'service')
    if (-not (Test-SwarTcpPortAvailable -Port $Port)) {
        throw "TCP port $Port required by $Purpose is occupied. Stop or reconfigure the owning process, then rerun the check."
    }
}

function Assert-SwarUdpPortAvailable {
    param([Parameter(Mandatory)][int]$Port, [string]$Purpose = 'service')
    if (-not (Test-SwarUdpPortAvailable -Port $Port)) {
        throw "UDP port $Port required by $Purpose is occupied. Stop or reconfigure the owning process, then rerun the check."
    }
}

function Get-SwarRuntimeRoot {
    $runtime = Join-Path (Get-SwarRepositoryRoot) '.runtime'
    New-Item -ItemType Directory -Force -Path (Join-Path $runtime 'pids'), (Join-Path $runtime 'logs'), (Join-Path $runtime 'config') | Out-Null
    return $runtime
}

function ConvertTo-SwarArgumentString {
    param([string[]]$ArgumentList)
    return (($ArgumentList | ForEach-Object {
        if ($_ -notmatch '[\s"]') { $_ } else { '"' + ($_ -replace '(\\*)"', '$1$1\"' -replace '(\\+)$', '$1$1') + '"' }
    }) -join ' ')
}

function Save-SwarProcessRecord {
    param(
        [Parameter(Mandatory)][string]$Name,
        [Parameter(Mandatory)][System.Diagnostics.Process]$Process,
        [Parameter(Mandatory)][string]$ExecutablePath,
        [Parameter(Mandatory)][string]$CommandMarker
    )

    $runtime = Get-SwarRuntimeRoot
    $record = [ordered]@{
        pid = $Process.Id
        executablePath = (Resolve-Path -LiteralPath $ExecutablePath).Path
        startedAtUtc = $Process.StartTime.ToUniversalTime().ToString('o')
        commandMarker = $CommandMarker
    }
    $record | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $runtime "pids\$Name.json") -Encoding utf8
}

function Get-SwarManagedProcess {
    param([Parameter(Mandatory)][string]$Name)
    $recordPath = Join-Path (Get-SwarRuntimeRoot) "pids\$Name.json"
    if (-not (Test-Path -LiteralPath $recordPath -PathType Leaf)) { return $null }
    $record = Get-Content -LiteralPath $recordPath -Raw | ConvertFrom-Json
    $process = Get-Process -Id ([int]$record.pid) -ErrorAction SilentlyContinue
    if (-not $process) { return $null }
    try { $actualPath = $process.Path } catch { return $null }
    if (-not $actualPath -or -not [string]::Equals((Resolve-Path -LiteralPath $actualPath).Path, (Resolve-Path -LiteralPath $record.executablePath).Path, [System.StringComparison]::OrdinalIgnoreCase)) {
        return $null
    }
    if ($record.startedAtUtc -is [DateTime]) {
        $expectedStart = $record.startedAtUtc.ToUniversalTime()
    } else {
        $expectedStart = [DateTime]::ParseExact([string]$record.startedAtUtc, 'o', [System.Globalization.CultureInfo]::InvariantCulture, [System.Globalization.DateTimeStyles]::RoundtripKind).ToUniversalTime()
    }
    if ([Math]::Abs(($process.StartTime.ToUniversalTime() - $expectedStart).TotalSeconds) -gt 1) {
        return $null
    }
    return [pscustomobject]@{ Process = $process; Record = $record; RecordPath = $recordPath }
}

function Start-SwarManagedProcess {
    param(
        [Parameter(Mandatory)][string]$Name,
        [Parameter(Mandatory)][string]$ExecutablePath,
        [string[]]$ArgumentList = @(),
        [Parameter(Mandatory)][string]$WorkingDirectory,
        [Parameter(Mandatory)][string]$CommandMarker
    )

    $existing = Get-SwarManagedProcess -Name $Name
    if ($existing) {
        return $existing.Process
    }

    $runtime = Get-SwarRuntimeRoot
    $recordPath = Join-Path $runtime "pids\$Name.json"
    if (Test-Path -LiteralPath $recordPath) {
        throw "Stale or mismatched process record exists for $Name at $recordPath. Inspect it before removal; no process was stopped."
    }
    $stdout = Join-Path $runtime "logs\$Name.out.log"
    $stderr = Join-Path $runtime "logs\$Name.err.log"
    $process = Start-Process -FilePath $ExecutablePath -ArgumentList (ConvertTo-SwarArgumentString $ArgumentList) -WorkingDirectory $WorkingDirectory -PassThru -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr
    Save-SwarProcessRecord -Name $Name -Process $process -ExecutablePath $ExecutablePath -CommandMarker $CommandMarker
    return $process
}

function Stop-SwarManagedProcess {
    param([Parameter(Mandatory)][string]$Name)
    $recordPath = Join-Path (Get-SwarRuntimeRoot) "pids\$Name.json"
    if (-not (Test-Path -LiteralPath $recordPath)) {
        return $false
    }
    $managed = Get-SwarManagedProcess -Name $Name
    if (-not $managed) {
        throw "Refusing to stop PID from $recordPath because its executable path or start time no longer matches."
    }
    Stop-Process -Id $managed.Process.Id
    if (-not $managed.Process.WaitForExit(10000)) {
        Stop-Process -Id $managed.Process.Id -Force
        if (-not $managed.Process.WaitForExit(5000)) {
            throw "Managed $Name PID $($managed.Process.Id) did not stop."
        }
    }
    Remove-Item -LiteralPath $recordPath
    return $true
}

function Wait-SwarHttpHealth {
    param([Parameter(Mandatory)][string]$Uri, [int]$TimeoutSeconds = 30)
    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    do {
        try {
            $response = Invoke-RestMethod -Uri $Uri -TimeoutSec 2
            if ($response.status -eq 'ok') { return $response }
        } catch {
            Start-Sleep -Milliseconds 250
        }
    } while ([DateTime]::UtcNow -lt $deadline)
    throw "Health check did not become ready within ${TimeoutSeconds}s: $Uri"
}

function Wait-SwarTcpEndpoint {
    param([Parameter(Mandatory)][string]$HostName, [Parameter(Mandatory)][int]$Port, [int]$TimeoutSeconds = 30)
    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    do {
        $client = [System.Net.Sockets.TcpClient]::new()
        try {
            $task = $client.ConnectAsync($HostName, $Port)
            if ($task.Wait(1000) -and $client.Connected) { return $true }
        } catch {
        } finally {
            $client.Dispose()
        }
        Start-Sleep -Milliseconds 250
    } while ([DateTime]::UtcNow -lt $deadline)
    throw "TCP endpoint did not become reachable within ${TimeoutSeconds}s: ${HostName}:$Port"
}

Export-ModuleMember -Function *-Swar*
