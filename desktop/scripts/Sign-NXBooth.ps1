# Sign the installer with the self-signed certificate. Run on the PC that holds the .pfx, AFTER the build.
param([Parameter(Mandatory)][string]$Installer, [Parameter(Mandatory)][string]$Pfx)
$ErrorActionPreference = 'Stop'
$pw = Read-Host 'Password for the private key file (.pfx)' -AsSecureString
$cert = [Security.Cryptography.X509Certificates.X509Certificate2]::new($Pfx, $pw)
$r = Set-AuthenticodeSignature -FilePath $Installer -Certificate $cert -HashAlgorithm SHA256
if ($r.Status -ne 'Valid' -and $r.Status -ne 'UnknownError') { throw "Signing failed: $($r.Status) $($r.StatusMessage)" }
Get-AuthenticodeSignature -FilePath $Installer | Format-List Status, StatusMessage, SignerCertificate
Write-Host 'Note: Status shows UnknownError/NotTrusted until Trust-NXBoothCert.ps1 was run on this PC.'
