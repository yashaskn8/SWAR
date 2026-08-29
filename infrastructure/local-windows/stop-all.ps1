[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'Swar.Local.psm1') -Force

foreach ($name in @('backend', 'ml', 'livekit')) {
    if (Stop-SwarManagedProcess -Name $name) {
        Write-Output "Stopped recorded SWAR process '$name'."
    } else {
        Write-Output "No recorded SWAR process '$name' is running."
    }
}

$generatedLiveKitConfig = Join-Path (Get-SwarRuntimeRoot) 'config\livekit.dev.runtime.yaml'
if (Test-Path -LiteralPath $generatedLiveKitConfig) {
    Remove-Item -LiteralPath $generatedLiveKitConfig
    Write-Output 'Removed generated LiveKit credential configuration.'
}
