/* SisPro → Connector Postgres/Grafana */

const PLATFORM_SYNC_KEY = "cfi_sispro_platform_sync";

function platformSyncDefaults() {
  return {
    connectorUrl: "http://localhost:3080",
    orgId: "cfiservicos",
    regionId: "local",
    regionNome: "Ambiente local",
    regionCodigo: "LOCAL",
    ingestToken: "",
  };
}

function platformSyncLoad() {
  try {
    const raw = localStorage.getItem(PLATFORM_SYNC_KEY);
    if (!raw) return platformSyncDefaults();
    return { ...platformSyncDefaults(), ...JSON.parse(raw) };
  } catch {
    return platformSyncDefaults();
  }
}

function platformSyncSave(cfg) {
  localStorage.setItem(PLATFORM_SYNC_KEY, JSON.stringify(cfg));
}

function platformBuildPayload(sitesList) {
  const cfg = platformSyncLoad();
  const sites = (sitesList || state.sites || []).map((s) => {
    const items = Array.isArray(s.items) ? s.items : [];
    return {
      id: s.id,
      codigo: s.codigo,
      nome: s.nome,
      criticidade: s.criticidade || "",
      statusOperacional: s.statusOperacional || "",
      prontuarioStatus: s.prontuarioStatus || "rascunho",
      localInstalacao: s.localInstalacao || "",
      centroTrabalho: s.centroTrabalho || "",
      latitude: s.latitude || "",
      longitude: s.longitude || "",
      itensCount: items.length,
      items,
    };
  });

  return {
    schemaVersion: "1.0.0",
    orgId: cfg.orgId,
    regionId: cfg.regionId,
    regionNome: cfg.regionNome,
    regionCodigo: cfg.regionCodigo,
    exportedAt: typeof nowIso === "function" ? nowIso() : new Date().toISOString(),
    sites,
  };
}

async function platformPublishToGrafana(opts = {}) {
  const cfg = platformSyncLoad();
  const url = (opts.url || cfg.connectorUrl || "http://localhost:3080").replace(/\/$/, "");
  const onlyActive = !!opts.onlyActive;
  const list = onlyActive && typeof activeSite === "function" && activeSite()
    ? [activeSite()]
    : state.sites || [];

  if (!list.length) {
    toast("Nenhum site para publicar.", "error");
    return { ok: false };
  }

  const payload = platformBuildPayload(list);
  const headers = { "Content-Type": "application/json" };
  if (cfg.ingestToken) headers["X-Ingest-Token"] = cfg.ingestToken;

  toast("Publicando no Grafana/Postgres…");
  try {
    const res = await fetch(`${url}/ingest`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      throw new Error(data.error || `HTTP ${res.status}`);
    }
    toast(`Publicado: ${data.sites} site(s), ${data.assets} ativo(s). Atualize o Grafana.`);
    if (typeof recordAudit === "function") {
      recordAudit("SYNC", "platform", "grafana", `Publicados ${data.sites} site(s) → ${cfg.regionId}`);
    }
    return data;
  } catch (err) {
    const msg = err?.message || String(err);
    toast(
      msg.includes("Failed to fetch")
        ? "Conector indisponível. Suba: docker compose up -d (porta 3080)."
        : `Falha na publicação: ${msg}`,
      "error"
    );
    return { ok: false, error: msg };
  }
}

function platformSyncFillSettingsForm() {
  const cfg = platformSyncLoad();
  const set = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.value = val ?? "";
  };
  set("platformConnectorUrl", cfg.connectorUrl);
  set("platformOrgId", cfg.orgId);
  set("platformRegionId", cfg.regionId);
  set("platformRegionNome", cfg.regionNome);
  set("platformRegionCodigo", cfg.regionCodigo);
  set("platformIngestToken", cfg.ingestToken);
}

function platformSyncSaveFromSettings() {
  const get = (id) => document.getElementById(id)?.value?.trim() || "";
  const cfg = {
    connectorUrl: get("platformConnectorUrl") || "http://localhost:3080",
    orgId: get("platformOrgId") || "cfiservicos",
    regionId: get("platformRegionId") || "local",
    regionNome: get("platformRegionNome") || "Ambiente local",
    regionCodigo: get("platformRegionCodigo") || "LOCAL",
    ingestToken: get("platformIngestToken"),
  };
  platformSyncSave(cfg);
  toast("Configuração do conector salva.");
}
