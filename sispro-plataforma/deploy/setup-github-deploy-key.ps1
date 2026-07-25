# Gera chave SSH ed25519 no Windows para o repo SisPro (uso local ou copiar .pub para Deploy Key).
#
# Uso (PowerShell):
#   cd "...\sispro-plataforma\deploy"
#   .\setup-github-deploy-key.ps1
#
# Depois cole a chave pública em:
#   https://github.com/mantoky/SisPro/settings/keys

$ErrorActionPreference = "Stop"

$GitHubRepo = if ($env:GITHUB_REPO) { $env:GITHUB_REPO } else { "mantoky/SisPro" }
$KeyDir = Join-Path $HOME ".ssh"
$KeyName = "id_ed25519_sispro"
$KeyPath = Join-Path $KeyDir $KeyName
$HostAlias = "github.com-sispro"
$Comment = "sispro-deploy@$env:COMPUTERNAME"

if (-not (Test-Path $KeyDir)) {
  New-Item -ItemType Directory -Path $KeyDir | Out-Null
}

if (Test-Path $KeyPath) {
  Write-Host "==> Chave ja existe: $KeyPath"
} else {
  Write-Host "==> Gerando chave ed25519: $KeyPath"
  ssh-keygen -t ed25519 -C $Comment -f $KeyPath -N '""'
}

$ConfigFile = Join-Path $KeyDir "config"
$MarkerBegin = "# BEGIN SisPro deploy key"
$MarkerEnd = "# END SisPro deploy key"
$Block = @"
$MarkerBegin
Host $HostAlias
  HostName github.com
  User git
  IdentityFile $KeyPath
  IdentitiesOnly yes
  StrictHostKeyChecking accept-new
$MarkerEnd
"@

if ((Test-Path $ConfigFile) -and (Select-String -Path $ConfigFile -Pattern [regex]::Escape($MarkerBegin) -Quiet)) {
  Write-Host "==> Bloco SSH config ja presente em $ConfigFile"
} else {
  Write-Host "==> Atualizando $ConfigFile"
  Add-Content -Path $ConfigFile -Value "`n$Block" -Encoding ascii
}

Write-Host ""
Write-Host "========== CHAVE PUBLICA (cole no GitHub Deploy keys) =========="
Get-Content "$KeyPath.pub"
Write-Host "==============================================================="
Write-Host ""
Write-Host "GitHub -> https://github.com/$GitHubRepo/settings/keys"
Write-Host "  Title: vps-sispro"
Write-Host "  Write: desmarcado"
Write-Host ""
Write-Host "Teste:  ssh -T git@$HostAlias"
Write-Host "Clone:  git clone git@${HostAlias}:${GitHubRepo}.git"
Write-Host ""
