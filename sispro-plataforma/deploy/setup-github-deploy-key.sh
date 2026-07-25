#!/usr/bin/env bash
# Gera Deploy Key SSH (ed25519) para clonar o repo privado SisPro na VPS.
#
# Uso (na VPS, como root ou usuário do deploy):
#   bash deploy/setup-github-deploy-key.sh
#   # ou com repo customizado:
#   GITHUB_REPO=mantoky/SisPro bash deploy/setup-github-deploy-key.sh
#
# Depois:
#   1) Copie a chave PÚBLICA impressa
#   2) GitHub → https://github.com/mantoky/SisPro → Settings → Deploy keys → Add deploy key
#      Title: vps-sispro   |  Key: (colar)  |  Allow write access: NÃO (só leitura)
#   3) Teste: ssh -T git@github.com-sispro
#   4) Clone: git clone git@github.com-sispro:mantoky/SisPro.git /opt/SisPro

set -euo pipefail

GITHUB_REPO="${GITHUB_REPO:-mantoky/SisPro}"
KEY_DIR="${KEY_DIR:-$HOME/.ssh}"
KEY_NAME="${KEY_NAME:-id_ed25519_sispro}"
KEY_PATH="${KEY_DIR}/${KEY_NAME}"
HOST_ALIAS="${HOST_ALIAS:-github.com-sispro}"
COMMENT="${COMMENT:-sispro-deploy@$(hostname -s 2>/dev/null || echo vps)}"

mkdir -p "$KEY_DIR"
chmod 700 "$KEY_DIR"

if [[ -f "$KEY_PATH" ]]; then
  echo "==> Chave já existe: $KEY_PATH"
  echo "    (apague-a se quiser regenerar: rm -f ${KEY_PATH} ${KEY_PATH}.pub)"
else
  echo "==> Gerando chave ed25519: $KEY_PATH"
  ssh-keygen -t ed25519 -C "$COMMENT" -f "$KEY_PATH" -N ""
  chmod 600 "$KEY_PATH"
  chmod 644 "${KEY_PATH}.pub"
fi

CONFIG_FILE="${KEY_DIR}/config"
MARKER_BEGIN="# BEGIN SisPro deploy key"
MARKER_END="# END SisPro deploy key"

BLOCK=$(cat <<EOF
${MARKER_BEGIN}
Host ${HOST_ALIAS}
  HostName github.com
  User git
  IdentityFile ${KEY_PATH}
  IdentitiesOnly yes
  StrictHostKeyChecking accept-new
${MARKER_END}
EOF
)

if [[ -f "$CONFIG_FILE" ]] && grep -qF "$MARKER_BEGIN" "$CONFIG_FILE"; then
  echo "==> Bloco SSH config já presente em $CONFIG_FILE"
else
  echo "==> Atualizando $CONFIG_FILE"
  touch "$CONFIG_FILE"
  chmod 600 "$CONFIG_FILE"
  printf '\n%s\n' "$BLOCK" >> "$CONFIG_FILE"
fi

echo ""
echo "========== CHAVE PÚBLICA (cole no GitHub Deploy keys) =========="
cat "${KEY_PATH}.pub"
echo "==============================================================="
echo ""
echo "GitHub → https://github.com/${GITHUB_REPO}/settings/keys"
echo "  Title:  vps-sispro"
echo "  Key:    (cole a linha acima)"
echo "  Write:  desmarcado (somente leitura)"
echo ""
echo "Teste:"
echo "  ssh -T git@${HOST_ALIAS}"
echo ""
echo "Clone / pull:"
echo "  git clone git@${HOST_ALIAS}:${GITHUB_REPO}.git /opt/SisPro"
echo "  cd /opt/SisPro && git pull"
echo ""
