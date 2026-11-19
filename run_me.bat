@echo off
setlocal
set "IP="
for /f "delims=" %%i in ('powershell -NoProfile -Command "$ips=Get-NetIPAddress -AddressFamily IPv4; $m=$ips.Where({$_.IPAddress -match '^(192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.)' -and $_.InterfaceAlias -notmatch 'VMware|Virtual|vEthernet|WSL|Hyper-V|Bettbox|Loopback'}); if(!$m.Count){$m=$ips.Where({$_.IPAddress -notmatch '^(127\.|169\.254\.|198\.18\.)' -and $_.PrefixOrigin -ne 'WellKnown'})}; if($m.Count){$m[0].IPAddress}else{'127.0.0.1'}"') do set "IP=%%i"
set "IP=%IP: =%"
if not defined IP set "IP=127.0.0.1"
echo Detected IP: %IP%
echo Serving on http://%IP%:8080
fileserver.exe --dir . --addr %IP%:8080
