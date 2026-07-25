# Deploy VPS — checklist rápido

## Pré-requisitos (já confirmados)
- Ubuntu + Docker + Nginx
- Domínio no padrão `*.techartsolucoes.com.br`

## 1) DNS (painel do domínio)
Crie registros **A** apontando para o IP da VPS:

| Host | Tipo | Valor |
|------|------|--------|
| `sispro` | A | IP da VPS |
| `sispro-grafana` | A | IP da VPS |

## 2) Na VPS — clonar do GitHub (recomendado)

```bash
# SSH key da VPS já cadastrada no GitHub (Deploy Key ou conta)
cd /opt
git clone git@github.com:SEU_USER/sispro-plataforma.git
# ou HTTPS: git clone https://github.com/SEU_USER/sispro-plataforma.git

# App web (inventário) — outro repo ou pasta irmã, se existir:
# git clone git@github.com:SEU_USER/inventario-cfi.git sispro-web-src

cd /opt/sispro-plataforma
cp .env.example .env
nano .env   # troque senhas e INGEST_TOKEN
chmod +x deploy/vps-bootstrap.sh
WEB_SRC=/opt/sispro-web-src bash deploy/vps-bootstrap.sh
```

Atualizar depois de um push:

```bash
cd /opt/sispro-plataforma && git pull && docker compose -f docker-compose.vps.yml up -d --build
```

## 4) SisPro no browser
⚙ Configurações → Conector:

- URL: `https://sispro.techartsolucoes.com.br/api`
- Cole o `INGEST_TOKEN` do arquivo `/opt/sispro-plataforma/.env`
- Region ID: ex. `carajas` ou `local`
- **Publicar no Grafana**

## 5) Testes
```bash
curl -s https://sispro.techartsolucoes.com.br/api/health
curl -sI https://sispro-grafana.techartsolucoes.com.br/login
```

Grafana: login `admin` + senha em `.env` (`GF_ADMIN_PASSWORD`).
