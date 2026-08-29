[CmdletBinding()]
param(
    [Parameter()]
    [string] $RootPath = ""
)

$ErrorActionPreference = "Stop"
$scriptDirectory = Split-Path -Parent $PSCommandPath
if ([string]::IsNullOrWhiteSpace($RootPath)) {
    $RootPath = Join-Path $scriptDirectory "..\.."
}

$repositoryRoot = (Resolve-Path -LiteralPath $RootPath).Path
$violations = [System.Collections.Generic.List[string]]::new()
$ignoredDirectoryNames = @(
    ".git",
    ".pytest_cache",
    ".ruff_cache",
    ".venv",
    "__pycache__",
    "coverage",
    "dist",
    "node_modules",
    "venv"
)

function Test-IgnoredPath {
    param([Parameter(Mandatory)][string] $Path)

    $relative = [System.IO.Path]::GetRelativePath($repositoryRoot, $Path)
    $segments = $relative -split '[\\/]'
    return $null -ne ($segments | Where-Object { $_ -in $ignoredDirectoryNames } | Select-Object -First 1)
}

$files = Get-ChildItem -LiteralPath $repositoryRoot -Recurse -File | Where-Object {
    -not (Test-IgnoredPath -Path $_.FullName)
}

foreach ($file in $files) {
    $name = $file.Name.ToLowerInvariant()
    if (
        $name -eq ".dockerignore" -or
        $name -match '^dockerfile($|\.)' -or
        $name -match '^(docker-compose|compose)\.ya?ml$'
    ) {
        $violations.Add("Forbidden container artifact: $($file.FullName)")
    }
}

$rootDependencyFiles = @(
    "package.json",
    "package-lock.json",
    "pyproject.toml",
    "requirements.txt",
    "settings.gradle",
    "settings.gradle.kts"
)
foreach ($name in $rootDependencyFiles) {
    $candidate = Join-Path $repositoryRoot $name
    if (Test-Path -LiteralPath $candidate -PathType Leaf) {
        $violations.Add("Root dependency manifest hides service ownership: $candidate")
    }
}

$layerRules = @(
    @{
        Layer = "backend"
        Extensions = @(".cjs", ".js", ".mjs", ".ts")
        Pattern = '(?i)(from\s+|require\s*\(|import\s*\()\s*["''](?:react(?:-dom)?|@vitejs/|fastapi|torch|torchaudio|librosa|androidx)'
    },
    @{
        Layer = "ml"
        Extensions = @(".py")
        Pattern = '(?i)(from|import)\s+(?:@nestjs|prisma|react|androidx|psycopg|asyncpg|sqlalchemy)'
    },
    @{
        Layer = "frontend"
        Extensions = @(".js", ".jsx", ".kt", ".kts", ".ts", ".tsx")
        Pattern = '(?i)(from\s+|require\s*\(|import\s*\()\s*["''](?:@nestjs/|@prisma/|fastapi|torch|torchaudio|psycopg|sqlalchemy)'
    }
)

foreach ($rule in $layerRules) {
    $layerPath = Join-Path $repositoryRoot $rule.Layer
    if (-not (Test-Path -LiteralPath $layerPath -PathType Container)) {
        continue
    }

    $layerFiles = Get-ChildItem -LiteralPath $layerPath -Recurse -File | Where-Object {
        -not (Test-IgnoredPath -Path $_.FullName) -and $_.Extension -in $rule.Extensions
    }
    foreach ($file in $layerFiles) {
        $content = Get-Content -Raw -LiteralPath $file.FullName
        if ($content -match $rule.Pattern) {
            $violations.Add("Forbidden cross-layer import in $($file.FullName)")
        }
    }
}

foreach ($manifestPath in @(
    (Join-Path $repositoryRoot "backend\package.json"),
    (Join-Path $repositoryRoot "ml\pyproject.toml")
)) {
    if (Test-Path -LiteralPath $manifestPath -PathType Leaf) {
        $content = Get-Content -Raw -LiteralPath $manifestPath
        if ($content -match '(?i)testcontainers') {
            $violations.Add("Forbidden Testcontainers dependency: $manifestPath")
        }
    }
}

$infrastructurePath = Join-Path $repositoryRoot "infrastructure"
if (Test-Path -LiteralPath $infrastructurePath -PathType Container) {
    $domainSource = Get-ChildItem -LiteralPath $infrastructurePath -Recurse -File | Where-Object {
        $_.Extension -in @(".java", ".kt", ".py", ".ts", ".tsx")
    }
    foreach ($file in $domainSource) {
        $violations.Add("Infrastructure contains application source: $($file.FullName)")
    }
}

if ($violations.Count -gt 0) {
    $violations | ForEach-Object { Write-Error $_ }
    exit 1
}

Write-Output "PASS repository boundaries: no container artifacts, root dependency manifests, or obvious cross-layer imports."

