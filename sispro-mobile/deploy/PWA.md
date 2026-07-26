# SisPro Mobile — PWA na VPS

URL: **https://sispro-app.techartsolucoes.com.br/**

## 1) DNS
Registro **A**: host `sispro-app` → IP da VPS (mesmo de `sispro` / apex).

## 2) Build local (Windows)

```powershell
cd "D:\APPs\Inventário LTE\inventario_cfi_v3.5_Integridade_Operacional\sispro-mobile"
npm install
npm run build
```

Saída: pasta `dist/`.

## 3) Firebase — domínio autorizado
Console → Authentication → Settings → **Authorized domains** → adicionar:

`sispro-app.techartsolucoes.com.br`

## 4) Na VPS (após `git pull` em `/opt/SisPro`)

```bash
# Se o código já está no monorepo:
cd /opt/SisPro/sispro-mobile
# Build na VPS (Node 20+):
npm install
npm run build

sudo mkdir -p /var/www/sispro-app
sudo rsync -a --delete dist/ /var/www/sispro-app/

sudo cp deploy/nginx-sispro-app.conf /etc/nginx/sites-available/sispro-app.techartsolucoes.com.br
sudo ln -sfn /etc/nginx/sites-available/sispro-app.techartsolucoes.com.br /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

sudo certbot --nginx -d sispro-app.techartsolucoes.com.br
```

Alternativa: build no PC e enviar só o `dist/`:

```bash
# na VPS
sudo mkdir -p /var/www/sispro-app
# do PC (quando SSH ok): scp -r dist/* root@VPS:/var/www/sispro-app/
```

## 5) Card no apex techartsolucoes.com.br

```bash
cd /opt/SisPro/sispro-mobile
sudo bash deploy/add_techart_card.sh
```

Ou cole o HTML de `deploy/techart-card.html` no `index.html` do apex (seção `.bento`).

## 6) Teste
- Abrir https://sispro-app.techartsolucoes.com.br/
- Login e-mail/senha → sync
- Chrome/Android: **Instalar app** / Adicionar à tela inicial
- Card em https://techartsolucoes.com.br/ (LOADOUT → SisPro Mobile)

## Relação com desktop / Grafana
| URL | Função |
|-----|--------|
| sispro-app… | PWA campo (este app) |
| sispro… | Inventário desktop + API |
| sispro-grafana… | Dashboards |
