# Launches TradingView Desktop with Chrome DevTools Protocol on port 9222
# Run this script in PowerShell (right-click -> "Run with PowerShell")

$tvExe = "C:\Program Files\WindowsApps\TradingView.Desktop_3.0.0.7652_x64__n534cwy3pjxzj\TradingView.exe"

if (-not (Test-Path $tvExe)) {
    Write-Host "ERROR: TradingView.exe not found at: $tvExe" -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}

Write-Host "Launching TradingView with --remote-debugging-port=9222 ..." -ForegroundColor Green
Start-Process -FilePath $tvExe -ArgumentList "--remote-debugging-port=9222"
Write-Host "Done!" -ForegroundColor Green
Start-Sleep -Seconds 2
