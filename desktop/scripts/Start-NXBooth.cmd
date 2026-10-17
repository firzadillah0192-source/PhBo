@echo off
cd /d "%~dp0"
echo Membuka blokir file unduhan...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-ChildItem -LiteralPath '%~dp0.' -Recurse | Unblock-File" >nul 2>&1
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Start-NXBooth.ps1"
if errorlevel 1 (
  echo.
  echo Gagal memulai. Baca pesan di atas, lalu tutup jendela ini.
  pause
)
