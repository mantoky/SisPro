# SisPro Platform — Ecossistema de Observabilidade e Liderança

Piloto multi-região da **CFI Serviços**: o SisPro (prontuário/campo) alimenta um **ecossistema** em que Grafana, cofre de arquivos e painéis de totem/TV compartilham o mesmo contrato de dados — sem acoplar a UI operacional a um único dashboard.

## Pedido refinado (escopo do piloto)

> Disponibilizar um **ambiente de plataforma** onde metadados de sites (hierarquia, status de prontuário, criticidade, região) de um ou mais projetos SisPro sejam publicados em um **modelo de dados navegável**. Sobre esse modelo, montar **dashboards Grafana interativos** e um **painel de liderança (totem/tablet → TV)** com UX amigável: o gestor escolhe a regional/área, seleciona um site e explora a hierarquia em tela grande, com interação por toque e leitura à distância. O desenho deve permitir que **outras equipes e regiões** adotem o mesmo ecossistema sem fork do núcleo.

## Princípios

| Princípio | Aplicação |
|---|---|
| Plataforma, não app isolado | Contratos versionados (`contracts/`) + ambientes (dev/piloto/prod) |
| SisPro = sistema de registro | Campo + gestor concluem prontuário; Grafana = leitura/análise |
| Disco = volume | Fotos/PDFs no `SisPro_Data`; Grafana não armazena blobs |
| Multi-tenant por região | `org_id` + `region_id` em todas as tabelas |
| UX de liderança | Tipografia grande, poucos cliques, modo TV/kiosk |

## Etapas recomendadas

### Fase 0 — Fundação (este repositório)
- [x] Contrato JSON de hierarquia / métricas de site  
- [x] Docker Compose: Postgres + Grafana (provisionado)  
- [x] Painel kiosk/TV no SisPro (`painel-lideranca.html`)  
- [ ] Seed SQL de piloto (1 região, N sites)

### Fase 1 — Integração SisPro → Postgres
- Export periódico (ou webhook) do envelope mobile/desktop → tabelas `sites`, `assets`, `prontuario_events`
- Job leve (script Node/Python) lendo Firestore inbox **ou** JSON do cofre `_inbox`

### Fase 2 — Dashboards Grafana
- Visão regional (mapa/tabela de sites, status, criticidade)  
- Drill-down site → contagem de ativos, conformidade, última sync  
- Variáveis Grafana: `org`, `region`, `site`

### Fase 3 — Totem / TV
- Tablet no totem abre o **Painel Liderança** (fullscreen)  
- HDMI/Cast para TV; gestos: toque largo, breadcrumb, “voltar ao mapa da região”  
- Autenticação simplificada (PIN regional ou usuário gestor)

### Fase 4 — Multi-região
- Novas regiões = novos `region_id` + pastas `SisPro_Data` + datasources Grafana  
- Playbook de onboarding para outras equipes CFI  

## Subir o ambiente Grafana (piloto)

Pré-requisito: Docker Desktop.

```bash
cd sispro-plataforma
docker compose up -d
```

- Grafana: http://localhost:3000 — login `admin` / `admin` (trocar no 1º acesso)  
- Postgres: `localhost:5432` — user/db `sispro` / senha `sispro_piloto`

Dashboards provisionados em `grafana/dashboards/`.

## Conector SisPro → Postgres / Grafana

Serviço HTTP na porta **3080** (`sispro-connector`).

```bash
cd sispro-plataforma
docker compose up -d --build
curl http://localhost:3080/health
```

No SisPro (Chrome): **☁ Publicar no Grafana** (Início) ou ⚙ → salvar URL/região → Publicar agora.

No Grafana, escolha a regional **`local`** (ou o `regionId` configurado) e atualize o dashboard (refresh).

CLI (arquivo JSON):

```bash
cd connector
npm install
DATABASE_URL=postgresql://sispro:sispro_piloto@localhost:5432/sispro node cli.js ../exemplo.json
```

## Painel de liderança (totem)

No harness SisPro, abra:

`inventario_cfi_v3.5/painel-lideranca.html`

Ou use o atalho **Painel liderança** na navegação. Ideal para tablet em modo paisagem espelhado na TV.

## Contrato de dados

Ver `contracts/site-telemetry.v1.json` — campos mínimos para Grafana e painel kiosk. Evoluções quebradoras sobem a versão (`v2`).
