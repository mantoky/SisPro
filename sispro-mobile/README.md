# SisPro Mobile

App nativo **Android / iOS** (Capacitor) para cadastro local de sites em campo, com sincronização para o harness **SisPro** desktop.

## Escopo

- Login operacional + modo campo offline  
- CRUD de sites no aparelho  
- Fila de sync (pendente → SisPro)  
- UI responsiva com identidade visual CFI / harness  
- **Sem** mapa mental / editor CAD  

## Requisitos

- Node.js 18+  
- Android Studio (APK)  
- Xcode em macOS (IPA / App Store)  

## Desenvolvimento web

```bash
cd sispro-mobile
npm install
npm run dev
```

## Build nativo

```bash
npm install
npm run build
npx cap add android
npx cap add ios
npx cap sync
```

### Android (APK debug)

```bash
npm run apk:debug
```

APK gerado em:

`android/app/build/outputs/apk/debug/app-debug.apk`

Abrir no Android Studio:

```bash
npm run cap:android
```

> **Windows:** se o caminho tiver acentos (`Inventário`), o Gradle já tem `android.overridePathCheck=true`. Em CI, prefira um path só ASCII.

### iOS

O projeto nativo `ios/` já está no repositório. **Build/IPA exige macOS + Xcode** (e CocoaPods).

```bash
npm run cap:ios
```

No Mac: `pod install` em `ios/App` se necessário, depois Archive no Xcode.

## Firebase (projeto `sispro-e068c`)

1. No Console → Project settings → Your apps → Web → **Config**, copie o objeto.  
2. Cole `apiKey`, `messagingSenderId` e `appId` em `js/firebase-config.js` (troque os `PASTE_*`).  
3. Ative **Authentication → Email/Password** e crie um usuário de teste.  
4. Crie Firestore (região sugerida: `southamerica-east1`) e publique as regras:

```bash
npm i -g firebase-tools
firebase login
firebase use sispro-e068c
firebase deploy --only firestore:rules
```

Coleções usadas pelo APK (motor de injeção):

- `orgs/cfiservicos/sites/{siteId}` — metadados + árvore de ativos
- `orgs/cfiservicos/inbox/{eventId}` — envelope leve (subscription do desktop)
- `orgs/cfiservicos/rodadas/{rodadaId}`
- `orgs/cfiservicos/devices/{uid}`

No SisPro desktop (Chrome/Edge): ⚙ → **Escolher pasta SisPro_Data**. Documentos pesados ficam no disco (`sites/{CODIGO}/…`). Duplicidade de código abre popup (cancelar / abrir / cópia `_N`). Só o gestor conclui o prontuário.

## Rodada local + PDF

No detalhe do site → **PDF rodada**: gera PDF no estilo do prontuário SisPro (faixa verde CFI, dados do site, parecer, assinatura). No aparelho, abre o share sheet do Android.

## Sync com SisPro desktop

1. Sites salvos ficam `syncStatus: pending`.  
2. Com Firebase configurado + login online → `runSync()` grava no Firestore.  
3. Desktop importa `orgs/cfiservicos/sites`.  

Sem apiKey, o bundle fica em `localStorage.sispro_mobile_last_sync_bundle`.

## Identidade

Cores do harness: verde CFI (`#007a53` / `#063f31`) e acento safety `#FFCC00`.
