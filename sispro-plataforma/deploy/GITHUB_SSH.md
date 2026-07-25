# Deploy Key SSH — repo `mantoky/SisPro`

Chave **só deste repositório** (Deploy Key), preferencialmente gerada **na VPS**.

## 1) Na VPS — gerar chave

Se o repo ainda não estiver clonado via HTTPS/outro meio, rode o script a partir de um clone temporário ou copie só a pasta `deploy/`:

```bash
# Opção A: já tem o código em /opt/SisPro
cd /opt/SisPro/sispro-plataforma
bash deploy/setup-github-deploy-key.sh

# Opção B: só o script (cole o arquivo e execute)
bash setup-github-deploy-key.sh
```

O script:
- cria `~/.ssh/id_ed25519_sispro` (+ `.pub`)
- adiciona host alias `github.com-sispro` em `~/.ssh/config`

## 2) GitHub — cadastrar chave pública

1. Abra: https://github.com/mantoky/SisPro/settings/keys  
2. **Add deploy key**
   - **Title:** `vps-sispro`
   - **Key:** cole o conteúdo de `id_ed25519_sispro.pub`
   - **Allow write access:** desmarcado (somente `git pull` / clone)

## 3) Testar

```bash
ssh -T git@github.com-sispro
# esperado: Hi mantoky/SisPro! You've successfully authenticated...
```

## 4) Clonar / atualizar

```bash
# primeiro clone
git clone git@github.com-sispro:mantoky/SisPro.git /opt/SisPro

# se já clonou por HTTPS, trocar remote:
cd /opt/SisPro
git remote set-url origin git@github.com-sispro:mantoky/SisPro.git
git pull
```

## 5) Bootstrap (depois do .env)

```bash
cd /opt/SisPro/sispro-plataforma
cp -n .env.example .env
nano .env
chmod +x deploy/vps-bootstrap.sh
APP_DIR=/opt/SisPro/sispro-plataforma \
WEB_SRC=/opt/SisPro/inventario_cfi_v3.5 \
bash deploy/vps-bootstrap.sh
```

## Windows (opcional)

No PC:

```powershell
cd "...\sispro-plataforma\deploy"
.\setup-github-deploy-key.ps1
```

Use a `.pub` como Deploy Key **ou** como chave da sua conta GitHub (Settings → SSH keys).  
**Não** commite a chave privada.
