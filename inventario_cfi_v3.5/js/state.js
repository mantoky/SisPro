/* ==========================================================================
   CFI Serviços — Inventário Inteligente de Sites Telecom
   state.js — Estado da aplicação, persistência e modelo de dados
   ==========================================================================
   v2 — MUDANÇAS DESTA VERSÃO:
   - MULTI-SITE: o estado agora guarda uma lista de sites; cada site tem
     seus próprios itens e item selecionado. Há migração automática de
     dados v1 (site único) para v2 (lista de sites), sem perda.
   - Dependências referenciam o ID real do item relacionado (não nome).
   - Detecção de ciclo no grafo de dependências (criaDependenciaCiclo()).
   - Itens podem ter evidências fotográficas (array `fotos` em base64).

   v3 — MATRIZ DE EVOLUÇÃO (rodada de maturidade):
   - APP_VERSION: fonte única da versão exibida na UI (antes a barra
     lateral e o LEIA-ME divergiam — "v1.1" vs "Versão 2").
   - state.meta.changesSinceBackup: contador persistido que alimenta o
     lembrete de backup (ver report.js / exportJSON()).
   - calcularUsoArmazenamento(): estimativa de uso do localStorage, para
     avisar ANTES do erro de cota (fotos em base64 enchem rápido).
   - removeSiteFromState(): primitiva de exclusão de site (não existia
     nenhuma forma de remover um site criado por engano/duplicado).
   ========================================================================== */

const APP_VERSION = "3.5";
const STORAGE_KEY = "cfi_inventario_v1"; // mantido para ler dados antigos
const STORAGE_KEY_V2 = "cfi_inventario_v2";
const AUTOSAVE_DEBOUNCE_MS = 600;
const SCHEMA_VERSION = 3;
const STORAGE_SOFT_LIMIT_BYTES = 4.5 * 1024 * 1024; // aviso preventivo (cota típica ~5MB)
const BACKUP_REMINDER_THRESHOLD = 20; // alterações desde o último export até sugerir backup
const MAX_AUDIT_ENTRIES = 500;

/* Tetos de robustez (mesmos limites de prepararItensMapaMental) — evitam
 * stack overflow e negação por arquivo profundo na importação de backup. */
const MAX_ITENS_SITE = 5000;
const MAX_PROFUNDIDADE = 100;

let state = {
  version: SCHEMA_VERSION,
  activeSiteId: null,
  sites: [],
  meta: {
    changesSinceBackup: 0,
    currentUser: { id: "local-editor", nome: "Técnico Inspetor", perfil: "Editor Técnico" },
    auditLog: [],
  },
};

let _autosaveTimer = null;
let _changeTrackingSuspended = false;
let _auditSuspended = false;

/* ── Identificadores ──────────────────────────────────────────────────── */

function uid() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
}

function nowIso() {
  return new Date().toISOString();
}

/** Trilha local de alterações. Não substitui auditoria imutável de servidor,
 *  mas permite rastrear a evolução do prontuário durante a fase standalone. */
function recordAudit(action, entityType, entityId, detail, site = activeSite()) {
  if (_auditSuspended) return;
  state.meta = state.meta || {};
  state.meta.auditLog = Array.isArray(state.meta.auditLog) ? state.meta.auditLog : [];
  const user = state.meta.currentUser || { id: "local-editor", nome: "Técnico Inspetor", perfil: "Editor Técnico" };
  state.meta.auditLog.unshift({
    id: uid(),
    timestamp: nowIso(),
    userId: user.id,
    userName: user.nome,
    profile: user.perfil,
    action,
    entityType,
    entityId,
    siteId: site?.id || null,
    siteCode: site?.codigo || "—",
    detail: String(detail || ""),
  });
  state.meta.auditLog = state.meta.auditLog.slice(0, MAX_AUDIT_ENTRIES);
}

/* ── Acesso ao site ativo ─────────────────────────────────────────────── */

function activeSite() {
  return state.sites.find((s) => s.id === state.activeSiteId) || state.sites[0] || null;
}

/** Lista de itens do site ativo (substitui o antigo state.items global). */
function activeItems() {
  const s = activeSite();
  return s ? s.items : [];
}

function setActiveSite(siteId) {
  if (state.sites.some((s) => s.id === siteId)) {
    state.activeSiteId = siteId;
    scheduleAutosave();
  }
}

/** ID do item selecionado no site ativo (substitui o antigo state.selectedItemId). */
function selectedId() {
  const s = activeSite();
  return s ? s.selectedItemId : null;
}

function setSelectedId(id) {
  const s = activeSite();
  if (s) s.selectedItemId = id;
}

/* ── Drill-down hierárquico (mobile-first) ───────────────────────────────
   O técnico em campo navega a árvore NÍVEL a NÍVEL (drill-down), em vez de
   ver a árvore inteira aninhada (que espreme os nós contra a borda no
   celular). `focusItemId` é o item cujos FILHOS estão sendo exibidos no
   momento. Começa na raiz do site. Subir/descer é só mudar o foco. */

/** ID da raiz (item sem pai) do site ativo. */
function rootItemId() {
  const r = activeItems().find((i) => i.parentId === null);
  return r ? r.id : null;
}

/** ID do nível atual do drill-down (sempre cai num item válido; padrão = raiz). */
function focusItemId() {
  const s = activeSite();
  if (!s) return null;
  const f = s.focusItemId;
  if (f && findItemById(f)) return f;
  return rootItemId();
}

/** Muda o nível do drill-down. Ignora IDs inválidos. Navegação não conta
 *  como alteração para o lembrete de backup (suspende o tracking). */
function setFocusItem(id) {
  const s = activeSite();
  if (!s) return;
  if (id && findItemById(id)) s.focusItemId = id;
  else s.focusItemId = rootItemId();
  _changeTrackingSuspended = true;
  scheduleAutosave();
  _changeTrackingSuspended = false;
}

/** Caminho da raiz até um item (array de itens, raiz → item). Vazio se não achar. */
function pathToItem(itemId) {
  const path = [];
  let cur = itemId ? findItemById(itemId) : null;
  const guard = new Set();
  while (cur && !guard.has(cur.id)) {
    guard.add(cur.id);
    path.unshift(cur);
    cur = cur.parentId ? findItemById(cur.parentId) : null;
  }
  return path;
}

