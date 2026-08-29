[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$checkScript = Join-Path (Split-Path -Parent $PSCommandPath) "repository-boundaries.ps1"
$repositoryRoot = (Resolve-Path -LiteralPath (Join-Path (Split-Path -Parent $PSCommandPath) "..\..")).Path
$powerShellExecutable = (Get-Process -Id $PID).Path
$fixtureRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("swar-boundary-" + [guid]::NewGuid().ToString("N"))

function Invoke-BoundaryCheck {
    param([Parameter(Mandatory)][string] $TargetRoot)

    & $powerShellExecutable -NoProfile -File $checkScript -RootPath $TargetRoot *> $null
    return $LASTEXITCODE
}

try {
    if ((Invoke-BoundaryCheck -TargetRoot $repositoryRoot) -ne 0) {
        throw "The actual repository failed its boundary check."
    }

    $containerFixture = Join-Path $fixtureRoot "container"
    New-Item -ItemType Directory -Path $containerFixture -Force | Out-Null
    Set-Content -LiteralPath (Join-Path $containerFixture "Dockerfile") -Value "forbidden fixture"
    if ((Invoke-BoundaryCheck -TargetRoot $containerFixture) -eq 0) {
        throw "The boundary check accepted a forbidden container artifact."
    }

    $importFixture = Join-Path $fixtureRoot "cross-layer"
    $backendSource = Join-Path $importFixture "backend\src"
    New-Item -ItemType Directory -Path $backendSource -Force | Out-Null
    Set-Content -LiteralPath (Join-Path $backendSource "invalid.ts") -Value "import React from 'react';"
    if ((Invoke-BoundaryCheck -TargetRoot $importFixture) -eq 0) {
        throw "The boundary check accepted a forbidden cross-layer import."
    }

    Write-Output "PASS repository boundary negative tests: container artifact and cross-layer import were rejected."
}
finally {
    if (Test-Path -LiteralPath $fixtureRoot) {
        $resolvedFixture = [System.IO.Path]::GetFullPath($fixtureRoot)
        $resolvedTemp = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
        if (-not $resolvedFixture.StartsWith($resolvedTemp, [System.StringComparison]::OrdinalIgnoreCase)) {
            throw "Refusing to remove a fixture outside the operating-system temporary directory."
        }
        Remove-Item -LiteralPath $resolvedFixture -Recurse -Force
    }
}

