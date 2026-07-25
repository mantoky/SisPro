/* ==========================================================================
   CFI Serviços — mm-engine.js
   Harness do Mapa Mental (EAM / grafos hierárquicos)
   --------------------------------------------------------------------------
   Single Source of Truth: state.sites[].items (lista plana parentId).
   O canvas e o Explorer consomem a mesma árvore; toda mutação passa por
   state.js (addItem / moveItemParent / atributos) e dispara renderAll().

   Identidade visual do editor: Vale Industrial
   - Charcoal #2F2F2F · Branco #FFFFFF · Aptos Narrow
   Preparado para persistência Firebase (offline) — contrato em exportTreeSchema.
   ========================================================================== */

const MM_VALE = {
  charcoal: "#2F2F2F",
  charcoalDeep: "#1E1E1E",
  charcoalMid: "#3A3A3A",
  safety: "#FFFFFF",
  safetyDim: "#D0D0D0",
  text: "#F2F2F2",
  muted: "#A8A8A8",
  edge: "#6B6B6B",
  nodeFill: "#3A3A3A",
  danger: "#E53935",
  ok: "#43A047",
};

const MM_ASSET_KEYS = {
  tag: "TAG",
  fabricante: "Fabricante",
  status: "Status Operacional",
  valor: "Valor Depreciado",
};

const MM_STATUS_OPS = [
  "Operacional",
  "Operacional com restrição",
  "Em manutenção",
  "Indisponível",
  "Desativado",
  "Em implantação",
];

/** Preferências de aparência do canvas (persistidas localmente). */
const MM_PREFS_KEY = "cfi_mm_engine_prefs";
const MM_PREFS_DEFAULT = {
  tema: "vale",          // "vale" | "claro"
  tamNo: "normal",       // "compacto" | "normal" | "grande"
  conector: "curva",     // "curva" | "reta"
  grade: true,
  mostrarMeta: true,
  mostrarBadge: true,
  mostrarIcone: true,
  mostrarPath: true,
};

let mmEnginePrefs = mmEngineLoadPrefs();

function mmEngineLoadPrefs() {
  try {
    const raw = localStorage.getItem(MM_PREFS_KEY);
    if (!raw) return { ...MM_PREFS_DEFAULT };
    return { ...MM_PREFS_DEFAULT, ...JSON.parse(raw) };
  } catch (e) {
    return { ...MM_PREFS_DEFAULT };
  }
}

function mmEngineSavePrefs() {
  try { localStorage.setItem(MM_PREFS_KEY, JSON.stringify(mmEnginePrefs)); } catch (e) { /* quota */ }
}

function mmEngineSetPref(chave, valor) {
  mmEnginePrefs[chave] = valor;
  mmEngineSavePrefs();
  if (typeof mmSyncEnginePrefsUI === "function") mmSyncEnginePrefsUI();
  if (typeof mmEnsureBuilt === "function") {
    mmEnsureBuilt(true);
    if (typeof mmDrawFull === "function") mmDrawFull();
  }
}

function mmEngineResetPrefs() {
  mmEnginePrefs = { ...MM_PREFS_DEFAULT };
  mmEngineSavePrefs();
  if (typeof mmSyncEnginePrefsUI === "function") mmSyncEnginePrefsUI();
  if (typeof mmEnsureBuilt === "function") {
    mmEnsureBuilt(true);
    if (typeof mmDrawFull === "function") mmDrawFull();
  }
  if (typeof toast === "function") toast("Aparência restaurada (Vale Industrial Safety).");
}

function mmEngineLayoutOpts() {
  const map = {
    compacto: { nodeW: 158, nodeH: 52, rowH: 68, levelGap: 210 },
    normal:   { nodeW: 200, nodeH: 64, rowH: 84, levelGap: 250 },
    grande:   { nodeW: 244, nodeH: 76, rowH: 98, levelGap: 290 },
  };
  return map[mmEnginePrefs.tamNo] || map.normal;
}