function createSite(nome, codigo, criticidade, lat, lng, resumo, localInstalacao = "", centroTrabalho = "", statusOperacional = "Operacional") {
  const site = {
    id: uid(),
    nome, codigo, criticidade,
    latitude: lat, longitude: lng, resumo,
    localInstalacao,
    centroTrabalho,
    statusOperacional,
    prontuarioStatus: "rascunho", // rascunho|em_campo|enviado_pelo_tecnico|em_revisao|concluido|devolvido_campo
    createdAt: nowIso(),
    updatedAt: nowIso(),
    selectedItemId: null,
    focusItemId: null, // drill-down (navegação hierárquica mobile): nível atual exibido
    circuitos: [],     // endereçamento de circuito físico (caminho ordenado origem→destino)
    links: [],         // links CAD entre grafos (extremidades com metadados)
    items: [],
  };
  state.sites.push(site);
  state.activeSiteId = site.id;
  recordAudit("CREATE", "site", site.id, `Site ${site.codigo} criado.`, site);
  scheduleAutosave();
  return site;
}

/** true se outro site (id diferente de ignorarId) já usa esse código.
 *  Usado na validação do formulário — o código vira nome de arquivo em
 *  TODOS os exports (PDF/Excel/JSON/mapa mental), então duplicar é risco
 *  real de um site sobrescrever o arquivo exportado do outro. */
function codigoJaExiste(codigo, ignorarId) {
  const c = String(codigo || "").trim().toLowerCase();
  if (!c) return false;
  return state.sites.some((s) => s.id !== ignorarId && String(s.codigo || "").trim().toLowerCase() === c);
}

/** Remove um site do estado. Bloqueia a remoção do último site restante
 *  (o app sempre precisa de ao menos um site ativo). Se o removido era o
 *  ativo, promove outro site da lista a ativo. Retorna {ok, motivo}. */
function removeSiteFromState(siteId) {
  if (state.sites.length <= 1) {
    return { ok: false, motivo: "Não é possível excluir o único site cadastrado." };
  }
  const idx = state.sites.findIndex((s) => s.id === siteId);
  if (idx === -1) return { ok: false, motivo: "Site não encontrado." };

  const removido = state.sites[idx];
  recordAudit("DELETE", "site", removido.id, `Site ${removido.codigo} excluído com ${removido.items.length} item(ns).`, removido);
  state.sites.splice(idx, 1);
  if (state.activeSiteId === siteId) {
    state.activeSiteId = state.sites[0].id;
  }
  scheduleAutosave();
  return { ok: true };
}

/* ── CRUD de itens (operam sobre o site ativo) ─────────────────────────── */

function addItem(nome, categoria, tipo, criticidade, parentId, descricao) {
  const site = activeSite();
  if (!site) return null;
  const item = {
    id: uid(),
    parentId,
    nome, categoria, tipo, criticidade, descricao,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    atributos: {},
    dependencias: [], // [{ tipo, itemId }]
    fotos: [],        // [{ nome, dataUrl }]
    checklist: [
      { texto: "Item identificado", status: "Conforme" },
      { texto: "Fotos registradas", status: "Não inspecionado" },
    ],
  };
  site.items.push(item);
  site.updatedAt = nowIso();
  recordAudit("CREATE", "item", item.id, `Item ${item.nome} criado.`, site);
  scheduleAutosave();
  return item.id;
}

function findItemById(id) {
  return activeItems().find((i) => i.id === id);
}

function findItemByName(nome) {
  return activeItems().find((i) => i.nome === nome);
}

function collectChildren(pid, visitados = new Set()) {
  if (visitados.has(pid)) return [];
  visitados.add(pid);
  const direct = activeItems().filter((i) => i.parentId === pid);
  return direct.flatMap((c) => [c.id, ...collectChildren(c.id, visitados)]);
}

/** Move um item para um novo pai (escrita por trás do arraste no Mapa
 *  Mental). Preserva atributos, filhos, dependências, fotos e checklist —
 *  só o `parentId` muda. Bloqueia:
 *  - mover a RAIZ do site (ela é o próprio site, não um sub-item);
 *  - um item ser pai de si mesmo;
 *  - mover um item para dentro de um dos seus PRÓPRIOS descendentes
 *    (quebraria a árvore, criando um laço — mesma lógica de proteção já
 *    usada em criaDependenciaCiclo(), agora aplicada à hierarquia).
 *  Retorna {ok:false, semMudanca:true} (sem toast de erro) quando o
 *  destino já é o pai atual — é um "solte de volta", não um erro. */
function moveItemParent(itemId, novoParentId) {
  const item = findItemById(itemId);
  if (!item) return { ok: false, motivo: "Item não encontrado." };
  if (item.parentId === null) return { ok: false, motivo: "A raiz do site não pode ser movida." };
  if (itemId === novoParentId) return { ok: false, motivo: "Um item não pode ser pai de si mesmo." };
  if (item.parentId === novoParentId) return { ok: false, semMudanca: true };

  const novoPai = findItemById(novoParentId);
  if (!novoPai) return { ok: false, motivo: "Item de destino não encontrado." };

  const descendentes = collectChildren(itemId);
  if (descendentes.includes(novoParentId)) {
    return { ok: false, motivo: "Não é possível mover um item para dentro do seu próprio ramo (criaria um laço)." };
  }

  const paiAntigo = findItemById(item.parentId);
  item.parentId = novoParentId;
  item.updatedAt = nowIso();
  activeSite().updatedAt = nowIso();
  recordAudit("MOVE", "item", item.id, `${item.nome}: ${paiAntigo ? paiAntigo.nome : "—"} → ${novoPai.nome}.`);
  scheduleAutosave();
  return { ok: true, nomeAntigo: paiAntigo ? paiAntigo.nome : "—", nomeNovo: novoPai.nome };
}

/* ── Dependências (por ID) ────────────────────────────────────────────── */

