# RTL Answers installer for ZCode (Windows)
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -c "irm https://raw.githubusercontent.com/AmiraliFirouzi/zcode-rtl-answers/main/install.ps1 | iex"

$ErrorActionPreference = "Stop"
$Repo = "AmiraliFirouzi/zcode-rtl-answers"
$Plugin = "rtl-answers@zcode-rtl-answers"

function Write-Step($m) { Write-Host "==> $m" -ForegroundColor Cyan }
function Write-Ok($m)   { Write-Host "    $m" -ForegroundColor Green }
function Write-Fail($m) { Write-Host $m -ForegroundColor Yellow }

function Invoke-ZCode {
  param([Parameter(ValueFromRemainingArguments = $true)] $Args)
  $out = $null
  $cmd = Get-Command zcode -ErrorAction SilentlyContinue
  if ($cmd) { $out = & zcode @Args }
  else {
    $exe = @("$env:LOCALAPPDATA\Programs\ZCode\ZCode.exe", "$env:ProgramFiles\ZCode\ZCode.exe") |
      Where-Object { Test-Path $_ } | Select-Object -First 1
    if (-not $exe) {
      Write-Fail "ZCode not found. Install ZCode Desktop, or add the marketplace manually:"
      Write-Fail "  ZCode > Plugin Marketplace > Add > $Repo"
      exit 1
    }
    $cjs = Join-Path (Split-Path $exe -Parent) "resources\glm\zcode.cjs"
    if (-not (Test-Path $cjs)) { Write-Fail "zcode.cjs not found next to $exe"; exit 1 }
    $env:ELECTRON_RUN_AS_NODE = "1"
    $out = & $exe $cjs @Args
  }
  if ($LASTEXITCODE -ne 0) { throw "zcode $Args failed: $out" }
  return $out
}

Write-Step "Adding marketplace $Repo"
try { Invoke-ZCode plugins marketplace add $Repo 2>$null }
catch { Write-Ok "marketplace already added (or updated)" }

Write-Step "Installing $Plugin"
try { Invoke-ZCode plugins install $Plugin 2>$null }
catch {
  Write-Ok "already installed - updating instead"
  try { Invoke-ZCode plugins update $Plugin 2>$null } catch { Write-Ok "already at latest version" }
}

try { Invoke-ZCode plugins enable $Plugin 2>$null } catch { }

Write-Host ""
Write-Host "RTL Answers installed successfully." -ForegroundColor Green
Write-Host "1. Restart ZCode (fully close and reopen)."
Write-Host "2. Chat in Persian - long answers appear in a right-to-left panel."
