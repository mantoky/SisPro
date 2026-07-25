# SisPro — Status e pendências

Atualizado: 2026-07-25

## Em produção (VPS)

| Item | URL / caminho |
|------|----------------|
| App web | https://sispro.techartsolucoes.com.br |
| Grafana | https://sispro-grafana.techartsolucoes.com.br |
| API health | `curl -s https://sispro.techartsolucoes.com.br/api/health` |
| Código na VPS | `/opt/SisPro` (clone SSH Deploy Key) |
| Plataforma | `/opt/SisPro/sispro-plataforma` |
| `.env` (senhas) | `/opt/SisPro/sispro-plataforma/.env` — **não versionar** |
| Deploy Key doc | `sispro-plataforma/deploy/GITHUB_SSH.md` |

Repo GitHub: https://github.com/mantoky/SisPro

---

## Android APK

| Item | Valor |
|------|--------|
| Status | Gerado (debug) |
| Comando | `cd sispro-mobile && npm run apk:debug` |
| Caminho | `sispro-mobile/android/app/build/outputs/apk/debug/app-debug.apk` |
| Release Play Store | Pendente (keystore + `npm run apk:release`) |

---

## iOS IPA — PENDENTE

**Bloqueio:** build de IPA exige **macOS + Xcode + CocoaPods**. Não é possível gerar no Windows.

### Caminho para finalizar

1. Copiar/clonar o monorepo em um Mac (ou CI macOS).
2. Instalar dependências:

```bash
cd sispro-mobile
npm install
npm run build
npx cap sync ios
cd ios/App && pod install && cd ../..
npx cap open ios
```

3. No Xcode:
   - Selecionar Team / Bundle ID `br.com.cfiservicos.sispro`
   - **Product → Archive**
   - **Distribute App** (Ad Hoc / TestFlight / App Store)

4. Projeto nativo já existe em: `sispro-mobile/ios/`

---

## Sync Mobile ↔ Plataforma

### Fluxo correto

```
Mobile (login e-mail/senha Firebase)
  → Firestore orgs/cfiservicos/sites + inbox
  → Desktop importa inbox / sites
  → Desktop "☁ Publicar no Grafana" → connector VPS → Postgres
```

### Erro "Missing or insufficient permissions" (lido como “Perdido / Permissão insuficiente”)

Causas típicas:

1. Login em **modo campo (offline)** — não há Firebase Auth → sync negado.
2. Regras Firestore **não publicadas** no projeto `sispro-e068c`.
3. Sessão “online” antiga sem `auth.currentUser` válido.

### Checklist Firebase

```bash
cd sispro-mobile
firebase login
firebase use sispro-e068c
firebase deploy --only firestore:rules
```

Console: Authentication → Email/Password **ativado** + usuário técnico criado.

### O que o app faz agora

- Bloqueia sync em modo campo e mostra mensagem em português.
- Exige `auth.currentUser` antes de gravar no Firestore.
- Após criar site, abre hierarquia de ativos (+ template telecom opcional).

---

## Hierarquia no Mobile

- Espelho do desktop: `items[]` pai → filho.
- Na criação do site: opção **“Criar hierarquia padrão telecom”**.
- Depois: Detalhe → **Ativos / camadas** (ou automático após salvar novo site).
- Raiz alinhada ao desktop: `SITE {nome}` · categoria `Raiz` · tipo `Site Telecom`.

---

## Próximos itens (backlog)

- [ ] Listener Firestore no desktop (inbox automático)
- [ ] Job Firestore → Postgres (sem depender do botão desktop)
- [ ] IPA iOS (Mac)
- [ ] APK release assinado