function depItemNome(dep) {
  const alvo = findItemById(dep.itemId);
  return alvo ? alvo.nome : "(item removido)";
}

function depIsBroken(dep) {
  return !findItemById(dep.itemId);
}

function pruneDependenciesTo(itemId) {
  activeItems().forEach((it) => {
    it.dependencias = (it.dependencias || []).filter((d) => d.itemId !== itemId);
  });
}

/**
 * Detecção de ciclo: adicionar `origemId → alvoId` criaria um ciclo no grafo
 * de dependências? Retorna true se, seguindo as dependências a partir de
 * `alvoId`, conseguimos voltar até `origemId`.
 */
function criaDependenciaCiclo(origemId, alvoId) {
  if (origemId === alvoId) return true;
  const visitados = new Set();
  const pilha = [alvoId];
  while (pilha.length) {
    const atual = pilha.pop();
    if (atual === origemId) return true;
    if (visitados.has(atual)) continue;
    visitados.add(atual);
    const item = findItemById(atual);
    if (!item) continue;
    (item.dependencias || []).forEach((d) => {
      if (!visitados.has(d.itemId)) pilha.push(d.itemId);
    });
  }
  return false;
}

/** Cria uma dependência origem→alvo, com a mesma validação usada na aba
 *  "Dependências" do item: bloqueia auto-relação, ciclo e duplicata.
 *  Extraída pra ser reaproveitada também pelo modo "Conectar" do arraste
 *  no Mapa Mental — sem duplicar a lógica de validação em dois lugares. */
function addDependencyDirect(origemId, alvoId, tipo) {
  const origem = findItemById(origemId);
  if (!origem) return { ok: false, motivo: "Item de origem não encontrado." };
  if (origemId === alvoId) return { ok: false, motivo: "Um item não pode depender de si mesmo." };
  if (criaDependenciaCiclo(origemId, alvoId)) {
    return { ok: false, motivo: "Essa dependência criaria um ciclo (A→B→...→A). Operação bloqueada." };
  }
  if (origem.dependencias.some((d) => d.itemId === alvoId && d.tipo === tipo)) {
    return { ok: false, motivo: "Essa dependência já existe." };
  }
  origem.dependencias.push({ tipo, itemId: alvoId });
  origem.updatedAt = nowIso();
  activeSite().updatedAt = nowIso();
  recordAudit("CREATE", "dependency", origem.id, `${origem.nome} ${tipo} ${depItemNome({ itemId: alvoId })}.`);
  scheduleAutosave();
  return { ok: true };
}

/* ── Circuitos físicos (endereçamento: ativo → quadro → DJ → posição → bitola) ──
   Um Circuito é um CAMINHO ORDENADO de trechos (origem → destino), cada trecho
   aponta para um item real e carrega atributos físicos (posição no quadro,
   disjuntor, bitola do cabo, fase, comprimento). É o "mapa mental da sequência"
   do circuito físico — independente do grafo de dependências (que é livre),
   mas reaproveita a mesma linguagem visual nas exportações. */

const CIRCUITO_TIPOS = ["alimentacao", "protecao", "aterramento", "dados", "outro"];
const CIRCUITO_PAPEIS = ["quadro", "dj", "disjuntor", "cabo", "ativo", "medio", "outro"];

function siteCircuitos() {
  const s = activeSite();
  return (s && Array.isArray(s.circuitos)) ? s.circuitos : [];
}

/** Circuitos que tocam um item (em qualquer trecho). */
function circuitosOfItem(itemId) {
  return siteCircuitos().filter((c) => (c.trechos || []).some((t) => t.itemId === itemId));
}

