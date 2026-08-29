[CmdletBinding()]
param([string]$EnvFile = (Join-Path (Resolve-Path (Join-Path $PSScriptRoot '..\..')) '.env'))

$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'Swar.Local.psm1') -Force
Import-SwarEnvironment -Path $EnvFile

$livekit = Resolve-SwarTool -Name livekit
$bindAddress = Get-SwarSetting -Name LIVEKIT_BIND_ADDRESS -Default '127.0.0.1'
$nodeIp = Get-SwarSetting -Name LIVEKIT_NODE_IP -Default '127.0.0.1'
$port = [int](Get-SwarSetting -Name LIVEKIT_PORT -Default '7880')
$tcpPort = [int](Get-SwarSetting -Name LIVEKIT_RTC_TCP_PORT -Default '7881')
$udpPort = [int](Get-SwarSetting -Name LIVEKIT_RTC_UDP_PORT -Default '7882')
$apiKey = Get-SwarSetting -Name LIVEKIT_API_KEY -Required
$apiSecret = Get-SwarSetting -Name LIVEKIT_API_SECRET -Required
Assert-SwarSecret -Name LIVEKIT_API_KEY -Value $apiKey -MinimumLength 12
Assert-SwarSecret -Name LIVEKIT_API_SECRET -Value $apiSecret -MinimumLength 24

$parsedIp = $null
if (-not [System.Net.IPAddress]::TryParse($bindAddress, [ref]$parsedIp)) { throw "LIVEKIT_BIND_ADDRESS must be an IP address, got '$bindAddress'." }
if (-not [System.Net.IPAddress]::TryParse($nodeIp, [ref]$parsedIp)) { throw "LIVEKIT_NODE_IP must be a reachable IP address, got '$nodeIp'." }
Assert-SwarTcpPortAvailable -Port $port -Purpose 'LiveKit signalling'
Assert-SwarTcpPortAvailable -Port $tcpPort -Purpose 'LiveKit RTC TCP'
Assert-SwarUdpPortAvailable -Port $udpPort -Purpose 'LiveKit RTC UDP'

$quoteYaml = { param([string]$Value) "'" + $Value.Replace("'", "''") + "'" }
$template = Get-Content -LiteralPath (Join-Path (Get-SwarRepositoryRoot) 'infrastructure\livekit\livekit.dev.yaml') -Raw
$config = $template.Replace('__LIVEKIT_PORT__', $port.ToString()).Replace('__LIVEKIT_RTC_TCP_PORT__', $tcpPort.ToString()).Replace('__LIVEKIT_RTC_UDP_PORT__', $udpPort.ToString()).Replace('__LIVEKIT_NODE_IP__', (& $quoteYaml $nodeIp)).Replace('__LIVEKIT_API_KEY__', (& $quoteYaml $apiKey)).Replace('__LIVEKIT_API_SECRET__', (& $quoteYaml $apiSecret))
$runtimeConfig = Join-Path (Get-SwarRuntimeRoot) 'config\livekit.dev.runtime.yaml'
$config | Set-Content -LiteralPath $runtimeConfig -Encoding utf8

try {
    $process = Start-SwarManagedProcess -Name livekit -ExecutablePath $livekit -ArgumentList @('--config', $runtimeConfig, '--bind', $bindAddress) -WorkingDirectory (Get-SwarRepositoryRoot) -CommandMarker 'livekit.dev.runtime.yaml'
    Wait-SwarTcpEndpoint -HostName '127.0.0.1' -Port $port | Out-Null
    Write-Output "LiveKit is ready on TCP $port (PID $($process.Id)); RTC TCP $tcpPort and UDP $udpPort are configured."
} catch {
    try { Stop-SwarManagedProcess -Name livekit | Out-Null } catch {}
    if (Test-Path -LiteralPath $runtimeConfig) { Remove-Item -LiteralPath $runtimeConfig }
    throw
}
