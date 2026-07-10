param(
  [string]$HostName = "api.direct.yandex.com",
  [int]$Port = 443
)

$ErrorActionPreference = "Continue"

Write-Output "== DNS =="
try {
  Resolve-DnsName $HostName | Select-Object Name,Type,IPAddress | Format-Table -AutoSize | Out-String
} catch {
  $_.Exception.Message
}

Write-Output "== TCP =="
try {
  Test-NetConnection $HostName -Port $Port -InformationLevel Detailed | Out-String
} catch {
  $_.Exception.Message
}

Write-Output "== CURL connect =="
cmd /c "curl.exe -I -L --connect-timeout 5 https://$HostName/json/v5/campaigns 1>nul 2>nul & echo exit=%ERRORLEVEL%"

Write-Output ""
Write-Output "If exit!=0: check VPN/proxy/firewall. Current interface and route are shown in the TCP section."