/** Cria um circuito. trechos = [{itemId, papel, posicao, disjuntor, bitola, fase, comprimento, observacao}] */
function createCircuito(nome, tipo, trechos) {
  const site = activeSite();
  if (!site) return null;
  const circuito = {
    id: uid(),
    nome: String(nome || "Circuito").trim().slice(0, 200),
    tipo: CIRCUITO_TIPOS.includes(tipo) ? tipo : "alimentacao",
    trechos: normalizarTrechos(trechos),
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  site.circuitos = site.circuitos || [];
  site.circuitos.push(circuito);
  site.updatedAt = nowIso();
  recordAudit("CREATE", "circuito", circuito.id, `Circuito ${circuito.nome} (${circuito.tipo}) criado com ${circuito.trechos.length} trecho(s).`);
  scheduleAutosave();
  return circuito;
}

function updateCircuito(id, patch) {
  const c = siteCircuitos().find((x) => x.id === id);
  if (!c) return false;
  if (patch.nome !== undefined) c.nome = String(patch.nome).trim().slice(0, 200);
  if (patch.tipo !== undefined) c.tipo = CIRCUITO_TIPOS.includes(patch.tipo) ? patch.tipo : c.tipo;
  if (patch.trechos !== undefined) c.trechos = normalizarTrechos(patch.trechos);
  c.updatedAt = nowIso();
  activeSite().updatedAt = nowIso();
  recordAudit("UPDATE", "circuito", c.id, `Circuito ${c.nome} atualizado (${c.trechos.length} trecho(s)).`);
  scheduleAutosave();
  return true;
}

function deleteCircuito(id) {
  const site = activeSite();
  if (!site || !Array.isArray(site.circuitos)) return false;
  const idx = site.circuitos.findIndex((c) => c.id === id);
  if (idx === -1) return false;
  const removido = site.circuitos.splice(idx, 1)[0];
  site.updatedAt = nowIso();
  recordAudit("DELETE", "circuito", removido.id, `Circuito ${removido.nome} excluído.`);
  scheduleAutosave();
  return true;
}

function findCircuito(id) {
  return siteCircuitos().find((c) => c.id === id);
}

/** Normaliza/saneia trechos vindos do usuário ou de backup. */
function normalizarTrechos(trechos) {
  if (!Array.isArray(trechos)) return [];
  const ids = new Set(activeItems().map((i) => i.id));
  return trechos
    .filter((t) => t && ids.has(t.itemId))
    .map((t) => ({
      itemId: String(t.itemId),
      papel: CIRCUITO_PAPEIS.includes(t.papel) ? t.papel : "outro",
      posicao: String(t.posicao || "").slice(0, 120),
      disjuntor: String(t.disjuntor || "").slice(0, 80),
      bitola: String(t.bitola || "").slice(0, 60),
      fase: String(t.fase || "").slice(0, 40),
      comprimento: String(t.comprimento || "").slice(0, 40),
      observacao: String(t.observacao || "").slice(0, 400),
    }));
}

/** Validação de caminho contínuo: ≥2 trechos, todos válidos, sem repetir nó. */
function validarCircuito(circuito) {
  if (!circuito) return { ok: false, motivo: "Circuito inválido." };
  if (!String(circuito.nome || "").trim()) return { ok: false, motivo: "Informe o nome do circuito." };
  const trechos = circuito.trechos || [];
  if (trechos.length < 2) return { ok: false, motivo: "Um circuito precisa de ao menos origem e destino (2 trechos)." };
  const ids = new Set(activeItems().map((i) => i.id));
  const vistos = new Set();
  for (const t of trechos) {
    if (!ids.has(t.itemId)) return { ok: false, motivo: "Um trecho aponta para um item inexistente." };
    if (vistos.has(t.itemId)) return { ok: false, motivo: "O circuito visita o mesmo item duas vezes (não é um caminho simples)." };
    vistos.add(t.itemId);
  }
  return { ok: true };
}

/* ── Links entre grafos (Display Model / CAD)
   Ligação tipada entre dois itens quaisquer, com dados editáveis em CADA
   extremidade (terminal, papel, fase, bitola…). Vários links podem existir
   entre o mesmo par (ex.: circuitos distintos do mesmo quadro). ─────────── */

const LINK_CATEGORIAS = ["circuito_eletrico", "servico", "logico", "dados", "outro"];
const LINK_TIPOS = [
  "alimenta", "depende_de", "protege", "suporta", "monitora",
  "impacta", "conecta_com", "refrigera", "aterra", "outro",
];
const LINK_PAPEIS_ENDPOINT = [
  "quadro", "disjuntor", "saida", "entrada", "ativo", "cabo", "origem", "destino", "outro",
];

function siteLinks() {
  const s = activeSite();
  return (s && Array.isArray(s.links)) ? s.links : [];
}

function linksOfItem(itemId) {
  return siteLinks().filter((l) => l.from?.itemId === itemId || l.to?.itemId === itemId);
}

function findLink(id) {
  return siteLinks().find((l) => l.id === id) || null;
}

function normalizarLinkEndpoint(ep, fallbackPapel) {
  const src = ep && typeof ep === "object" ? ep : {};
  return {
    itemId: String(src.itemId || ""),
    papel: LINK_PAPEIS_ENDPOINT.includes(src.papel) ? src.papel : (fallbackPapel || "outro"),
    terminal: String(src.terminal || "").slice(0, 80),
    posicao: String(src.posicao || "").slice(0, 120),
    fase: String(src.fase || "").slice(0, 40),
    bitola: String(src.bitola || "").slice(0, 60),
    observacao: String(src.observacao || "").slice(0, 400),
  };
}

function normalizarLink(raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  return {
    id: r.id || uid(),
    nome: String(r.nome || "").slice(0, 200),
    categoria: LINK_CATEGORIAS.includes(r.categoria) ? r.categoria : "circuito_eletrico",
    tipo: LINK_TIPOS.includes(r.tipo) ? r.tipo : "conecta_com",
    from: normalizarLinkEndpoint(r.from, "origem"),
    to: normalizarLinkEndpoint(r.to, "destino"),
    createdAt: r.createdAt || nowIso(),
    updatedAt: r.updatedAt || nowIso(),
  };
}

function validarLink(link) {
  if (!link) return { ok: false, motivo: "Link inválido." };
  const ids = new Set(activeItems().map((i) => i.id));
  if (!ids.has(link.from?.itemId)) return { ok: false, motivo: "Extremidade de origem inválida." };
  if (!ids.has(link.to?.itemId)) return { ok: false, motivo: "Extremidade de destino inválida." };
  if (link.from.itemId === link.to.itemId) return { ok: false, motivo: "Origem e destino devem ser itens diferentes." };
  return { ok: true };
}

/** Cria um link entre dois grafos. Permite múltiplos links no mesmo par. */
function createLink(payload) {
  const site = activeSite();
  if (!site) return { ok: false, motivo: "Nenhum site ativo." };
  const link = normalizarLink(payload);
  const v = validarLink(link);
  if (!v.ok) return v;
  site.links = site.links || [];
  site.links.push(link);
  site.updatedAt = nowIso();
  recordAudit("CREATE", "link", link.id, `Link ${link.tipo}/${link.categoria}: ${link.from.itemId} → ${link.to.itemId}.`);
  scheduleAutosave();
  return { ok: true, link };
}

function updateLink(id, patch) {
  const link = findLink(id);
  if (!link) return { ok: false, motivo: "Link não encontrado." };
  if (patch.nome !== undefined) link.nome = String(patch.nome).slice(0, 200);
  if (patch.categoria !== undefined && LINK_CATEGORIAS.includes(patch.categoria)) link.categoria = patch.categoria;
  if (patch.tipo !== undefined && LINK_TIPOS.includes(patch.tipo)) link.tipo = patch.tipo;
  if (patch.from !== undefined) link.from = normalizarLinkEndpoint({ ...link.from, ...patch.from }, link.from.papel);
  if (patch.to !== undefined) link.to = normalizarLinkEndpoint({ ...link.to, ...patch.to }, link.to.papel);
  const v = validarLink(link);
  if (!v.ok) return v;
  link.updatedAt = nowIso();
  activeSite().updatedAt = nowIso();
  recordAudit("UPDATE", "link", link.id, `Link ${link.id} atualizado.`);
  scheduleAutosave();
  return { ok: true, link };
}

function deleteLink(id) {
  const site = activeSite();
  if (!site || !Array.isArray(site.links)) return false;
  const idx = site.links.findIndex((l) => l.id === id);
  if (idx === -1) return false;
  const removido = site.links.splice(idx, 1)[0];
  site.updatedAt = nowIso();
  recordAudit("DELETE", "link", removido.id, `Link ${removido.tipo} excluído.`);
  scheduleAutosave();
  return true;
}

/** Remove links que tocam qualquer item da lista (exclusão em cascata). */
function pruneLinksTo(itemIds) {
  const site = activeSite();
  if (!site || !Array.isArray(site.links)) return;
  const set = new Set(Array.isArray(itemIds) ? itemIds : [itemIds]);
  site.links = site.links.filter((l) => !set.has(l.from?.itemId) && !set.has(l.to?.itemId));
}

/* ── Persistência (localStorage) com migração v1 → v2 ──────────────────── */

function scheduleAutosave() {
  state.meta = state.meta || { changesSinceBackup: 0 };
  if (!_changeTrackingSuspended) {
    state.meta.changesSinceBackup = (state.meta.changesSinceBackup || 0) + 1;
  }
  clearTimeout(_autosaveTimer);
  _autosaveTimer = setTimeout(saveToLocalStorage, AUTOSAVE_DEBOUNCE_MS);
}

function saveToLocalStorage() {
  try {
    const payload = JSON.stringify(state);
    localStorage.setItem(STORAGE_KEY_V2, payload);
    setAutosaveStatus("salvo");
    atualizarIndicadorArmazenamento(payload.length);
    avaliarLembreteDeBackup();
  } catch (e) {
    console.error("Falha ao salvar:", e);
    // Provável estouro de cota (fotos base64 grandes demais)
    setAutosaveStatus("erro: armazenamento cheio");
    toast("Não foi possível salvar: armazenamento do navegador cheio. Remova fotos pesadas ou exporte um backup.", "error");
  }
}

/** Estimativa de uso do localStorage (em bytes do JSON salvo) vs. o teto
 *  típico de ~5MB por origem. Mostra na barra lateral ANTES de estourar
 *  a cota — hoje o app só reagia depois do erro de gravação. */
function atualizarIndicadorArmazenamento(bytesAtuais) {
  const el = document.getElementById("storageStatus");
  if (!el) return;
  const pct = Math.min(100, Math.round((bytesAtuais / STORAGE_SOFT_LIMIT_BYTES) * 100));
  const kb = Math.round(bytesAtuais / 1024);
  el.textContent = `${pct}% (${kb >= 1024 ? (kb / 1024).toFixed(1) + " MB" : kb + " KB"})`;
  el.classList.remove("ok", "warn", "danger");
  el.classList.add(pct >= 90 ? "danger" : pct >= 70 ? "warn" : "ok");
  if (pct >= 70 && !state.meta._avisoArmazenamentoFeito) {
    state.meta._avisoArmazenamentoFeito = true;
    toast(`Armazenamento em ${pct}% da capacidade estimada. Considere exportar um backup e remover fotos antigas/pesadas.`, pct >= 90 ? "error" : "info");
  }
  if (pct < 60) state.meta._avisoArmazenamentoFeito = false;
}

/** Lembrete de backup: depois de N alterações sem exportar, sugere
 *  "Exportar backup JSON" — hoje não havia nenhuma rotina de backup,
 *  e a única persistência é o localStorage do navegador. */
function avaliarLembreteDeBackup() {
  if ((state.meta?.changesSinceBackup || 0) >= BACKUP_REMINDER_THRESHOLD) {
    state.meta.changesSinceBackup = 0; // não repete a cada alteração — só periodicamente
    toast("Muitas alterações desde o último backup. Recomendado: Relatórios → Exportar backup JSON.", "info");
  }
}

function loadFromLocalStorage() {
  // 1) Tenta o formato v2
  try {
    const rawV2 = localStorage.getItem(STORAGE_KEY_V2);
    if (rawV2) {
      const parsed = JSON.parse(rawV2);
      if (parsed && Array.isArray(parsed.sites) && parsed.sites.length) {
        state = normalizarEstado(parsed);
        return true;
      }
    }
  } catch (e) {
    console.error("Falha ao ler v2:", e);
  }

  // 2) Tenta migrar do formato v1 (site único: { site, items })
  try {
    const rawV1 = localStorage.getItem(STORAGE_KEY);
    if (rawV1) {
      const v1 = JSON.parse(rawV1);
      if (v1 && v1.site && Array.isArray(v1.items)) {
        state = migrarV1paraV2(v1);
        saveToLocalStorage(); // grava já no novo formato
        return true;
      }
    }
  } catch (e) {
    console.error("Falha ao migrar v1:", e);
  }

  return false;
}

/** Converte o formato antigo (site único) no novo (lista de sites). */
function migrarV1paraV2(v1) {
  const site = {
    id: uid(),
    nome: v1.site.nome,
    codigo: v1.site.codigo,
    criticidade: v1.site.criticidade,
    latitude: v1.site.latitude,
    longitude: v1.site.longitude,
    resumo: v1.site.resumo,
    localInstalacao: v1.site.localInstalacao || "",
    centroTrabalho: v1.site.centroTrabalho || "",
    statusOperacional: v1.site.statusOperacional || "Operacional",
    createdAt: nowIso(),
    updatedAt: nowIso(),
    selectedItemId: v1.selectedItemId || null,
    items: (v1.items || []).map((i) => ({ ...i, fotos: i.fotos || [] })),
  };
  return normalizarEstado({
    version: SCHEMA_VERSION,
    activeSiteId: site.id,
    sites: [site],
    meta: { changesSinceBackup: 0, auditLog: [], currentUser: state.meta?.currentUser },
  });
}

/** Garante que todos os campos esperados existam (robustez ao carregar). */
function normalizarEstado(parsed) {
  parsed.version = SCHEMA_VERSION;
  parsed.meta = {
    changesSinceBackup: 0,
    auditLog: [],
    currentUser: { id: "local-editor", nome: "Técnico Inspetor", perfil: "Editor Técnico" },
    ...(parsed.meta || {}),
  };
  parsed.meta.auditLog = Array.isArray(parsed.meta.auditLog) ? parsed.meta.auditLog.slice(0, MAX_AUDIT_ENTRIES) : [];
  parsed.sites = (parsed.sites || []).map((s) => ({
    selectedItemId: null,
    focusItemId: null,
    circuitos: [],
    links: [],
    items: [],
    localInstalacao: "",
    centroTrabalho: "",
    statusOperacional: "Operacional",
    prontuarioStatus: "rascunho",
    createdAt: nowIso(),
    updatedAt: nowIso(),
    ...s,
    items: (s.items || []).map((i) => ({
      atributos: {}, dependencias: [], fotos: [], checklist: [], createdAt: nowIso(), updatedAt: nowIso(), ...i,
    })),
  }));
  parsed.sites.forEach((site) => {
    const ids = new Set(site.items.map((item) => item.id));
    site.items.forEach((item) => {
      const atributosOriginais = item.atributos && typeof item.atributos === "object" && !Array.isArray(item.atributos) ? item.atributos : {};
      item.atributos = Object.fromEntries(
        Object.entries(atributosOriginais)
          .slice(0, 500)
          .map(([key, value]) => [String(key).slice(0, 200), String(value ?? "").slice(0, 4000)])
      );
      item.dependencias = Array.isArray(item.dependencias) ? item.dependencias : [];
      item.fotos = Array.isArray(item.fotos) ? item.fotos : [];
      item.checklist = Array.isArray(item.checklist) ? item.checklist : [];
      // Protótipos muito antigos referenciavam dependências pelo nome.
      item.dependencias = item.dependencias.map((dep) => {
        if (ids.has(dep.itemId)) return dep;
        const nomeLegado = dep.itemId || dep.item;
        const alvo = site.items.find((candidate) => candidate.nome === nomeLegado);
        return alvo ? { tipo: dep.tipo || "depende_de", itemId: alvo.id } : dep;
      });
    });
    if (!site.items.some((item) => item.id === site.selectedItemId)) site.selectedItemId = null;
    // Normaliza circuitos e descarta trechos que apontem para itens inexistentes.
    site.circuitos = (Array.isArray(site.circuitos) ? site.circuitos : []).map((c) => ({
      id: c.id || uid(),
      nome: String(c.nome || "Circuito").slice(0, 200),
      tipo: CIRCUITO_TIPOS.includes(c.tipo) ? c.tipo : "alimentacao",
      trechos: (Array.isArray(c.trechos) ? c.trechos : [])
        .filter((t) => t && ids.has(t.itemId))
        .map((t) => ({
          itemId: String(t.itemId),
          papel: CIRCUITO_PAPEIS.includes(t.papel) ? t.papel : "outro",
          posicao: String(t.posicao || "").slice(0, 120),
          disjuntor: String(t.disjuntor || "").slice(0, 80),
          bitola: String(t.bitola || "").slice(0, 60),
          fase: String(t.fase || "").slice(0, 40),
          comprimento: String(t.comprimento || "").slice(0, 40),
          observacao: String(t.observacao || "").slice(0, 400),
        })),
      createdAt: c.createdAt || nowIso(),
      updatedAt: c.updatedAt || nowIso(),
    }));
    // Links CAD entre grafos (descarta extremidades órfãs)
    site.links = (Array.isArray(site.links) ? site.links : [])
      .map((l) => normalizarLink(l))
      .filter((l) => ids.has(l.from.itemId) && ids.has(l.to.itemId) && l.from.itemId !== l.to.itemId);
  });
  if (!parsed.activeSiteId && parsed.sites.length) {
    parsed.activeSiteId = parsed.sites[0].id;
  }
  if (!parsed.sites.some((site) => site.id === parsed.activeSiteId)) parsed.activeSiteId = parsed.sites[0]?.id || null;
  return parsed;
}

/** Prepara um arquivo externo sem permitir que sua estrutura arbitrária
 *  chegue às rotinas recursivas de árvore/grafo ou ao HTML. */
function prepararEstadoImportado(parsed) {
  let candidate;
  if (parsed && Array.isArray(parsed.sites) && parsed.sites.length) {
    candidate = normalizarEstado(structuredCloneSafe(parsed));
  } else if (parsed && parsed.site && Array.isArray(parsed.items)) {
    candidate = migrarV1paraV2(structuredCloneSafe(parsed));
  } else {
    throw new Error("Estrutura de backup não reconhecida.");
  }
  validarIntegridadeEstado(candidate);
  return candidate;
}

function validarIntegridadeEstado(candidate) {
  if (!candidate || !Array.isArray(candidate.sites) || !candidate.sites.length) {
    throw new Error("O backup não possui sites.");
  }
  const siteIds = new Set();
  const codes = new Set();
  candidate.sites.forEach((site) => {
    validarIdSeguro(site.id, "site");
    if (siteIds.has(site.id)) throw new Error("Há IDs de site duplicados.");
    siteIds.add(site.id);
    const code = String(site.codigo || "").trim().toLocaleUpperCase("pt-BR");
    if (!code || codes.has(code)) throw new Error("Há códigos de site ausentes ou duplicados.");
    codes.add(code);
    validarIntegridadeSite(site);
  });
}

function validarIntegridadeSite(site) {
  if (!Array.isArray(site.items) || !site.items.length) throw new Error(`O site ${site.codigo} não possui itens.`);
  if (site.items.length > MAX_ITENS_SITE) throw new Error(`O site ${site.codigo} excede o teto de ${MAX_ITENS_SITE} itens.`);
  const ids = new Set();
  site.items.forEach((item) => {
    validarIdSeguro(item.id, "item");
    if (ids.has(item.id)) throw new Error(`IDs de item duplicados em ${site.codigo}.`);
    ids.add(item.id);
    if (!item.nome || !item.categoria) throw new Error(`Item sem nome ou categoria em ${site.codigo}.`);
    if (!item.atributos || typeof item.atributos !== "object" || Array.isArray(item.atributos)) throw new Error(`Atributos inválidos em ${item.nome}.`);
    if (!Array.isArray(item.dependencias) || !Array.isArray(item.checklist) || !Array.isArray(item.fotos)) throw new Error(`Coleções inválidas em ${item.nome}.`);
    item.checklist.forEach((check) => {
      if (!["Conforme", "Não conforme", "Não aplicável", "Não inspecionado"].includes(check.status)) throw new Error(`Status de checklist inválido em ${item.nome}.`);
      if (!String(check.texto || "").trim()) throw new Error(`Ponto de checklist vazio em ${item.nome}.`);
    });
    item.fotos.forEach((foto) => {
      if (!/^data:image\/(?:jpeg|jpg|png|webp|gif);base64,/i.test(String(foto.dataUrl || ""))) throw new Error(`Evidência inválida em ${item.nome}.`);
    });
  });

  const roots = site.items.filter((item) => item.parentId === null);
  if (roots.length !== 1) throw new Error(`O site ${site.codigo} deve possuir exatamente uma raiz.`);
  site.items.forEach((item) => {
    if (item.parentId !== null && !ids.has(item.parentId)) throw new Error(`Item órfão encontrado em ${site.codigo}.`);
    item.dependencias.forEach((dep) => {
      if (!ids.has(dep.itemId)) throw new Error(`Dependência quebrada encontrada em ${site.codigo}.`);
      if (dep.itemId === item.id) throw new Error(`Auto-dependência encontrada em ${item.nome}.`);
    });
  });

  const visitados = new Set();
  const pilha = new Set();
  function visitarArvore(id, profundidade) {
    if (profundidade > MAX_PROFUNDIDADE) throw new Error(`Hierarquia profunda demais em ${site.codigo} (>${MAX_PROFUNDIDADE} níveis).`);
    if (pilha.has(id)) throw new Error(`Ciclo hierárquico encontrado em ${site.codigo}.`);
    if (visitados.has(id)) return;
    visitados.add(id);
    pilha.add(id);
    site.items.filter((item) => item.parentId === id).forEach((child) => visitarArvore(child.id, profundidade + 1));
    pilha.delete(id);
  }
  visitarArvore(roots[0].id, 0);
  if (visitados.size !== site.items.length) throw new Error(`Itens desconectados encontrados em ${site.codigo}.`);

  const depVisitados = new Set();
  const depPilha = new Set();
  function visitarDependencias(id, profundidade) {
    if (profundidade > MAX_ITENS_SITE) throw new Error(`Cadeia de dependências longa demais em ${site.codigo}.`);
    if (depPilha.has(id)) throw new Error(`Ciclo de dependência encontrado em ${site.codigo}.`);
    if (depVisitados.has(id)) return;
    depVisitados.add(id);
    depPilha.add(id);
    const item = site.items.find((entry) => entry.id === id);
    (item?.dependencias || []).forEach((dep) => visitarDependencias(dep.itemId, profundidade + 1));
    depPilha.delete(id);
  }
  site.items.forEach((item) => visitarDependencias(item.id, 0));

  // Circuitos: trechos precisam apontar para itens existentes e formar caminho simples.
  (Array.isArray(site.circuitos) ? site.circuitos : []).forEach((c) => {
    const trechos = c.trechos || [];
    const vistos = new Set();
    trechos.forEach((t) => {
      if (!ids.has(t.itemId)) throw new Error(`Circuito ${c.nome || ""} em ${site.codigo} referencia item inexistente.`);
      if (vistos.has(t.itemId)) throw new Error(`Circuito ${c.nome || ""} em ${site.codigo} visita o mesmo item duas vezes.`);
      vistos.add(t.itemId);
    });
  });
}

function validarIdSeguro(id, tipo) {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(String(id || ""))) throw new Error(`ID de ${tipo} inválido.`);
}

