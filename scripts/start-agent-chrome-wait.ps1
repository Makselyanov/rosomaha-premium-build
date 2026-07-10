param(
  [string]$Url = "about:blank",
  [int]$Port = 9223,
  [string]$ProfileDir = "G:\mvp\work\chrome-freelance-profile",
  [int]$WaitSeconds = 15
)

$ErrorActionPreference = "Stop"

function Find-Chrome {
  $candidates = @(
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
    "$env:LocalAppData\Google\Chrome\Application\chrome.exe"
  )
  foreach ($candidate in $candidates) {
    if ($candidate -and (Test-Path -LiteralPath $candidate)) {
      return $candidate
    }
  }
  $cmd = Get-Command chrome.exe -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  throw "Google Chrome executable was not found."
}

New-Item -ItemType Directory -Force -Path $ProfileDir | Out-Null

try {
  $version = Invoke-WebRequest -UseBasicParsing "http://127.0.0.1:$Port/json/version" -TimeoutSec 2 -ErrorAction Stop
  if ($version) {
    Write-Output "Chrome CDP is already responding on http://127.0.0.1:$Port"
    exit 0
  }
} catch { }

$chrome = Find-Chrome
$args = @(
  "--remote-debugging-port=$Port",
  "--user-data-dir=$ProfileDir",
  "--no-first-run",
  "--disable-default-apps",
  "--start-maximized",
  $Url
)

Start-Process -FilePath $chrome -ArgumentList $args -WindowStyle Normal

for ($i = 0; $i -lt $WaitSeconds; $i++) {
  Start-Sleep -Seconds 1
  try {
    $version = Invoke-WebRequest -UseBasicParsing "http://127.0.0.1:$Port/json/version" -TimeoutSec 2 -ErrorAction Stop
    if ($version) {
      Write-Output "Started dedicated agent Chrome profile: $ProfileDir"
      Write-Output "CDP: http://127.0.0.1:$Port"
      exit 0
    }
  } catch { }
}

throw "Chrome started but CDP http://127.0.0.1:$Port did not respond within $WaitSeconds seconds."
