#!/usr/bin/env bash
# Deploy SisPro Platform na VPS (rodar como root no servidor)
# Uso:
#   1) Copiar pasta sispro-plataforma para /opt/sispro-plataforma
#   2) bash deploy/vps-bootstrap.sh

set -euo pipefail

APP_DIR="${APP_DIR:-/opt/sispro-plataforma}"
WEB_SRC="${WEB_SRC:-}"   # opcional: caminho do inventario_cfi_v3.5 no servidor
DOMAIN_APP="${DOMAIN_APP:-sispro.techartsolucoes.com.br}"
DOMAIN_GF="${DOMAIN_GF:-sispro-grafana.techartsolucoes.com.br}"

echo "==> App dir: $APP_DIR"
cd "$APP_DIR"

if [[ ! -f docker-compose.vps.yml ]]; then
  echo "ERRO: docker-compose.vps.yml não encontrado em $APP_DIR"
  exit 1
fi

if [[ ! -f .env ]]; then
  echo "==> Criando .env (troque as senhas!)"
  cat > .env <<EOF
POSTGRES_PASSWORD=$(openssl rand -hex 16)
GF_ADMIN_USER=admin
GF_ADMIN_PASSWORD=$(openssl rand -hex 12)
INGEST_TOKEN=$(openssl rand -hex 16)
GRAFANA_HOST=${DOMAIN_GF}
EOF
  chmod 600 .env
  echo "Senhas geradas em $APP_DIR/.env — guarde o INGEST_TOKEN para o SisPro."
fi

# Copia web se informado
if [[ -n "$WEB_SRC" && -d "$WEB_SRC" ]]; then
  echo "==> Sincronizando web-dist a partir de $WEB_SRC"
  mkdir -p web-dist
  rsync -a --delete \
    --exclude node_modules --exclude .git --exclude tests \
    "$WEB_SRC/" web-dist/
fi

if [[ ! -d web-dist ]] || [[ ! -f web-dist/index.html ]]; then
  echo "AVISO: web-dist/index.html ausente. Copie o inventário para $APP_DIR/web-dist"
fi

echo "==> Docker compose (VPS)"
docker compose -f docker-compose.vps.yml --env-file .env up -d --build

echo "==> Nginx site"
cp -f deploy/nginx-sispro.conf "/etc/nginx/sites-available/${DOMAIN_APP}"
# arquivo único com os dois server_name — symlink com nome do app
ln -sfn "/etc/nginx/sites-available/${DOMAIN_APP}" "/etc/nginx/sites-enabled/${DOMAIN_APP}"
nginx -t
systemctl reload nginx

if command -v certbot >/dev/null 2>&1; then
  echo "==> Certbot HTTPS"
  certbot --nginx -d "$DOMAIN_APP" -d "$DOMAIN_GF" --non-interactive --agree-tos --redirect \
    -m "admin@${DOMAIN_APP#*.}" || echo "Certbot falhou — rode manualmente depois."
else
  echo "Certbot não instalado. Rode: apt install certbot python3-certbot-nginx && certbot --nginx -d $DOMAIN_APP -d $DOMAIN_GF"
fi

echo ""
echo "OK."
echo "  App:     https://${DOMAIN_APP}"
echo "  Grafana: https://${DOMAIN_GF}"
echo "  API:     https://${DOMAIN_APP}/api/health"
echo "  .env:    $APP_DIR/.env"
docker compose -f docker-compose.vps.yml ps
