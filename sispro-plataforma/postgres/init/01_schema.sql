-- SisPro Platform — schema piloto (multi-região)
-- org_id + region_id em todas as entidades de negócio

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS orgs (
  org_id        TEXT PRIMARY KEY,
  nome          TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS regions (
  region_id     TEXT NOT NULL,
  org_id        TEXT NOT NULL REFERENCES orgs(org_id),
  nome          TEXT NOT NULL,
  codigo        TEXT NOT NULL,
  PRIMARY KEY (org_id, region_id)
);

CREATE TABLE IF NOT EXISTS sites (
  site_id              TEXT PRIMARY KEY,
  org_id               TEXT NOT NULL REFERENCES orgs(org_id),
  region_id            TEXT NOT NULL,
  codigo               TEXT NOT NULL,
  nome                 TEXT NOT NULL,
  criticidade          TEXT,
  status_operacional   TEXT,
  prontuario_status    TEXT,
  local_instalacao     TEXT,
  centro_trabalho      TEXT,
  latitude             TEXT,
  longitude            TEXT,
  itens_count          INT NOT NULL DEFAULT 0,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, codigo)
);

CREATE TABLE IF NOT EXISTS assets (
  asset_id      TEXT PRIMARY KEY,
  site_id       TEXT NOT NULL REFERENCES sites(site_id) ON DELETE CASCADE,
  org_id        TEXT NOT NULL,
  region_id     TEXT NOT NULL,
  parent_id     TEXT,
  nome          TEXT NOT NULL,
  categoria     TEXT,
  tipo          TEXT,
  criticidade   TEXT,
  depth         INT NOT NULL DEFAULT 0,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sites_region ON sites (org_id, region_id);
CREATE INDEX IF NOT EXISTS idx_assets_site ON assets (site_id);
CREATE INDEX IF NOT EXISTS idx_assets_parent ON assets (parent_id);

-- Seed piloto CFI
INSERT INTO orgs (org_id, nome) VALUES ('cfiservicos', 'CFI Serviços')
ON CONFLICT DO NOTHING;

INSERT INTO regions (region_id, org_id, nome, codigo) VALUES
  ('carajas', 'cfiservicos', 'Regional Carajás', 'LTE-CAR'),
  ('piloto', 'cfiservicos', 'Regional Piloto', 'LTE-PIL')
ON CONFLICT DO NOTHING;

INSERT INTO sites (
  site_id, org_id, region_id, codigo, nome, criticidade,
  status_operacional, prontuario_status, local_instalacao, centro_trabalho,
  latitude, longitude, itens_count
) VALUES
  (
    'seed-lte-ma01', 'cfiservicos', 'carajas', 'LTE-MA01', 'LTE MORRO ALFA',
    'Alta', 'Operacional', 'em_campo', 'FECJ-APD-TEL-REDTI-AB_16', 'LTE-CAR',
    '-6.080000', '-50.150000', 12
  ),
  (
    'seed-lte-mb02', 'cfiservicos', 'carajas', 'LTE-MB02', 'LTE MORRO BETA',
    'Média', 'Em implantação', 'rascunho', 'FECJ-APD-TEL-REDTI-AB_17', 'LTE-CAR',
    '-6.090000', '-50.160000', 4
  )
ON CONFLICT DO NOTHING;

INSERT INTO assets (asset_id, site_id, org_id, region_id, parent_id, nome, categoria, tipo, criticidade, depth)
VALUES
  ('a-root-ma01', 'seed-lte-ma01', 'cfiservicos', 'carajas', NULL, 'SITE LTE MORRO ALFA', 'Site', 'Raiz', 'Crítica', 0),
  ('a-energia', 'seed-lte-ma01', 'cfiservicos', 'carajas', 'a-root-ma01', 'Sistema de Energia', 'Energia', 'Sistema', 'Crítica', 1),
  ('a-qta', 'seed-lte-ma01', 'cfiservicos', 'carajas', 'a-energia', 'QTA', 'Energia AC', 'Transferência Automática', 'Crítica', 2),
  ('a-lte', 'seed-lte-ma01', 'cfiservicos', 'carajas', 'a-root-ma01', 'LTE / eNode-B', 'LTE', 'eNode-B', 'Crítica', 1),
  ('a-torre', 'seed-lte-ma01', 'cfiservicos', 'carajas', 'a-root-ma01', 'Torre Autoportante 42m', 'Estrutura Vertical', 'Torre', 'Crítica', 1)
ON CONFLICT DO NOTHING;
