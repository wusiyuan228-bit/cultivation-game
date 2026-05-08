param(
    [Parameter(Mandatory=$true)]
    [string]$Root
)

$ErrorActionPreference = 'Stop'

# 跳过已手工处理的文件
$skip = @(
    (Join-Path $Root "utils\assetPath.ts"),
    (Join-Path $Root "utils\storyCache.ts"),
    (Join-Path $Root "systems\recruit\cardPoolLoader.ts")
)
$skipResolved = @()
foreach ($s in $skip) {
    if (Test-Path $s) { $skipResolved += (Resolve-Path $s).Path }
}

$files = Get-ChildItem -Path $Root -Recurse -Include *.ts,*.tsx -File |
    Where-Object { $skipResolved -notcontains $_.FullName }

$modified = @()
foreach ($f in $files) {
    $orig = Get-Content -Path $f.FullName -Raw -Encoding UTF8
    if ($null -eq $orig) { continue }
    $c = $orig

    # 1) fetch('/config/...') 和 fetch("/config/...")
    $c = [regex]::Replace($c, "fetch\(\s*'/(config|images|audio|fonts)/([^']*)'\s*\)", "fetch(asset('`$1/`$2'))")
    $c = [regex]::Replace($c, 'fetch\(\s*"/(config|images|audio|fonts)/([^"]*)"\s*\)', 'fetch(asset("$1/$2"))')

    # 2) 普通字符串字面量 '/images/xxx' -> asset('images/xxx')
    $c = [regex]::Replace($c, "'/(config|images|audio|fonts)/([^']*)'", "asset('`$1/`$2')")
    $c = [regex]::Replace($c, '"/(config|images|audio|fonts)/([^"]*)"', 'asset("$1/$2")')

    # 3) 反引号模板字符串 `/images/xxx/${id}.jpg` -> asset(`images/xxx/${id}.jpg`)
    $c = [regex]::Replace($c, '`/(config|images|audio|fonts)/([^`]*)`', 'asset(`$1/$2`)')

    if ($c -ne $orig) {
        # 确保已经 import asset
        if ($c -notmatch "from\s+['""]@/utils/assetPath['""]") {
            $lines = $c -split "`r?`n"
            $inserted = $false
            for ($i = 0; $i -lt $lines.Count; $i++) {
                if ($lines[$i] -match '^\s*import\s') {
                    $newLines = @()
                    $newLines += $lines[0..$i]
                    $newLines += "import { asset } from '@/utils/assetPath';"
                    if ($i + 1 -le $lines.Count - 1) {
                        $newLines += $lines[($i+1)..($lines.Count-1)]
                    }
                    $c = $newLines -join "`r`n"
                    $inserted = $true
                    break
                }
            }
            if (-not $inserted) {
                $c = "import { asset } from '@/utils/assetPath';`r`n" + $c
            }
        }

        Set-Content -Path $f.FullName -Value $c -Encoding UTF8 -NoNewline
        $modified += $f.FullName
    }
}

Write-Host ""
Write-Host "=========================================="
Write-Host "Modified $($modified.Count) files:"
$modified | ForEach-Object { Write-Host "  - $_" }
Write-Host "=========================================="
