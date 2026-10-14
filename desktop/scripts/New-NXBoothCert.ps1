# Run once on the PC that signs installers. Creates a self-signed code-signing certificate.
# The private key (.pfx) stays out of the repo; only the public .cer goes to kiosk PCs.
param([string]$OutDir = "$HOME\NXBooth-signing")
$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$cert = New-SelfSignedCertificate -Type CodeSigningCert -Subject 'CN=NXBooth Desktop' `
    -KeyAlgorithm RSA -KeyLength 3072 -HashAlgorithm SHA256 -NotAfter (Get-Date).AddYears(5) `
    -CertStoreLocation Cert:\CurrentUser\My
$pw = Read-Host 'Password for the private key file (.pfx)' -AsSecureString
Export-PfxCertificate -Cert $cert -FilePath "$OutDir\nxbooth-signing.pfx" -Password $pw | Out-Null
Export-Certificate -Cert $cert -FilePath "$OutDir\nxbooth-signing.cer" | Out-Null
Write-Host "Thumbprint: $($cert.Thumbprint)"
Write-Host "Private key: $OutDir\nxbooth-signing.pfx  (keep secret, never commit)"
Write-Host "Public cert: $OutDir\nxbooth-signing.cer  (copy to each kiosk PC, then run Trust-NXBoothCert.ps1)"
