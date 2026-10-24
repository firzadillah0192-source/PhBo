$ErrorActionPreference = 'Stop'
$exe = Join-Path $PSScriptRoot 'NXBooth Desktop.exe'
if (-not (Test-Path -LiteralPath $exe)) { throw 'Extract the complete NXBooth ZIP before starting.' }
$env:PHBO_DEVICE_MODE = 'hardware'
if (-not $env:PHBO_OPERATOR_PIN) {
    $secret = Read-Host 'Choose your local operator PIN (at least 4 characters)' -AsSecureString
    $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
    try { $env:PHBO_OPERATOR_PIN = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
    if ($env:PHBO_OPERATOR_PIN.Length -lt 4) { throw 'Operator PIN needs at least 4 characters.' }
}
Start-Process -FilePath $exe -WorkingDirectory $PSScriptRoot
# The launched process inherits the PIN; keep it out of this shell afterwards.
Remove-Item Env:PHBO_OPERATOR_PIN -ErrorAction SilentlyContinue