function mmEngineTheme() {
  if (mmEnginePrefs.tema === "claro") {
    return {
      bg: "#f4f8f6",
      nodeFill: "#ffffff",
      text: "#18332b",
      meta: "#687b73",
      edge: "#a9d2c4",
      accent: "#007a53",
      badge: "#0a5f9e",
      grid: "rgba(0,0,0,.05)",
      rootText: "#ffffff",
    };
  }
  return {
    bg: MM_VALE.charcoalDeep,
    nodeFill: MM_VALE.nodeFill,
    text: MM_VALE.text,
    meta: MM_VALE.muted,
    edge: MM_VALE.edge,
    accent: MM_VALE.safety,
    badge: MM_VALE.safetyDim,
    grid: "rgba(255,255,255,.08)",
    rootText: MM_VALE.charcoal,
  };
}

/* ── Sanitização de metadados (anti-injeção / limites) ───────────────────── */

function mmSanitizeText(value, max = 200) {
  return String(value ?? "")
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .replace(/[<>]/g, "")
    .trim()
    .slice(0, max);
}

function mmSlug(s) {
  return mmSanitizeText(s, 80)
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "no";
}

/* ── Path hierárquico (site/grupo/equip/...) ──────────────────────────────── */

function itemPathSegments(itemId, site = null) {
  const s = site || activeSite();
  if (!s) return [];
  const byId = new Map((s.items || []).map((i) => [i.id, i]));
  const parts = [];
  let cur = byId.get(itemId);
  const guard = new Set();
  while (cur && !guard.has(cur.id)) {
    guard.add(cur.id);
    parts.unshift(mmSlug(cur.nome));
    cur = cur.parentId ? byId.get(cur.parentId) : null;
  }
  parts.unshift(mmSlug(s.codigo || s.nome));
  return parts;
}

function itemPath(itemId, site = null) {
  return itemPathSegments(itemId, site).join("/");
}

/* ── Metadados de ativo (atributos padronizados) ──────────────────────────── */

function getAssetMeta(item) {
  const a = (item && item.atributos) || {};
  return {
    tag: mmSanitizeText(a[MM_ASSET_KEYS.tag], 80),
    fabricante: mmSanitizeText(a[MM_ASSET_KEYS.fabricante], 120),
    statusOperacional: MM_STATUS_OPS.includes(a[MM_ASSET_KEYS.status])
      ? a[MM_ASSET_KEYS.status]
      : "Operacional",
    valorDepreciado: mmSanitizeText(a[MM_ASSET_KEYS.valor], 40),
  };
}

function setAssetMeta(item, meta) {
  if (!item) return;
  item.atributos = item.atributos || {};
  item.atributos[MM_ASSET_KEYS.tag] = mmSanitizeText(meta.tag, 80);
  item.atributos[MM_ASSET_KEYS.fabricante] = mmSanitizeText(meta.fabricante, 120);
  item.atributos[MM_ASSET_KEYS.status] = MM_STATUS_OPS.includes(meta.statusOperacional)
    ? meta.statusOperacional
    : "Operacional";
  item.atributos[MM_ASSET_KEYS.valor] = mmSanitizeText(meta.valorDepreciado, 40);
}

/** Herda categoria/tipo/criticidade e Fabricante do pai (desenho técnico). */
function inheritFromParent(child, parent) {
  if (!child || !parent) return;
  child.categoria = parent.categoria || child.categoria;
  child.tipo = parent.tipo || child.tipo;
  child.criticidade = parent.criticidade || child.criticidade;
  child.atributos = child.atributos || {};
  const fab = parent.atributos && parent.atributos[MM_ASSET_KEYS.fabricante];
  if (fab && !child.atributos[MM_ASSET_KEYS.fabricante]) {
    child.atributos[MM_ASSET_KEYS.fabricante] = fab;
  }
  if (!child.atributos[MM_ASSET_KEYS.status]) {
    child.atributos[MM_ASSET_KEYS.status] = "Operacional";
  }
}

/* ── Ícones Explorer (só pasta — evita catálogo pesado de pictogramas) ───── */

