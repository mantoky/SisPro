# SisPro

Sistema de Prontuário de Sites — ecossistema completo.

| Pasta | Conteúdo |
|-------|----------|
| `inventario_cfi_v3.5/` | App desktop (inventário / mind map / painel) |
| `sispro-mobile/` | App mobile (Capacitor) |
| `sispro-plataforma/` | Postgres + Grafana + connector + deploy VPS |

## Status e pendências

Ver **[STATUS.md](./STATUS.md)** — VPS, APK Android, **IPA iOS (pendente / Mac)**, sync Firebase, hierarquia mobile.

## Deploy VPS

1. Deploy Key SSH: `sispro-plataforma/deploy/GITHUB_SSH.md`
2. Checklist: `sispro-plataforma/deploy/VPS.md`
3. Health: `curl -s https://sispro.techartsolucoes.com.br/api/health`