function structuredCloneSafe(value) {
  return typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value));
}

/* ── Regras únicas de inspeção (usadas por UI, rede e relatórios) ───── */

function resumirInspecaoItem(item) {
  const checks = item.checklist || [];
  if (!checks.length) return { status: "Sem checklist", classe: "danger", pendencia: "Checklist não configurado" };
  const non = checks.find((check) => check.status === "Não conforme");
  if (non) return { status: "Não conforme", classe: "danger", pendencia: non.texto };
  const pending = checks.find((check) => check.status === "Não inspecionado");
  if (pending) return { status: "Pendente", classe: "warn", pendencia: pending.texto };
  if (checks.every((check) => check.status === "Não aplicável")) return { status: "Não aplicável", classe: "neutral", pendencia: "-" };
  return { status: "Conforme", classe: "ok", pendencia: "-" };
}

function calcularMetricasSite(site) {
  let pendencias = 0;
  let conformes = 0;
  let base = 0;
  (site?.items || []).forEach((item) => {
    const checks = item.checklist || [];
    if (!checks.length) {
      pendencias++;
      base++;
      return;
    }
    checks.forEach((check) => {
      if (check.status === "Não aplicável") return;
      base++;
      if (check.status === "Conforme") conformes++;
      else pendencias++;
    });
  });
  return {
    itens: site?.items?.length || 0,
    pendencias,
    conformes,
    base,
    conformidade: base ? Math.round((conformes / base) * 100) : 0,
  };
}

