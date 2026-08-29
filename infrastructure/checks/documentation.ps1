$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$errors = [System.Collections.Generic.List[string]]::new()
$markdownFiles = Get-ChildItem -LiteralPath $repoRoot -Filter '*.md' -File -Recurse | Where-Object {
    $_.FullName -notmatch '[\\/](node_modules|\.venv|\.runtime)[\\/]'
}

foreach ($file in $markdownFiles) {
    $relative = [System.IO.Path]::GetRelativePath($repoRoot, $file.FullName)
    $content = Get-Content -LiteralPath $file.FullName -Raw
    if ([string]::IsNullOrWhiteSpace($content)) { $errors.Add("$relative is empty."); continue }
    if ($relative -ne 'AGENTS.md' -and $content -notmatch '(?m)^#\s+\S') { $errors.Add("$relative has no H1 heading.") }
    if ($content.Contains("`t")) { $errors.Add("$relative contains a tab character.") }

    foreach ($match in [regex]::Matches($content, '\[[^\]]+\]\(([^)]+)\)')) {
        $target = $match.Groups[1].Value.Trim().Trim('<', '>')
        if (-not $target -or $target.StartsWith('#') -or $target -match '^[a-z][a-z0-9+.-]*:') { continue }
        $pathPart = ($target -split '#', 2)[0]
        if (-not $pathPart) { continue }
        $decoded = [System.Uri]::UnescapeDataString($pathPart).Replace('/', [System.IO.Path]::DirectorySeparatorChar)
        $resolved = [System.IO.Path]::GetFullPath((Join-Path $file.DirectoryName $decoded))
        if (-not (Test-Path -LiteralPath $resolved)) { $errors.Add("$relative has a broken relative link: $target") }
    }
}

if ($errors.Count) { throw ("Documentation check failed:`n- " + ($errors -join "`n- ")) }
Write-Output "Documentation check passed for $($markdownFiles.Count) Markdown files."