function assetIconFor(_item) {
  return "📁";
}

/* ── Schema JSON recursivo (contrato Explorer / Firebase) ───────────────────
   Exporta a árvore do site ativo no formato few-shot do harness:
   { id, label, type, path, meta, children: [...] }
   type heurístico: site | group | equipment | component | asset */

function mmInferNodeType(item, depth) {
  if (item.parentId === null || depth === 0) return "site";
  const blob = `${item.categoria} ${item.tipo}`.toLowerCase();
  if (blob.includes("grupo") || blob.includes("sistema")) return "group";
  if (blob.includes("equip") || blob.includes("qta") || blob.includes("rru") || blob.includes("enodeb")) return "equipment";
  if (blob.includes("componente") || blob.includes("módulo") || blob.includes("placa")) return "component";
  if (depth >= 3) return "asset";
  return "equipment";
}

function exportTreeSchema(site = null) {
  const s = site || activeSite();
  if (!s) return null;
  const itens = s.items || [];
  const raiz = itens.find((i) => i.parentId === null);
  if (!raiz) return null;

  function nodeFrom(item, depth) {
    const meta = getAssetMeta(item);
    return {
      id: item.id,
      label: item.nome,
      type: mmInferNodeType(item, depth),
      path: itemPath(item.id, s),
      categoria: item.categoria,
      tipo: item.tipo,
      criticidade: item.criticidade,
      meta,
      children: itens
        .filter((c) => c.parentId === item.id)
        .map((c) => nodeFrom(c, depth + 1)),
    };
  }
  return {
    schema: "cfi.eam.tree/v1",
    site: { id: s.id, codigo: s.codigo, nome: s.nome },
    gerado_em: new Date().toISOString(),
    arvore: nodeFrom(raiz, 0),
  };
}

/* ── Sync bidirecional: foco compartilhado Canvas ↔ Explorer ─────────────── */

function mmIsEditorOpen() {
  const el = document.getElementById("mindMapModalBackdrop");
  return !!(el && el.classList.contains("active"));
}

/** Expande o Explorer até o item e marca seleção (sem mudar de view). */
function explorerRevealItem(itemId) {
  if (!itemId || typeof _explorerExpanded === "undefined") return;
  const s = activeSite();
  if (!s) return;
  _explorerExpanded.add(s.id);
  let cur = (s.items || []).find((i) => i.id === itemId);
  const guard = new Set();
  while (cur && !guard.has(cur.id)) {
    guard.add(cur.id);
    _explorerExpanded.add(cur.id);
    if (cur.parentId) {
      const p = (s.items || []).find((i) => i.id === cur.parentId);
      if (p) _explorerExpanded.add(p.id);
      cur = p;
    } else break;
  }
  if (typeof renderSidebarTree === "function") renderSidebarTree();
}

/**
 * Fonte única de seleção: atualiza selectedItemId, foco do mapa e Explorer.
 * @param {string} itemId
 * @param {{ fromCanvas?: boolean, fromExplorer?: boolean }} opts
 */
function syncFocusItem(itemId, opts = {}) {
  if (!itemId) return;
  if (typeof setSelectedId === "function") setSelectedId(itemId);
  else if (typeof selectItem === "function" && !opts.fromExplorer) {
    /* selectItem pode abrir painéis — no sync fino preferimos setSelectedId */
  }
  if (typeof _mmFocusId !== "undefined") _mmFocusId = itemId;

  explorerRevealItem(itemId);

  if (mmIsEditorOpen()) {
    if (typeof mmUpdatePropPanel === "function") mmUpdatePropPanel();
    const svg = document.querySelector("#mindMapFull svg");
    if (svg && typeof mmHighlightFocus === "function") mmHighlightFocus(svg, itemId);
    // se a mutação veio do Explorer com o editor aberto, redesenha o anel sem fechar
    if (opts.fromExplorer && typeof mmDrawFull === "function" && !opts.skipRedraw) {
      /* só realça — draw completo é caro; highlight basta */
    }
  }
}