function clearLocalStorage() {
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(STORAGE_KEY_V2);
}

function setAutosaveStatus(texto) {
  const el = document.getElementById("autosaveStatus");
  if (el) el.textContent = texto;
}

/* ── Seed de dados iniciais (site fictício de demonstração) ─────────────── */

let root = null;

function seedInitialData() {
  _changeTrackingSuspended = true;
  _auditSuspended = true;
  createSite(
    "LTE MORRO ALFA", "LTE-MA01", "Alta", "-6.080000", "-50.150000",
    "Site fictício de telecom crítica com LTE, MW, energia AC/DC, SPDA, abrigo técnico, torre autoportante e sistema irradiante.",
    "FECJ-APD-TEL-REDTI-AB_16", "LTE-CAR", "Operacional"
  );

  root = addItem(
    "SITE LTE MORRO ALFA", "Raiz", "Site Telecom", "Crítica", null,
    "Site completo fictício para inspeção, inventário e prontuário técnico."
  );
  const rootItem = findItemById(root);
  rootItem.atributos = { Localidade: "Carajás/PA", Ambiente: "Mineração", "Função": "LTE + MW + Energia Crítica" };
  rootItem.checklist = [{ texto: "Site identificado e georreferenciado", status: "Conforme" }];

  const civil = addItem("Infraestrutura Civil", "Civil", "Sistema", "Alta", root, "Perímetro, portão, pavimentação, fundações e abrigos.");
  addItem("Fechamento do Perímetro", "Civil", "Cerca galvanizada", "Média", civil, "Cerca metálica com concertina e mureta.");
  addItem("Portão de Acesso 4m", "Civil", "Portão metálico", "Média", civil, "Portão de duas folhas com trava e cadeado industrial.");
  addItem("Pavimentação em Brita", "Civil", "Pavimento", "Média", civil, "Brita compactada com passarela em concreto.");

  const torre = addItem("Torre Autoportante 42m", "Estrutura Vertical", "Torre", "Crítica", root, "Torre metálica autoportante com antenas LTE, MW e balizamento.");
  const fundacoes = addItem("Fundações da Torre", "Estrutura Vertical", "Blocos de concreto", "Crítica", torre, "Três blocos de concreto armado com chumbadores.");
  addItem("Linha de Vida", "Segurança em Altura", "Sistema antiqueda", "Alta", torre, "Linha de vida para acesso técnico vertical.");
  addItem("Balizamento Noturno", "Sinalização", "LED vermelho", "Alta", torre, "Balizamento de topo controlado por fotocélula.");

  const energia = addItem("Sistema de Energia", "Energia", "AC/DC", "Crítica", root, "Entrada AC, gerador, QTA, retificador e baterias.");
  addItem("Padrão de Entrada AC", "Energia AC", "Entrada BT", "Alta", energia, "Entrada 380/220V com medição e proteção.");
  const qdg = addItem("QDG", "Energia AC", "Quadro Geral", "Crítica", energia, "Quadro de distribuição geral AC.");
  const qta = addItem("QTA", "Energia AC", "Transferência Automática", "Crítica", energia, "Transferência entre rede e gerador.");
  const gmg = addItem("Grupo Gerador 80kVA", "Energia AC", "Gerador Diesel", "Crítica", energia, "Backup de energia do site.");
  const retificador = addItem("Retificador -48V 300A", "Energia DC", "Retificador", "Crítica", energia, "Sistema DC para equipamentos telecom.");
  addItem("Banco de Baterias 600Ah", "Energia DC", "Bateria VRLA", "Crítica", energia, "Autonomia em falta de AC.");

  const shelter = addItem("Abrigo de Equipamentos", "Shelter", "Abrigo climatizado", "Crítica", root, "Abrigo metálico com racks, energia, climatização e transmissão.");
  addItem("Climatização Principal", "Climatização", "Split 24000 BTU", "Alta", shelter, "Sistema de refrigeração principal e reserva.");
  addItem("Iluminação Interna", "Elétrica", "LED", "Média", shelter, "Luminárias internas do abrigo.");

  const tx = addItem("Camada de Transmissão", "Transmissão", "MW/Fibra/IP", "Crítica", root, "Backhaul, MW, fibra e rede IP.");
  const enlaceMw = addItem("Enlace MW 18GHz", "Transmissão MW", "Rádio Micro-ondas", "Crítica", tx, "Enlace ponto-a-ponto para backhaul.");
  addItem("DIO Fibra Óptica", "Fibra", "DIO", "Alta", tx, "Distribuidor interno óptico.");
  addItem("Switch de Acesso", "Rede IP", "Switch industrial", "Alta", tx, "Interligação de eNode-B, MW e gerência.");

  const lte = addItem("LTE / eNode-B", "LTE", "eNode-B", "Crítica", root, "Camada LTE com BBU, RRU, GPS e setores.");
  addItem("BBU LTE", "LTE", "Baseband", "Crítica", lte, "Unidade de processamento da eNode-B.");
  addItem("RRU Setor 1", "LTE", "RRU", "Crítica", lte, "Rádio remoto setor 1.");
  addItem("Antena LTE Setor 1", "Sistema Irradiante", "Antena setorial", "Crítica", lte, "Antena setorial com azimute e tilt definidos.");
  const gps = addItem("GPS / Sincronismo", "LTE", "GPS", "Alta", lte, "Sincronismo da estação LTE.");

  const spda = addItem("SPDA e Aterramento", "Proteção", "SPDA", "Crítica", root, "Proteção contra descargas atmosféricas e equipotencialização.");
  const malha = addItem("Malha de Terra", "Aterramento", "Malha", "Crítica", spda, "Malha enterrada com caixas de inspeção.");
  addItem("BEP Interno", "Aterramento", "Barramento", "Crítica", spda, "Barramento de equipotencialização principal.");
  addItem("DPS QDG", "Proteção Elétrica", "DPS", "Alta", spda, "Proteção contra surtos no QDG.");

  enrichDefaults({ torre, fundacoes, qta, gmg, qdg, lte, retificador, enlaceMw, gps, malha });
  _changeTrackingSuspended = false;
  _auditSuspended = false;
  state.meta.changesSinceBackup = 0;
  recordAudit("CREATE", "database", "seed-v3.5", "Base demonstrativa v3.5 criada.");
  saveToLocalStorage();
}

function enrichDefaults(ids) {
  const torre = findItemById(ids.torre);
  if (torre) {
    torre.atributos = { Altura: "42 m", Material: "Aço galvanizado", Faces: "3", "Linha de vida": "Existente" };
    torre.dependencias = [
      { tipo: "depende_de", itemId: ids.fundacoes },
      { tipo: "aterra", itemId: ids.malha },
    ];
  }
  const qta = findItemById(ids.qta);
  if (qta) {
    qta.atributos = { "Tensão": "380/220V", Modo: "Automático", "Rede/Gerador": "Disponível" };
    qta.dependencias = [
      { tipo: "depende_de", itemId: ids.gmg },
      { tipo: "alimenta", itemId: ids.qdg },
    ];
  }
  const enb = findItemById(ids.lte);
  if (enb) {
    enb.dependencias = [
      { tipo: "depende_de", itemId: ids.retificador },
      { tipo: "depende_de", itemId: ids.enlaceMw },
      { tipo: "depende_de", itemId: ids.gps },
    ];
  }
}
