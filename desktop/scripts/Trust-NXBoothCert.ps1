# Run on each kiosk PC as Administrator. Trusts installers signed with the NXBooth self-signed certificate.
param([Parameter(Mandatory)][string]$Cer)
$ErrorActionPreference = 'Stop'
if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole('Administrator')) { throw 'Run PowerShell as Administrator.' }
Import-Certificate -FilePath $Cer -CertStoreLocation Cert:\LocalMachine\Root | Out-Null
Import-Certificate -FilePath $Cer -CertStoreLocation Cert:\LocalMachine\TrustedPublisher | Out-Null
Write-Host 'Certificate trusted on this PC.'
