# Deploy VPS — checklist rápido

## Pré-requisitos
- Ubuntu + Docker + Nginx
- Domínio `*.techartsolucoes.com.br`
- Repo: https://github.com/mantoky/SisPro (privado → use Deploy Key)

## 1) DNS
Registros **A** → IP da VPS:

| Host | Tipo | Valor |
|------|------|--------|
| `sispro` | A | IP da VPS |
| `sispro-grafana` | A | IP da VPS |

## 2) SSH Deploy Key (obrigatório se o repo for privado)

Ver guia completo: [GITHUB_SSH.md](./GITHUB_SSH.md)

Resumo na VPS:

```bash
# Gere a chave (script está no repo; se ainda não clonou, copie o .sh à mão)
bash setup-github-deploy-key.sh
# Cole a .pub em: GitHub → SisPro → Settings → Deploy keys
ssh -T git@github.com-sispro
git clone git@github.com-sispro:mantoky/SisPro.git /opt/SisPro
```

## 3) .env + bootstrap

```bash
cd /opt/SisPro/sispro-plataforma
cp -n .env.example .env
nano .env   # troque senhas e INGEST_TOKEN
chmod +x deploy/*.sh
APP_DIR=/opt/SisPro/sispro-plataforma \
WEB_SRC=/opt/SisPro/inventario_cfi_v3.5 \
bash deploy/vps-bootstrap.sh
```

Atualizar depois de um push no GitHub:

```bash
cd /opt/SisPro && git pull
cd sispro-plataforma
docker compose -f docker-compose.vps.yml --env-file .env up -d --build
```

## 4) SisPro no browser
⚙ Configurações → Conector:

- URL: `https://sispro.techartsolucoes.com.br/api`
- Cole o `INGEST_TOKEN` de `/opt/SisPro/sispro-plataforma/.env`
- Region ID: ex. `carajas` ou `local`
- **Publicar no Grafana**

## 5) Testes
```bash
curl -s https://sispro.techartsolucoes.com.br/api/health
curl -sI https://sispro-grafana.techartsolucoes.com.br/login
```

Grafana: `admin` + senha em `.env` (`GF_ADMIN_PASSWORD`).
