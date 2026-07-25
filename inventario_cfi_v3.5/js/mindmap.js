/* ==========================================================================
   CFI Serviços — Inventário Inteligente de Sites Telecom
   mindmap.js — Ferramenta de Mapa Mental do Site
   ==========================================================================
   NOVO MÓDULO (solicitado pelo usuário):
   - Gera a árvore COMPLETA do site ativo, todos os níveis (não apenas a
     raiz e seus filhos diretos, como na versão anterior).
   - Layout em árvore horizontal (esquerda → direita), profundidade livre.
   - Cor dos nós por criticidade (mesma linguagem visual do resto do app),
     com contador de sub-itens — o mapa passa a ter valor diagnóstico,
     não só estrutural.
   - Reaproveitado em DOIS lugares:
       1) Miniatura no Dashboard (chamada por renderMindMap em render.js).
       2) Ferramenta completa: modal com zoom, clique-para-selecionar,
          Imprimir, Exportar PNG, Exportar PDF e Exportar JSON.
   - Todas as saídas funcionam 100% offline (mesmo princípio do report.js).
   ========================================================================== */

const MM_COR = {
  raiz: "#007a53",
  "Crítica": "#dc2626",
  "Alta": "#f59e0b",
  "Média": "#0a5f9e",
  "Baixa": "#16a34a",
};

function mmCorPara(item, isRoot) {
  if (isRoot) return MM_COR.raiz;
  return MM_COR[item.criticidade] || "#64748b";
}

/* ── Construção da árvore completa a partir do site ativo ───────────────── */

function mmBuildTree() {
  const itens = activeItems();
  const raiz = itens.find((i) => i.parentId === null);
  if (!raiz) return null;
  function nodeFrom(item) {
    const filhos = _mmCollapsed.has(item.id)
      ? [] // nó colapsado: subárvores ocultas no canvas
      : itens.filter((i) => i.parentId === item.id).map(nodeFrom);
    return {
      id: item.id, nome: item.nome, categoria: item.categoria,
      tipo: item.tipo, criticidade: item.criticidade,
      atributos: { ...(item.atributos || {}) },
      children: filhos,
    };
  }
  return nodeFrom(raiz);
}

/* ── Layout em árvore horizontal: x = profundidade, y = posição via DFS ──
   Algoritmo simples (não é Reingold–Tilford balanceado, mas é suficiente
   para o tamanho típico de um inventário de site): folhas recebem posições
   verticais sequenciais; cada nó-pai fica centrado na média de seus filhos. */

function mmLayout(tree, opts = {}) {
  const nodeW = opts.nodeW || 190;
  const nodeH = opts.nodeH || 58;
  const rowH = opts.rowH || 76;
  const levelGap = opts.levelGap || 240;
  let yCounter = 0;
  const nodes = [], edges = [];

  function visit(node, depth, parent) {
    node._depth = depth;
    if (!node.children.length) {
      node._y = yCounter * rowH;
      yCounter++;
    } else {
      node.children.forEach((c) => visit(c, depth + 1, node));
      const ys = node.children.map((c) => c._y);
      node._y = (Math.min(...ys) + Math.max(...ys)) / 2;
    }
    node._x = depth * levelGap;
    nodes.push(node);
    if (parent) edges.push([parent, node]);
  }
  visit(tree, 0, null);

  const maxY = nodes.length ? Math.max(...nodes.map((n) => n._y)) + nodeH : nodeH;
  const maxX = nodes.length ? Math.max(...nodes.map((n) => n._x)) + nodeW : nodeW;
  return { nodes, edges, width: maxX, height: maxY, nodeW, nodeH };
}

/* ── Quebra de texto simples (até 2 linhas) para caber dentro do nó ──────── */

function mmWrapLines(text, maxChars, maxLines) {
  const words = String(text || "").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [""];
  const lines = [];
  let cur = "";
  words.forEach((w) => {
    const t = cur ? cur + " " + w : w;
    if (t.length > maxChars && cur) { lines.push(cur); cur = w; }
    else { cur = t; }
  });
  if (cur) lines.push(cur);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    let last = kept[maxLines - 1];
    if (last.length > maxChars - 1) last = last.slice(0, maxChars - 1);
    kept[maxLines - 1] = last.trimEnd() + "…";
    return kept;
  }
  return lines;
}

function mmEscXml(s) {
  return String(s ?? "").replace(/[&<>]/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[m]));
}

/* ── Plano de construção = área virtual do Display Model ───────────────────
   1) Base: área do mapa × 4 (escala linear √4 = 2), origem no centro (±X/±Y).
   2) Expande para a mesma proporção do Display (#mindMapFull), de modo que
      o plano ocupe 100% da área virtual visível no Zoom Extend. */
const MM_PAD = 24;
const MM_CONSTRUCTION_AREA_FACTOR = 4;

function mmDisplaySize() {
  const el = document.getElementById("mindMapFull");
  return {
    cw: Math.max(1, el?.clientWidth || 800),
    ch: Math.max(1, el?.clientHeight || 520),
  };
}

/** Dimensões do conteúdo e do plano cartesiano (= Display Model virtual). */
function mmConstructionBounds(layout) {
  const pad = MM_PAD;
  const { cw, ch } = mmDisplaySize();
  const wc = Math.max(1, Math.round((layout?.width || 0) + pad * 2));
  const hc = Math.max(1, Math.round((layout?.height || 0) + pad * 2));
  const linear = Math.sqrt(MM_CONSTRUCTION_AREA_FACTOR);

  // Mínimo: 4× a área do mapa (cartesiano simétrico)
  let ww = Math.max(wc, Math.round(wc * linear));
  let hw = Math.max(hc, Math.round(hc * linear));

  // Completa o Display Model: mesma proporção da área virtual do canvas
  const displayAspect = cw / ch;
  const planeAspect = ww / hw;
  if (planeAspect < displayAspect) ww = hw * displayAspect;
  else hw = ww / displayAspect;

  ww = Math.max(1, Math.round(ww));
  hw = Math.max(1, Math.round(hw));

  // Conteúdo centrado na origem → ±X e ±Y
  const ox = Math.round(-wc / 2);
  const oy = Math.round(-hc / 2);
  const xMin = Math.round(-ww / 2);
  const yMin = Math.round(-hw / 2);
  const xMax = xMin + ww;
  const yMax = yMin + hw;
  return { pad, wc, hc, ww, hw, ox, oy, xMin, yMin, xMax, yMax, linear, cw, ch };
}

/* ── Renderização em SVG — reaproveitada por miniatura, modal, PNG, PDF e impressão ── */

/** Conteúdo interno do SVG (fundo + arestas + nós) nas coordenadas naturais
 *  do layout. Separado do wrapper <svg> para que a ferramenta completa possa
 *  envolvê-lo num <g> de viewport (pan/zoom) sem afetar as exportações, que
 *  usam o wrapper standalone (mmRenderSVG).
 *  opts.construction — plano 4× área no Display Model (editor). */
function mmRenderSVGInner(layout, opts = {}) {
  const { nodes, edges, width, height, nodeW, nodeH } = layout;
  const construction = !!opts.construction;
  const bounds = construction ? mmConstructionBounds(layout) : null;
  const pad = bounds ? bounds.pad : MM_PAD;
  const ox = bounds ? bounds.ox : 0;
  const oy = bounds ? bounds.oy : 0;
  const maxChars = Math.max(10, Math.round((nodeW - 40) / 6.4));
  const th = typeof mmEngineTheme === "function" ? mmEngineTheme() : {
    bg: "#ffffff", nodeFill: "#ffffff", text: "#18332b", meta: "#687b73",
    edge: "#a9d2c4", accent: "#007a53", badge: "#0a5f9e", grid: "rgba(0,0,0,.05)", rootText: "#ffffff",
  };
  const prefs = typeof mmEnginePrefs !== "undefined" ? mmEnginePrefs : { grade: false, conector: "curva", mostrarMeta: true, mostrarBadge: true, mostrarIcone: true };
  const W = construction ? bounds.ww : Math.round(width + pad * 2);
  const H = construction ? bounds.hw : Math.round(height + pad * 2);
  const planeX = construction ? bounds.xMin : 0;
  const planeY = construction ? bounds.yMin : 0;
  const planeFill = construction
    ? (mmEnginePrefs && mmEnginePrefs.tema === "vale" ? "#252525" : "#eef3f0")
    : th.bg;
  const planeStroke = construction
    ? (mmEnginePrefs && mmEnginePrefs.tema === "vale" ? "#FFFFFF" : "#007a53")
    : "none";
  const axisStroke = construction
    ? (mmEnginePrefs && mmEnginePrefs.tema === "vale" ? "rgba(255,255,255,.45)" : "rgba(0,122,83,.4)")
    : null;

  let svg = `<rect class="mm-construction-plane" x="${planeX}" y="${planeY}" width="${W}" height="${H}" fill="${planeFill}"`
    + (construction ? ` stroke="${planeStroke}" stroke-width="2" stroke-dasharray="10 6"` : "")
    + `/>`;
  if (prefs.grade || construction) {
    const gridStroke = prefs.grade ? th.grid : (mmEnginePrefs && mmEnginePrefs.tema === "vale"
      ? "rgba(255,255,255,.08)" : "rgba(0,122,83,.08)");
    svg += `<defs><pattern id="mmGrid" width="28" height="28" patternUnits="userSpaceOnUse">`
      + `<path d="M 28 0 L 0 0 0 28" fill="none" stroke="${gridStroke}" stroke-width="1"/></pattern></defs>`;
    svg += `<rect x="${planeX}" y="${planeY}" width="${W}" height="${H}" fill="url(#mmGrid)"/>`;
  }
  if (construction && axisStroke) {
    // Eixos do plano cartesiano (X negativo↔positivo, Y negativo↔positivo)
    svg += `<line class="mm-axis-x" x1="${bounds.xMin}" y1="0" x2="${bounds.xMax}" y2="0" stroke="${axisStroke}" stroke-width="1.25"/>`;
    svg += `<line class="mm-axis-y" x1="0" y1="${bounds.yMin}" x2="0" y2="${bounds.yMax}" stroke="${axisStroke}" stroke-width="1.25"/>`;
    svg += `<circle cx="0" cy="0" r="3" fill="${planeStroke}"/>`;
  }

  edges.forEach(([a, b]) => {
    const x1 = a._x + pad + ox + nodeW, y1 = a._y + pad + oy + nodeH / 2;
    const x2 = b._x + pad + ox, y2 = b._y + pad + oy + nodeH / 2;
    if (prefs.conector === "reta") {
      svg += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${th.edge}" stroke-width="2.2"/>`;
    } else {
      const dx = Math.max(40, (x2 - x1) * 0.5);
      svg += `<path d="M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}" fill="none" stroke="${th.edge}" stroke-width="2.2"/>`;
    }
    svg += `<circle cx="${x1}" cy="${y1}" r="3.2" fill="${th.accent}"/>`;
  });

  nodes.forEach((n) => {
    const isRoot = n._depth === 0;
    const x = n._x + pad + ox, y = n._y + pad + oy;
    const cor = isRoot ? th.accent : mmCorPara(n, false);
    const item = findItemById(n.id);
    const asset = item && typeof getAssetMeta === "function" ? getAssetMeta(item) : null;
    const icon = (prefs.mostrarIcone && typeof assetIconFor === "function")
      ? assetIconFor(item || n) : "";
    const labelBase = asset?.tag ? `${asset.tag} · ${n.nome}` : n.nome;
    const linhas = mmWrapLines(labelBase, maxChars - (icon ? 2 : 0), 2);
    const collapsed = _mmCollapsed && _mmCollapsed.has(n.id);
    const fill = isRoot ? th.accent : th.nodeFill;
    const txt = isRoot ? th.rootText : th.text;

    svg += `<g class="mm-node" data-item-id="${n.id}">`;
    svg += `<rect class="mm-box" x="${x}" y="${y}" width="${nodeW}" height="${nodeH}" rx="10" fill="${fill}" stroke="${cor}" stroke-width="${isRoot ? 0 : 2}"/>`;
    if (!isRoot) svg += `<rect x="${x}" y="${y}" width="5" height="${nodeH}" rx="2" fill="${cor}"/>`;

    let ty = y + 20;
    const tx = x + (icon ? 28 : 14);
    if (icon) {
      svg += `<text x="${x + 14}" y="${y + 28}" font-size="14">${icon}</text>`;
    }
    linhas.forEach((l) => {
      svg += `<text x="${tx}" y="${ty}" font-size="12.5" font-weight="700" fill="${txt}" font-family="Aptos Narrow, Segoe UI Narrow, Arial Narrow, sans-serif">${mmEscXml(l)}</text>`;
      ty += 14;
    });
    if (prefs.mostrarMeta) {
      const metaBits = [n.categoria, asset?.statusOperacional || n.criticidade].filter(Boolean);
      const meta = metaBits.join(" · ");
      if (meta) svg += `<text x="${tx}" y="${ty + 2}" font-size="10" fill="${isRoot ? th.rootText : th.meta}" opacity="${isRoot ? 0.85 : 1}">${mmEscXml(meta)}</text>`;
    }

    if (prefs.mostrarBadge && n.children && n.children.length) {
      const cx = x + nodeW, cy = y;
      const badgeFill = collapsed ? "#f59e0b" : th.badge;
      const badgeTxt = collapsed ? "▸" : String(n.children.length);
      svg += `<g class="mm-toggle" data-item-id="${n.id}" style="cursor:pointer">`;
      svg += `<circle cx="${cx}" cy="${cy}" r="9.5" fill="${badgeFill}" stroke="${th.bg}" stroke-width="1.5"/>`;
      const badgeInk = (mmEnginePrefs && mmEnginePrefs.tema === "vale" && !collapsed) ? "#2F2F2F" : "#fff";
      svg += `<text x="${cx}" y="${cy + 3.5}" font-size="9.5" font-weight="800" fill="${badgeInk}" text-anchor="middle">${badgeTxt}</text>`;
      svg += `</g>`;
    }

    // Sinal "!" — integrar hierarquia (filho/pai) com outro grafo (só no editor)
    if (construction) {
      const ix = x + 12, iy = y + nodeH - 2;
      svg += `<g class="mm-integrate" data-item-id="${n.id}" style="cursor:pointer">`;
      svg += `<circle cx="${ix}" cy="${iy}" r="8.5" fill="#ef4444" stroke="${th.bg}" stroke-width="1.4"/>`;
      svg += `<text x="${ix}" y="${iy + 3.8}" font-size="11" font-weight="900" fill="#fff" text-anchor="middle">!</text>`;
      svg += `</g>`;
    }
    svg += `</g>`;
  });

  if (construction && typeof mmRenderGraphLinksSvg === "function") {
    svg += mmRenderGraphLinksSvg(layout, bounds);
  }

  return svg;
}

function mmRenderSVG(layout) {
  const { width, height } = layout;
  const pad = MM_PAD;
  const W = Math.round(width + pad * 2), H = Math.round(height + pad * 2);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="'Segoe UI', Inter, system-ui, sans-serif">${mmRenderSVGInner(layout)}</svg>`;
}

/** Liga clique nos nós do SVG: seleciona o item e abre seus detalhes na árvore.
 *  Usado nos canvas SOMENTE-LEITURA (miniatura do Dashboard). A ferramenta
 *  completa usa mmAttachEditHandlers() abaixo, que soma arraste-para-mover. */
function mmAttachClickHandlers(svgEl) {
  svgEl.querySelectorAll(".mm-node").forEach((g) => {
    g.style.cursor = "pointer";
    g.addEventListener("click", () => {
      const id = g.getAttribute("data-item-id");
      if (!id) return;
      selectItem(id);
      closeMindMapModal();
      showView("inventario");
      toast("Item selecionado a partir do mapa mental.");
    });
  });
}

/* ── Edição por arraste (ferramenta completa) ─────────────────────────────
   "Cérebro com sinapses editáveis": pegar um nó e soltar em outro = mover
   o item para esse novo pai. Clique curto (sem arrastar) continua abrindo
   o item na árvore, como antes — os dois gestos convivem no mesmo nó. */

const MM_LIMIAR_ARRASTE = 6; // px de tolerância antes de virar "arraste" em vez de "clique"
let _mmModo = "mover"; // "mover" | "linkar" | "conectar" | "adicionar"
let _mmConectarPendente = null; // {origemId, alvoId} aguardando o tipo de relação no mini-modal
let _mmIgnoreCanvasUntil = 0; // bloqueia clique fantasma após fechar modal de confirmação

/* ── Motor de edição abrangente (v3.7) ──────────────────────────────────────
   - Pan/zoom livre pelo canvas (viewport <g> com translate+scale).
   - Colapsar/expandir subárvores (badge de filhos vira toggle).
   - Undo/redo completo baseado em snapshot dos itens do site.
   - Renomear inline (input overlay posicionado sobre o nó).
   - Criar/excluir nó direto no canvas (clique no vazio = adiciona filho do
     nó focado; tecla Delete remove o nó focado).
   - Recortar/copiar/colar ramos inteiros (clipboard em memória). */
let _mmCollapsed = new Set();     // ids de nós colapsados
let _mmTx = 0, _mmTy = 0;          // translação do viewport (px do container)
let _mmFocusId = null;             // nó "focado" no canvas (alvo de criar/excluir/colar)
let _mmUndo = [], _mmRedo = [];    // pilhas de snapshot
let _mmClipboard = null;           // ramo copiado/recortado (estrutura {nome,categoria,...,children})
let _mmViewTool = null;            // null | "pan" | "realtime" | "window" — zoom display model

function mmSetModo(modo) {
  if (modo !== "mover" && modo !== "linkar" && modo !== "conectar" && modo !== "adicionar") modo = "mover";
  _mmModo = modo;
  if (typeof mmLinkClearPick === "function") mmLinkClearPick();
  document.querySelectorAll("#mmModoToggle .seg-btn").forEach((b) => {
    b.classList.toggle("active", b.dataset.modo === modo);
  });
  const msgs = {
    mover: "Modo Mover: arraste um nó sobre outro para reparentar.",
    linkar: "Modo Link: clique na origem e depois no destino. Cada extremidade recebe dados editáveis.",
    conectar: "Modo Conectar: arraste para criar dependência semântica.",
    adicionar: "Modo Adicionar: clique num nó-pai para criar um filho. Clique no vazio não cria nada.",
  };
  toast(msgs[modo] || msgs.mover);
}

/** Acha o nó SVG embaixo do cursor, ignorando o próprio nó sendo arrastado
 *  (que senão sempre "cobriria" o cursor e nunca deixaria ver o que tem
 *  embaixo, já que ele se move exatamente junto com o ponteiro). */
function mmElementoAlvo(gArrastado, x, y) {
  const prevPE = gArrastado.style.pointerEvents;
  gArrastado.style.pointerEvents = "none";
  const el = document.elementFromPoint(x, y);
  gArrastado.style.pointerEvents = prevPE;
  return el ? el.closest(".mm-node") : null;
}

/** Um alvo é válido se não for o próprio item nem nenhum dos seus
 *  descendentes (moveItemParent() faz a checagem definitiva ao soltar;
 *  isso aqui é só o preview visual enquanto arrasta). */
function mmValidaAlvo(itemId, alvoId) {
  if (itemId === alvoId) return false;
  const item = findItemById(itemId);
  if (!item) return false;
  if (item.parentId === alvoId) return true; // mesmo pai = solta de volta, sem erro
  return !collectChildren(itemId).includes(alvoId);
}

/** Validação equivalente, só que para o modo "Conectar" (dependência, não
 *  hierarquia) — usa a mesma detecção de ciclo do grafo de dependências. */
function mmValidaAlvoConectar(origemId, alvoId) {
  return origemId !== alvoId && !criaDependenciaCiclo(origemId, alvoId);
}

function mmTentarReparentar(itemId, novoParentId) {
  const item = findItemById(itemId);
  if (!item) return;
  mmPushUndo();
  const r = moveItemParent(itemId, novoParentId);
  if (!r.ok) {
    _mmUndo.pop(); // nada mudou: descarta o snapshot recém-criado
    mmRefreshUndoRedo();
    if (!r.semMudanca) toast(r.motivo, "error");
    return;
  }
  toast(`"${item.nome}" movido de "${r.nomeAntigo}" para "${r.nomeNovo}".`);
  mmEnsureBuilt(true); // recalcula árvore + layout com a nova estrutura
  mmDrawFull();         // redesenha o mapa, mantendo o zoom atual
  renderAll();          // sincroniza árvore lateral, KPIs, miniatura, etc.
}

/* ── Undo/redo completo (snapshot do site ativo) ────────────────────────────
   Cada edição empurra um snapshot de items + circuitos ANTES da mudança.
   Desfazer restaura o snapshot; refazer reaplica. Pilhas limpas ao trocar site. */

function mmSnapshot() {
  const s = activeSite();
  if (!s) return { items: [], circuitos: [], links: [], selectedItemId: null, focusId: null };
  try {
    return {
      items: JSON.parse(JSON.stringify(s.items || [])),
      circuitos: JSON.parse(JSON.stringify(s.circuitos || [])),
      links: JSON.parse(JSON.stringify(s.links || [])),
      selectedItemId: s.selectedItemId || null,
      focusId: _mmFocusId || null,
    };
  } catch (e) {
    console.error("mmSnapshot falhou:", e);
    toast("Não foi possível registrar o histórico (undo).", "error");
    return null;
  }
}

function mmRestoreSnapshot(snap) {
  const s = activeSite();
  if (!s || !snap) return;
  // compat: snapshots antigos eram só o array de items
  if (Array.isArray(snap)) {
    s.items = snap;
    return;
  }
  s.items = Array.isArray(snap.items) ? snap.items : [];
  s.circuitos = Array.isArray(snap.circuitos) ? snap.circuitos : (s.circuitos || []);
  s.links = Array.isArray(snap.links) ? snap.links : (s.links || []);
  s.selectedItemId = snap.selectedItemId || null;
  _mmFocusId = snap.focusId && s.items.some((i) => i.id === snap.focusId)
    ? snap.focusId
    : (s.selectedItemId || null);
}

function mmPushUndo() {
  const snap = mmSnapshot();
  if (!snap) return;
  _mmUndo.push(snap);
  if (_mmUndo.length > 50) _mmUndo.shift();
  _mmRedo = [];
  mmRefreshUndoRedo();
}

function mmRefreshUndoRedo() {
  const bU = document.getElementById("mmBtnDesfazer");
  const bR = document.getElementById("mmBtnRefazer");
  if (bU) bU.disabled = _mmUndo.length === 0;
  if (bR) bR.disabled = _mmRedo.length === 0;
}

function mmLimparPilhasDeOutroSite() {
  _mmUndo = [];
  _mmRedo = [];
  mmRefreshUndoRedo();
}

function mmUndo() {
  if (!_mmUndo.length) { toast("Nada para desfazer neste site.", "info"); return; }
  const atual = mmSnapshot();
  const anterior = _mmUndo.pop();
  if (atual) _mmRedo.push(atual);
  mmRestoreSnapshot(anterior);
  const s = activeSite();
  if (s) s.updatedAt = nowIso();
  scheduleAutosave();
  mmCollapsedClean();
  mmEnsureBuilt(true);
  mmDrawFull();
  renderAll();
  mmRefreshUndoRedo();
  toast("Desfeito.");
}

function mmRedo() {
  if (!_mmRedo.length) { toast("Nada para refazer neste site.", "info"); return; }
  const atual = mmSnapshot();
  const proximo = _mmRedo.pop();
  if (atual) _mmUndo.push(atual);
  mmRestoreSnapshot(proximo);
  const s = activeSite();
  if (s) s.updatedAt = nowIso();
  scheduleAutosave();
  mmCollapsedClean();
  mmEnsureBuilt(true);
  mmDrawFull();
  renderAll();
  mmRefreshUndoRedo();
  toast("Refeito.");
}

/* ── Modo "Conectar": arrastar cria uma dependência, não move a hierarquia ── */

function mmIniciarConectar(origemId, alvoId) {
  if (origemId === alvoId) return;
  const origem = findItemById(origemId), alvo = findItemById(alvoId);
  if (!origem || !alvo) return;
  if (criaDependenciaCiclo(origemId, alvoId)) {
    toast("Essa conexão criaria um ciclo. Operação bloqueada.", "error");
    return;
  }
  _mmConectarPendente = { origemId, alvoId };
  document.getElementById("mmConectarResumo").textContent = `"${origem.nome}" → "${alvo.nome}"`;
  document.getElementById("mmConectarModalBackdrop").classList.add("active");
}

function mmCancelarConectar() {
  _mmConectarPendente = null;
  document.getElementById("mmConectarModalBackdrop").classList.remove("active");
}

function mmConfirmarConectar() {
  if (!_mmConectarPendente) return;
  const { origemId, alvoId } = _mmConectarPendente;
  const tipo = document.getElementById("mmConectarTipo").value;
  const r = addDependencyDirect(origemId, alvoId, tipo);
  mmCancelarConectar();
  if (!r.ok) { toast(r.motivo, "error"); return; }
  toast(`Dependência "${tipo}" criada.`);
  renderAll();
}

function mmAttachEditHandlers(svgEl) {
  let estado = null;

  function limparRealceAlvo() {
    svgEl.querySelectorAll(".mm-drop-ok, .mm-drop-bad").forEach((el) => el.classList.remove("mm-drop-ok", "mm-drop-bad"));
  }

  svgEl.querySelectorAll(".mm-node").forEach((g) => {
    const id = g.getAttribute("data-item-id");
    const isRoot = _mmTree && id === _mmTree.id;
    g.style.cursor = _mmModo === "adicionar" ? "cell"
      : (_mmModo === "linkar" ? "crosshair" : (isRoot ? "pointer" : "grab"));

    g.addEventListener("pointerdown", (ev) => {
      if (Date.now() < _mmIgnoreCanvasUntil) return;
      if (_mmViewTool) return; // Display Model (zoom) tem prioridade sobre edição
      _mmFocusId = id;
      mmHighlightFocus(svgEl, id);
      mmUpdatePropPanel();
      if (typeof syncFocusItem === "function") syncFocusItem(id, { fromCanvas: true });
      // modo Adicionar: não inicia arraste — o clique curto cria o filho
      if (_mmModo === "adicionar") {
        estado = { id, startX: ev.clientX, startY: ev.clientY, dragging: false, soAdd: true };
        g.setPointerCapture(ev.pointerId);
        return;
      }
      // modo Link: clique origem → destino (qualquer grafo, inclusive raiz)
      if (_mmModo === "linkar") {
        estado = { id, startX: ev.clientX, startY: ev.clientY, dragging: false, soLink: true };
        g.setPointerCapture(ev.pointerId);
        return;
      }
      if (isRoot) return; // a raiz do site não se move
      ev.preventDefault();
      estado = { id, startX: ev.clientX, startY: ev.clientY, dragging: false, soAdd: false };
      g.setPointerCapture(ev.pointerId);
    });

    // duplo-clique = renomear inline (edição direta no canvas)
    g.addEventListener("dblclick", (ev) => {
      ev.stopPropagation();
      if (_mmModo === "adicionar") return; // evita conflito com criação
      _mmFocusId = id;
      mmStartInlineRename(id);
    });

    g.addEventListener("pointermove", (ev) => {
      if (!estado || estado.id !== id || estado.soAdd) return;
      const dx = ev.clientX - estado.startX, dy = ev.clientY - estado.startY;
      if (!estado.dragging && Math.hypot(dx, dy) > MM_LIMIAR_ARRASTE) {
        estado.dragging = true;
        g.classList.add("mm-dragging");
      }
      if (estado.dragging) {
        g.setAttribute("transform", `translate(${dx / _mmScale},${dy / _mmScale})`);
        limparRealceAlvo();
        const alvoG = mmElementoAlvo(g, ev.clientX, ev.clientY);
        if (alvoG && alvoG !== g) {
          const alvoId = alvoG.getAttribute("data-item-id");
          const valido = _mmModo === "mover" ? mmValidaAlvo(id, alvoId) : mmValidaAlvoConectar(id, alvoId);
          alvoG.classList.add(valido ? "mm-drop-ok" : "mm-drop-bad");
        }
      }
    });

    g.addEventListener("pointerup", (ev) => {
      if (!estado || estado.id !== id) return;
      const arrastou = estado.dragging;
      const soAdd = estado.soAdd;
      const soLink = estado.soLink;
      try { g.releasePointerCapture(ev.pointerId); } catch (e) {}
      g.removeAttribute("transform");
      g.classList.remove("mm-dragging");
      limparRealceAlvo();
      estado = null;

      if (Date.now() < _mmIgnoreCanvasUntil) return;

      if (soLink || _mmModo === "linkar") {
        if (!arrastou && typeof mmLinkPickNode === "function") mmLinkPickNode(id);
        return;
      }

      if (soAdd || _mmModo === "adicionar") {
        // clique deliberado no nó-pai → cria filho (nunca no vazio)
        if (!arrastou) mmAddChild(id);
        return;
      }

      if (!arrastou) {
        _mmFocusId = id;
        mmHighlightFocus(svgEl, id);
        mmUpdatePropPanel();
        setSelectedId(id);
        if (typeof syncFocusItem === "function") syncFocusItem(id, { fromCanvas: true });
        else if (typeof renderSidebarTree === "function") renderSidebarTree();
        return;
      }

      const alvoG = mmElementoAlvo(g, ev.clientX, ev.clientY);
      if (!alvoG || alvoG === g) return;
      const alvoId = alvoG.getAttribute("data-item-id");
      if (_mmModo === "mover") mmTentarReparentar(id, alvoId);
      else if (_mmModo === "conectar") mmIniciarConectar(id, alvoId);
    });

    g.addEventListener("pointercancel", () => {
      if (estado && estado.id === id) {
        g.removeAttribute("transform");
        g.classList.remove("mm-dragging");
        limparRealceAlvo();
        estado = null;
      }
    });
  });
}

/* ── Realce do nó focado (anel de seleção no canvas) ───────────────────────── */
function mmHighlightFocus(svgEl, id) {
  svgEl.querySelectorAll(".mm-node.mm-focus").forEach((n) => n.classList.remove("mm-focus"));
  if (!id) return;
  const g = svgEl.querySelector(`.mm-node[data-item-id="${id}"]`);
  if (g) g.classList.add("mm-focus");
}

/* ── Paleta "Propriedades" (dock direito, padrão CAD) ──────────────────────
   Espelha fielmente o item focado: nome, categoria, tipo e criticidade,
   editáveis direto no editor — a mesma filosofia da paleta de propriedades
   do AutoCAD/Revit. Aplicar entra no undo/redo como qualquer outra edição. */

function mmUpdatePropPanel() {
  const vazio = document.getElementById("mmPropVazio");
  const form = document.getElementById("mmPropForm");
  if (!vazio || !form) return;
  const item = _mmFocusId ? findItemById(_mmFocusId) : null;
  if (!item) {
    vazio.classList.remove("hidden");
    form.classList.add("hidden");
    return;
  }
  vazio.classList.add("hidden");
  form.classList.remove("hidden");
  const meta = typeof getAssetMeta === "function" ? getAssetMeta(item) : {};
  const pathEl = document.getElementById("mmPropPath");
  if (pathEl) pathEl.textContent = typeof itemPath === "function" ? itemPath(item.id) : "—";
  document.getElementById("mmPropNome").value = item.nome;
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v ?? ""; };
  set("mmPropTag", meta.tag || "");
  set("mmPropFab", meta.fabricante || "");
  set("mmPropStatus", meta.statusOperacional || "Operacional");
  set("mmPropValor", meta.valorDepreciado || "");
  set("mmPropCategoria", item.categoria || "");
  set("mmPropTipo", item.tipo || "");
  set("mmPropCrit", item.criticidade || "Média");
}

function mmApplyProps() {
  const item = _mmFocusId ? findItemById(_mmFocusId) : null;
  if (!item) { toast("Nenhum nó focado.", "info"); return; }
  const nome = typeof mmSanitizeText === "function"
    ? mmSanitizeText(document.getElementById("mmPropNome").value, 300)
    : document.getElementById("mmPropNome").value.trim();
  if (!nome) { toast("O nome não pode ficar vazio.", "error"); return; }
  const categoria = (document.getElementById("mmPropCategoria").value.trim() || "Não informado").slice(0, 200);
  const tipo = (document.getElementById("mmPropTipo").value.trim() || "Não informado").slice(0, 200);
  const crit = document.getElementById("mmPropCrit").value;
  mmPushUndo();
  item.nome = nome;
  item.categoria = categoria;
  item.tipo = tipo;
  item.criticidade = crit;
  if (typeof setAssetMeta === "function") {
    setAssetMeta(item, {
      tag: document.getElementById("mmPropTag")?.value,
      fabricante: document.getElementById("mmPropFab")?.value,
      statusOperacional: document.getElementById("mmPropStatus")?.value,
      valorDepreciado: document.getElementById("mmPropValor")?.value,
    });
  }
  item.updatedAt = nowIso();
  recordAudit("UPDATE", "item", item.id, `Propriedades EAM aplicadas: "${nome}".`);
  scheduleAutosave();
  mmEnsureBuilt(true);
  mmDrawFull();
  renderAll();
  if (typeof syncFocusItem === "function") syncFocusItem(item.id, { fromCanvas: true });
  toast("Propriedades aplicadas (mapa + Explorer sincronizados).");
}

function mmAbrirNoInventario() {
  if (!_mmFocusId) { toast("Nenhum nó focado.", "info"); return; }
  selectItem(_mmFocusId);
  closeMindMapModal();
  showView("inventario");
}

function mmRenameFocused() {
  if (!_mmFocusId) { toast("Selecione um nó no canvas primeiro.", "info"); return; }
  mmStartInlineRename(_mmFocusId);
}

/** Abre o Mapa de Dependências a partir do editor. Sai da tela cheia antes,
 *  senão o novo modal ficaria escondido atrás da camada de fullscreen. */
function mmAbrirDependencias() {
  if (document.fullscreenElement) document.exitFullscreen?.();
  openDepGraphModal();
}

function mmExpandAll() {
  if (!_mmCollapsed.size) { toast("Nenhum ramo colapsado.", "info"); return; }
  _mmCollapsed = new Set();
  mmEnsureBuilt(true);
  mmDrawFull();
  toast("Todos os ramos expandidos.");
}

/* ── Renomear inline (input overlay sobre o nó) ───────────────────────────── */
function mmStartInlineRename(itemId) {
  const item = findItemById(itemId);
  if (!item) return;
  const node = _mmLayoutData.nodes.find((n) => n.id === itemId);
  if (!node) return;
  const el = document.getElementById("mindMapFull");
  if (!el) return;
  const b = mmConstructionBounds(_mmLayoutData);
  const left = _mmTx + (node._x + b.pad + b.ox) * _mmScale;
  const top = _mmTy + (node._y + b.pad + b.oy) * _mmScale;
  const w = _mmLayoutData.nodeW * _mmScale;
  const h = _mmLayoutData.nodeH * _mmScale;

  const input = document.createElement("input");
  input.type = "text";
  input.value = item.nome;
  input.className = "mm-inline-input";
  Object.assign(input.style, {
    position: "absolute", left: left + "px", top: top + "px",
    width: w + "px", height: h + "px", zIndex: 50,
  });
  el.appendChild(input);
  input.focus();
  input.select();

  let done = false;
  const commit = (save) => {
    if (done) return;
    done = true;
    const v = input.value.trim();
    input.remove();
    if (save && v && v !== item.nome) {
      mmPushUndo();
      item.nome = v;
      item.updatedAt = nowIso();
      recordAudit("UPDATE", "item", item.id, `Item renomeado para "${v}".`);
      scheduleAutosave();
      mmEnsureBuilt(true);
      mmDrawFull();
      renderAll();
    }
  };
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); commit(true); }
    else if (e.key === "Escape") { e.preventDefault(); commit(false); }
  });
  input.addEventListener("blur", () => commit(true));
}

/* ── Criar nó (somente por ação explícita) ───────────────────────────────────
   NUNCA pelo clique no vazio. Caminhos válidos:
   - Botão "Criar filho" / tecla Insert (com nó focado)
   - Modo "Adicionar": clique deliberado num nó-pai */

function mmAddChild(parentIdOpt) {
  const parentId = parentIdOpt || _mmFocusId;
  if (!parentId) { toast("Selecione um nó-pai primeiro (ou ative o modo Adicionar e clique nele).", "info"); return; }
  const pai = findItemById(parentId);
  if (!pai) return;
  mmPushUndo();
  const novoId = addItem("Novo item", pai.categoria || "Não informado", pai.tipo || "Não informado", pai.criticidade || "Média", pai.id, "");
  const novo = findItemById(novoId);
  if (novo && typeof inheritFromParent === "function") inheritFromParent(novo, pai);
  _mmFocusId = novoId;
  mmCollapsedClean();
  mmEnsureBuilt(true);
  mmDrawFull();
  renderAll();
  mmRefreshUndoRedo();
  if (typeof syncFocusItem === "function") syncFocusItem(novoId, { fromCanvas: true });
  toast(`Filho criado em "${pai.nome}".`);
}

/* ── Excluir nó focado (e sua subárvore) — reversível via Desfazer ─────────── */
async function mmDeleteFocused() {
  if (!_mmFocusId) { toast("Selecione um nó no canvas primeiro.", "info"); return; }
  const item = findItemById(_mmFocusId);
  if (!item) return;
  if (item.parentId === null) { toast("A raiz do site não pode ser excluída.", "error"); return; }
  const ok = await confirmarDialog(`Excluir "${item.nome}" e seus descendentes?`, {
    titulo: "Excluir nó", confirmText: "Excluir", danger: true,
  });
  // evita que o "mouseup" do botão do modal caia no canvas e dispare outra ação
  _mmIgnoreCanvasUntil = Date.now() + 400;
  if (!ok) return;
  const parentId = item.parentId;
  const undoAntes = _mmUndo.length;
  mmPushUndo(); // snapshot COM o item — Desfazer restaura a exclusão
  if (_mmUndo.length === undoAntes) {
    toast("Não foi possível registrar o Desfazer. Exclusão cancelada.", "error");
    return;
  }
  const ids = collectChildren(item.id);
  ids.push(item.id);
  ids.forEach((rid) => pruneDependenciesTo(rid));
  if (typeof pruneLinksTo === "function") pruneLinksTo(ids);
  const site = activeSite();
  // remove circuitos que dependiam só dos nós excluídos
  if (Array.isArray(site.circuitos)) {
    site.circuitos = site.circuitos.filter((c) => {
      const trechos = c.trechos || [];
      return !trechos.some((t) => ids.includes(t.itemId));
    });
  }
  recordAudit("DELETE", "item", item.id, `${item.nome} e ${ids.length - 1} descendente(s) excluídos pelo mapa mental.`);
  site.items = site.items.filter((i) => !ids.includes(i.id));
  site.updatedAt = nowIso();
  scheduleAutosave();
  _mmFocusId = parentId;
  mmEnsureBuilt(true);
  mmDrawFull();
  renderAll();
  mmRefreshUndoRedo();
  toast("Nó excluído. Use Desfazer (Ctrl+Z) para reverter.");
}

/* ── Recortar / copiar / colar ramos inteiros ─────────────────────────────────
   O clipboard guarda uma cópia da subárvore (sem ids — eles são regenerados
   na cola). Recortar remove do site e guarda; colar insere como filho do nó
   focado. Tudo entra no undo/redo. */
function mmCloneSubtree(itemId) {
  const itens = activeItems();
  const node = itens.find((i) => i.id === itemId);
  if (!node) return null;
  function fromItem(it) {
    return {
      nome: it.nome, categoria: it.categoria, tipo: it.tipo,
      criticidade: it.criticidade, descricao: it.descricao || "",
      atributos: { ...(it.atributos || {}) },
      children: itens.filter((c) => c.parentId === it.id).map(fromItem),
    };
  }
  return fromItem(node);
}

function mmCopy() {
  if (!_mmFocusId) { toast("Selecione um nó para copiar.", "info"); return; }
  _mmClipboard = mmCloneSubtree(_mmFocusId);
  if (_mmClipboard) toast("Ramo copiado.");
}

async function mmCut() {
  if (!_mmFocusId) { toast("Selecione um nó para recortar.", "info"); return; }
  const item = findItemById(_mmFocusId);
  if (!item) return;
  if (item.parentId === null) { toast("A raiz do site não pode ser recortada.", "error"); return; }
  _mmClipboard = mmCloneSubtree(_mmFocusId);
  mmPushUndo();
  const ids = collectChildren(item.id);
  ids.push(item.id);
  ids.forEach((rid) => pruneDependenciesTo(rid));
  const site = activeSite();
  site.items = site.items.filter((i) => !ids.includes(i.id));
  site.updatedAt = nowIso();
  scheduleAutosave();
  _mmFocusId = item.parentId;
  mmEnsureBuilt(true);
  mmDrawFull();
  renderAll();
  mmRefreshUndoRedo();
  toast("Ramo recortado. Clique num nó e use Colar.");
}

function mmPaste() {
  if (!_mmClipboard) { toast("Nada na área de transferência.", "info"); return; }
  if (!_mmFocusId) { toast("Selecione um nó de destino primeiro.", "info"); return; }
  const pai = findItemById(_mmFocusId);
  if (!pai) return;
  mmPushUndo();
  let total = 0;
  function instantiate(node, parentId) {
    const novoId = addItem(node.nome, node.categoria, node.tipo, node.criticidade, parentId, node.descricao);
    total++;
    if (novoId && node.atributos) {
      const it = findItemById(novoId);
      if (it) it.atributos = { ...node.atributos };
    }
    (node.children || []).forEach((c) => instantiate(c, novoId));
  }
  instantiate(_mmClipboard, pai.id);
  mmEnsureBuilt(true);
  mmDrawFull();
  renderAll();
  toast(`${total} item(ns) colado(s) em "${pai.nome}".`);
}

/** Descarta ids colapsados que não existem mais (após excluir/importar). */
function mmCollapsedClean() {
  const ids = new Set(activeItems().map((i) => i.id));
  for (const id of [..._mmCollapsed]) if (!ids.has(id)) _mmCollapsed.delete(id);
}

/* ── Ferramenta completa: estado, abertura, zoom ─────────────────────────── */

let _mmTree = null, _mmLayoutData = null, _mmScale = 1;

function mmEnsureBuilt(forcar = false) {
  if (forcar || !_mmTree) {
    _mmTree = mmBuildTree();
    if (!_mmTree) return false;
    const opts = typeof mmEngineLayoutOpts === "function" ? mmEngineLayoutOpts() : {};
    _mmLayoutData = mmLayout(_mmTree, opts);
  }
  return true;
}

function openMindMapModal() {
  if (!mmEnsureBuilt(true)) {
    toast("Não há item raiz cadastrado neste site para gerar o mapa mental.", "error");
    return;
  }
  document.getElementById("mmSiteNome").textContent = activeSite().nome;
  mmRenderLegenda();
  mmRefreshUndoRedo();
  if (typeof mmSyncEnginePrefsUI === "function") mmSyncEnginePrefsUI();
  // foco inicial = seleção atual ou raiz
  _mmFocusId = selectedId() || (_mmTree && _mmTree.id) || null;
  document.getElementById("mindMapModalBackdrop").classList.add("active");
  mmFitView();
  mmDrawFull();
  if (_mmFocusId && typeof syncFocusItem === "function") syncFocusItem(_mmFocusId, { fromCanvas: true });
  // Abre direto em fullscreen; sair só via − / + / ✕ (Esc não fecha o editor)
  requestAnimationFrame(() => {
    mmMaximizeWindow();
    mmSyncWindowControls();
  });
}

function mmSyncEnginePrefsUI() {
  const setSeg = (id, attr, val) => {
    document.querySelectorAll(`#${id} .seg-btn`).forEach((b) => {
      b.classList.toggle("active", b.dataset[attr] === val);
    });
  };
  if (!mmEnginePrefs) return;
  setSeg("mmCfgTema", "tema", mmEnginePrefs.tema);
  setSeg("mmCfgTam", "tam", mmEnginePrefs.tamNo);
  setSeg("mmCfgConector", "con", mmEnginePrefs.conector);
  const c = (id, v) => { const el = document.getElementById(id); if (el) el.checked = !!v; };
  c("mmCfgGrade", mmEnginePrefs.grade);
  c("mmCfgMeta", mmEnginePrefs.mostrarMeta);
  c("mmCfgBadge", mmEnginePrefs.mostrarBadge);
  c("mmCfgIcone", mmEnginePrefs.mostrarIcone);
}

/* ── Popups das guias superiores (Propriedades | Saída | Aparência) ───────── */
const MM_GUIDE_MAP = {
  prop:    { tab: "mmPropTab",    popup: "mmPropPopup" },
  saida:   { tab: "mmSaidaTab",   popup: "mmSaidaPopup" },
  vista:   { tab: "mmVistaTab",   popup: "mmVistaPopup" },
  appear:  { tab: "mmAppearTab",  popup: "mmAppearPopup" },
  legenda: { tab: "mmLegendaTab", popup: "mmLegendaPopup" },
  ajuda:   { tab: "mmAjudaTab",   popup: "mmAjudaPopup" },
};

function mmCloseAllGuidePopups() {
  Object.values(MM_GUIDE_MAP).forEach(({ tab, popup }) => {
    const p = document.getElementById(popup);
    const t = document.getElementById(tab);
    if (p) p.setAttribute("hidden", "");
    if (t) t.setAttribute("aria-expanded", "false");
  });
}

function mmAnyGuidePopupOpen() {
  return Object.values(MM_GUIDE_MAP).some(({ popup }) => {
    const p = document.getElementById(popup);
    return p && !p.hasAttribute("hidden");
  });
}

/** Compat: chamadas antigas a mmCloseAppearPopup */
function mmCloseAppearPopup() {
  mmCloseAllGuidePopups();
}

function mmToggleGuidePopup(which, ev) {
  if (ev) ev.stopPropagation();
  const conf = MM_GUIDE_MAP[which];
  if (!conf) return;
  const popup = document.getElementById(conf.popup);
  const tab = document.getElementById(conf.tab);
  if (!popup || !tab) return;
  const jaAberto = !popup.hasAttribute("hidden");
  mmCloseAllGuidePopups();
  if (jaAberto) return;
  popup.removeAttribute("hidden");
  tab.setAttribute("aria-expanded", "true");
  if (which === "appear" && typeof mmSyncEnginePrefsUI === "function") mmSyncEnginePrefsUI();
  if (which === "prop" && typeof mmUpdatePropPanel === "function") mmUpdatePropPanel();
  if (which === "vista") mmSyncViewToolUI();
  if (which === "legenda") mmRenderLegenda();
}

/** Compat: chamadas antigas a mmToggleAppearPopup */
function mmToggleAppearPopup(ev) {
  mmToggleGuidePopup("appear", ev);
}

if (!window._mmGuideOutsideBound) {
  window._mmGuideOutsideBound = true;
  document.addEventListener("click", (e) => {
    if (!mmAnyGuidePopupOpen()) return;
    // fecha só se o clique estiver fora de todos os wraps de guia
    const wraps = document.querySelectorAll(".mm-appear-tab-wrap");
    for (const w of wraps) {
      if (w.contains(e.target)) return;
    }
    mmCloseAllGuidePopups();
  });
}

function mmSalvarProjeto() {
  try {
    saveToLocalStorage();
    setAutosaveStatus("salvo");
    recordAudit("SAVE", "mindmap", activeSite().id, "Projeto salvo pelo editor EAM.");
    toast("Projeto salvo (localStorage · pronto para sync Firestore).");
  } catch (e) {
    toast("Não foi possível salvar.", "error");
  }
}

function exportTreeSchemaFile() {
  const payload = typeof exportTreeSchema === "function" ? exportTreeSchema() : null;
  if (!payload) { toast("Não há árvore para exportar.", "error"); return; }
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${safeExportName(activeSite().codigo)}_eam_tree_schema.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  recordAudit("EXPORT", "mindmap", activeSite().id, "Schema EAM recursivo exportado.");
  scheduleAutosave();
  toast("Schema EAM (path + meta + children) exportado.");
}

function closeMindMapModal() {
  mmCloseAllGuidePopups();
  _mmViewTool = null;
  mmApplyViewCursor();
  const band = document.getElementById("mmZoomRubber");
  if (band) band.hidden = true;
  document.getElementById("mindMapModalBackdrop").classList.remove("active");
  if (document.fullscreenElement) document.exitFullscreen?.();
}

function mmEditorModalEl() {
  return document.querySelector("#mindMapModalBackdrop .modal");
}

/** Maximizar (+) — fullscreen do editor. */
function mmMaximizeWindow() {
  const modalEl = mmEditorModalEl();
  if (!modalEl || document.fullscreenElement === modalEl) return;
  (modalEl.requestFullscreen?.() || Promise.reject())
    .catch(() => toast("Este navegador não permite tela cheia aqui.", "error"));
}

/** Minimizar (−) — sai do fullscreen, mantém o editor aberto. */
function mmMinimizeWindow() {
  if (document.fullscreenElement) document.exitFullscreen?.();
}

/** Compat: chamadas antigas a mmToggleFullscreen */
function mmToggleFullscreen() {
  if (document.fullscreenElement) mmMinimizeWindow();
  else mmMaximizeWindow();
}

function mmSyncWindowControls() {
  const modalEl = mmEditorModalEl();
  const fs = document.fullscreenElement === modalEl;
  const btnMin = document.getElementById("mmBtnMinimize");
  const btnMax = document.getElementById("mmBtnMaximize");
  if (btnMin) {
    btnMin.disabled = !fs;
    btnMin.title = fs ? "Minimizar" : "Já minimizado";
  }
  if (btnMax) {
    btnMax.disabled = !!fs;
    btnMax.title = fs ? "Já maximizado" : "Maximizar";
  }
  const mmb = document.getElementById("mindMapModalBackdrop");
  if (mmb && mmb.classList.contains("active") && _mmLayoutData) {
    requestAnimationFrame(() => { mmFitView(); mmDrawFull(); });
  }
}

/** Compat: nome antigo do sync de fullscreen */
function mmSincronizarBotaoFullscreen() {
  mmSyncWindowControls();
}

/* ── Importar JSON (contrapartida do "Exportar JSON" desta mesma ferramenta) ──
   Substitui INTEIRAMENTE a árvore de itens do site ativo pela estrutura do
   arquivo — é a contraparte de restauração do que exportMindMapJSON() gera.
   Atributos/categoria/tipo/criticidade são preservados; dependências, fotos
   e checklist NÃO fazem parte desse formato (ficam zeradas nos itens
   recriados) — por isso a confirmação avisa antes de aplicar. */

function triggerImportMindMapJSON() {
  document.getElementById("mmImportInput").click();
}

function handleImportMindMapJSON(ev) {
  const file = ev.target.files[0];
  ev.target.value = "";
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async () => {
    let payload;
    try {
      payload = JSON.parse(reader.result);
    } catch (e) {
      toast("Arquivo inválido: não é um JSON legível.", "error");
      return;
    }
    let novosItens;
    try {
      novosItens = prepararItensMapaMental(payload);
    } catch (error) {
      toast(`Mapa mental rejeitado: ${error.message}.`, "error");
      return;
    }
    const totalNovo = novosItens.length;

    const nomeOrigem = payload.site?.nome || "(sem nome)";
    const confirmText =
      `Importar "${nomeOrigem}" (${totalNovo} itens) e SUBSTITUIR toda a árvore do site ativo ` +
      `"${activeSite().nome}" (${activeItems().length} itens atuais)?\n\n` +
      `Atributos, categoria, tipo e criticidade são importados. Dependências, fotos e checklist ` +
      `dos itens atuais serão perdidos (esse formato de arquivo não os contém).\n\n` +
      `Recomendado: exporte um backup completo antes (Relatórios → Exportar backup JSON).`;
    const ok = await confirmarDialog(confirmText, {
      titulo: "Importar mapa mental", confirmText: "Importar", danger: true,
    });
    if (!ok) return;

    activeSite().items = novosItens;
    activeSite().selectedItemId = null;
    activeSite().updatedAt = nowIso();
    _mmUndo = []; _mmRedo = []; // árvore trocou: histórico de desfazer não se aplica mais
    recordAudit("IMPORT", "mindmap", activeSite().id, `Mapa mental importado com ${totalNovo} item(ns).`);
    scheduleAutosave();
    mmEnsureBuilt(true);
    mmFitView();
    mmDrawFull();
    mmRefreshUndoRedo();
    renderAll();
    toast(`Árvore importada: ${totalNovo} itens.`);
  };
  reader.readAsText(file);
}

function prepararItensMapaMental(payload) {
  if (!payload || !payload.arvore || typeof payload.arvore !== "object") {
    throw new Error('formato esperado de "Exportar JSON" não encontrado');
  }
  const novosItens = [];
  const fila = [{ node: payload.arvore, parentId: null, depth: 0 }];
  while (fila.length) {
    if (novosItens.length >= 5000) throw new Error("limite de 5.000 itens excedido");
    const { node, parentId, depth } = fila.shift();
    if (!node || typeof node !== "object" || Array.isArray(node)) throw new Error("nó inválido");
    if (depth > 100) throw new Error("profundidade máxima de 100 níveis excedida");
    const children = node.children == null ? [] : node.children;
    if (!Array.isArray(children)) throw new Error("lista de filhos inválida");
    const attrs = node.atributos && typeof node.atributos === "object" && !Array.isArray(node.atributos)
      ? Object.fromEntries(Object.entries(node.atributos).slice(0, 200).map(([key, value]) => [String(key).slice(0, 200), String(value ?? "").slice(0, 2000)]))
      : {};
    const novoId = uid();
    novosItens.push({
      id: novoId,
      parentId,
      nome: String(node.nome || "(sem nome)").trim().slice(0, 300) || "(sem nome)",
      categoria: String(node.categoria || "Não informado").trim().slice(0, 200) || "Não informado",
      tipo: String(node.tipo || "Não informado").trim().slice(0, 200) || "Não informado",
      criticidade: ["Baixa", "Média", "Alta", "Crítica"].includes(node.criticidade) ? node.criticidade : "Média",
      descricao: String(node.descricao || "").slice(0, 4000),
      atributos: attrs,
      dependencias: [], fotos: [], checklist: [],
      createdAt: nowIso(), updatedAt: nowIso(),
    });
    children.forEach((child) => fila.push({ node: child, parentId: novoId, depth: depth + 1 }));
  }
  validarIntegridadeSite({ ...activeSite(), items: novosItens });
  return novosItens;
}

function mmDrawFull() {
  const el = document.getElementById("mindMapFull");
  if (!el || !_mmLayoutData) return;
  const cw = el.clientWidth || 800, ch = el.clientHeight || 520;
  const th = typeof mmEngineTheme === "function" ? mmEngineTheme() : { bg: "#f4f8f6" };
  const modal = document.querySelector("#mindMapModalBackdrop .mm-editor");
  if (modal) modal.classList.toggle("mm-vale", !(mmEnginePrefs && mmEnginePrefs.tema === "claro"));
  // Fundo do Display = preenchimento do plano (área virtual = construção)
  const planeBg = (mmEnginePrefs && mmEnginePrefs.tema === "vale") ? "#252525" : "#eef3f0";
  const inner = mmRenderSVGInner(_mmLayoutData, { construction: true });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${cw} ${ch}" width="100%" height="100%" font-family="Aptos Narrow, 'Segoe UI Narrow', Arial Narrow, sans-serif" preserveAspectRatio="none">`
    + `<rect class="mm-canvas-bg" x="0" y="0" width="${cw}" height="${ch}" fill="${planeBg}"/>`
    + `<g id="mmViewport" transform="translate(${_mmTx} ${_mmTy}) scale(${_mmScale})">${inner}</g>`
    + `</svg>`;
  el.innerHTML = svg;
  const svgEl = el.querySelector("svg");
  if (svgEl) {
    mmAttachEditHandlers(svgEl);
    mmAttachPanZoom(svgEl);
    mmAttachToggle(svgEl);
    if (typeof mmAttachLinkHandlers === "function") mmAttachLinkHandlers(svgEl);
    mmAttachIntegrate(svgEl);
    if (_mmFocusId && !findItemById(_mmFocusId)) _mmFocusId = null; // foco morto após excluir/importar
    mmHighlightFocus(svgEl, _mmFocusId);
  }
  mmUpdatePropPanel();
}

const MM_SCALE_MIN = 0.15;
const MM_SCALE_MAX = 4;

/** Enquadra o plano de construção para ocupar 100% do Display Model. */
function mmFitView() {
  const el = document.getElementById("mindMapFull");
  if (!el || !_mmLayoutData) return;
  const cw = el.clientWidth || 800, ch = el.clientHeight || 520;
  const { ww: W, hw: H, xMin, yMin } = mmConstructionBounds(_mmLayoutData);
  // Proporção do plano = Display ⇒ escala única preenche a área virtual inteira
  const s = Math.min(cw / W, ch / H);
  _mmScale = Math.max(MM_SCALE_MIN, Math.min(MM_SCALE_MAX, +s.toFixed(4)));
  _mmTx = -xMin * _mmScale;
  _mmTy = -yMin * _mmScale;
}

/** Zoom mantendo o ponto sob o cursor (ou o centro) fixo no canvas. */
function mmZoomAt(px, py, fator) {
  const novo = Math.min(MM_SCALE_MAX, Math.max(MM_SCALE_MIN, +(_mmScale * fator).toFixed(3)));
  if (novo === _mmScale) return;
  const wx = (px - _mmTx) / _mmScale, wy = (py - _mmTy) / _mmScale;
  _mmScale = novo;
  _mmTx = px - wx * novo;
  _mmTy = py - wy * novo;
  mmApplyViewportTransform();
}

function mmApplyViewportTransform() {
  const g = document.querySelector("#mindMapFull #mmViewport");
  if (g) g.setAttribute("transform", `translate(${_mmTx} ${_mmTy}) scale(${_mmScale})`);
}

function mmZoom(delta) {
  const el = document.getElementById("mindMapFull");
  const cx = el ? el.clientWidth / 2 : 400, cy = el ? el.clientHeight / 2 : 260;
  mmZoomAt(cx, cy, 1 + delta);
}

function mmResetZoom() {
  mmZoomExtend();
}

/** Zoom Extend — enquadra todo o modelo no display. */
function mmZoomExtend() {
  mmFitView();
  mmDrawFull();
}

/** Zoom Window — enquadra o retângulo (coords do container mindMapFull). */
function mmZoomToRect(x1, y1, x2, y2) {
  const el = document.getElementById("mindMapFull");
  if (!el) return;
  const left = Math.min(x1, x2), top = Math.min(y1, y2);
  const w = Math.abs(x2 - x1), h = Math.abs(y2 - y1);
  if (w < 10 || h < 10) { toast("Janela muito pequena. Arraste uma área maior.", "info"); return; }
  const wx1 = (left - _mmTx) / _mmScale;
  const wy1 = (top - _mmTy) / _mmScale;
  const wx2 = (left + w - _mmTx) / _mmScale;
  const wy2 = (top + h - _mmTy) / _mmScale;
  const ww = Math.abs(wx2 - wx1), wh = Math.abs(wy2 - wy1);
  if (ww < 1 || wh < 1) return;
  const cw = el.clientWidth || 800, ch = el.clientHeight || 520;
  const s = Math.min(cw / ww, ch / wh) * 0.95;
  _mmScale = Math.max(MM_SCALE_MIN, Math.min(MM_SCALE_MAX, +s.toFixed(3)));
  _mmTx = cw / 2 - ((wx1 + wx2) / 2) * _mmScale;
  _mmTy = ch / 2 - ((wy1 + wy2) / 2) * _mmScale;
  mmDrawFull();
}

/* ── Ferramentas de Visualização (Display Model) ──────────────────────────── */

function mmSetViewTool(tool) {
  if (tool === "extend") {
    mmZoomExtend();
    toast("Zoom Extend: modelo enquadrado no display.");
    mmSyncViewToolUI();
    return;
  }
  if (tool !== "pan" && tool !== "realtime" && tool !== "window") {
    _mmViewTool = null;
  } else {
    _mmViewTool = (_mmViewTool === tool) ? null : tool;
  }
  mmSyncViewToolUI();
  mmApplyViewCursor();
  const msgs = {
    pan: "Zoom Pan ativo: arraste o display para navegar. Clique de novo para desligar.",
    realtime: "Zoom Realtime ativo: arraste para cima = aproxima, para baixo = afasta.",
    window: "Zoom Window ativo: arraste um retângulo na área a ampliar.",
  };
  if (_mmViewTool) toast(msgs[_mmViewTool]);
  else toast("Ferramenta de zoom desligada. Edição do mapa liberada.");
}

function mmSyncViewToolUI() {
  document.querySelectorAll("[data-viewtool]").forEach((b) => {
    const t = b.dataset.viewtool;
    b.classList.toggle("active", t === _mmViewTool);
  });
}

function mmApplyViewCursor() {
  const el = document.getElementById("mindMapFull");
  if (!el) return;
  el.classList.remove("mm-tool-pan", "mm-tool-realtime", "mm-tool-window");
  if (_mmViewTool) el.classList.add("mm-tool-" + _mmViewTool);
}

function mmEnsureRubberBand() {
  const host = document.getElementById("mindMapFull");
  if (!host) return null;
  let band = document.getElementById("mmZoomRubber");
  if (!band) {
    band = document.createElement("div");
    band.id = "mmZoomRubber";
    band.className = "mm-zoom-rubber";
    band.hidden = true;
    host.appendChild(band);
  }
  return band;
}

/* ── Pan / zoom display + ferramentas de Visualização ─────────────────────── */

/** Superfície CAD: bloqueia seleção nativa de texto no Display Model. */
function mmBindDisplaySurface(hostEl, svgEl) {
  if (svgEl) {
    svgEl.setAttribute("focusable", "false");
    svgEl.style.webkitUserSelect = "none";
    svgEl.style.userSelect = "none";
  }
  if (!hostEl || hostEl.dataset.mmSurfaceBound === "1") return;
  hostEl.dataset.mmSurfaceBound = "1";
  const blockSelect = (ev) => {
    if (ev.target && ev.target.closest && ev.target.closest(".mm-inline-input")) return;
    ev.preventDefault();
  };
  hostEl.addEventListener("selectstart", blockSelect);
  hostEl.addEventListener("dragstart", blockSelect);
  hostEl.addEventListener("pointerdown", (ev) => {
    if (ev.target && ev.target.closest && ev.target.closest(".mm-inline-input")) return;
    window.getSelection?.()?.removeAllRanges?.();
  }, true);
}

function mmAttachPanZoom(svgEl) {
  const el = svgEl.parentElement;
  let gesture = null; // { kind, ... }
  mmBindDisplaySurface(el, svgEl);

  function localXY(ev) {
    const rect = el.getBoundingClientRect();
    return { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
  }

  svgEl.addEventListener("pointerdown", (ev) => {
    if (Date.now() < _mmIgnoreCanvasUntil) return;
    // Display Model ≠ documento de texto: impede seleção nativa ao clicar/arrastar
    if (!(ev.target && ev.target.closest && ev.target.closest(".mm-inline-input"))) {
      ev.preventDefault();
      window.getSelection?.()?.removeAllRanges?.();
    }

    // Ferramentas de Visualização: capturam o gesto no display inteiro
    if (_mmViewTool === "pan" || _mmViewTool === "realtime" || _mmViewTool === "window") {
      ev.preventDefault();
      const loc = localXY(ev);
      if (_mmViewTool === "pan") {
        gesture = { kind: "pan", x: ev.clientX, y: ev.clientY, tx: _mmTx, ty: _mmTy };
      } else if (_mmViewTool === "realtime") {
        gesture = {
          kind: "realtime",
          y0: ev.clientY,
          scale0: _mmScale,
          cx: loc.x,
          cy: loc.y,
          tx0: _mmTx,
          ty0: _mmTy,
        };
      } else {
        gesture = { kind: "window", x0: loc.x, y0: loc.y, x1: loc.x, y1: loc.y };
        const band = mmEnsureRubberBand();
        if (band) {
          band.hidden = false;
          Object.assign(band.style, { left: loc.x + "px", top: loc.y + "px", width: "0px", height: "0px" });
        }
      }
      svgEl.setPointerCapture(ev.pointerId);
      return;
    }

    // Padrão: pan só no fundo (não nos nós)
    if (ev.target.closest(".mm-node")) return;
    gesture = { kind: "pan", x: ev.clientX, y: ev.clientY, tx: _mmTx, ty: _mmTy };
    svgEl.setPointerCapture(ev.pointerId);
    svgEl.style.cursor = "grabbing";
  });

  svgEl.addEventListener("pointermove", (ev) => {
    if (!gesture) return;
    if (gesture.kind === "pan") {
      _mmTx = gesture.tx + (ev.clientX - gesture.x);
      _mmTy = gesture.ty + (ev.clientY - gesture.y);
      mmApplyViewportTransform();
      return;
    }
    if (gesture.kind === "realtime") {
      if (gesture.tx0 == null) {
        gesture.tx0 = _mmTx;
        gesture.ty0 = _mmTy;
      }
      const dy = ev.clientY - gesture.y0;
      const fator = Math.exp(-dy * 0.01);
      const novo = Math.min(MM_SCALE_MAX, Math.max(MM_SCALE_MIN, +(gesture.scale0 * fator).toFixed(3)));
      const wlx = (gesture.cx - gesture.tx0) / gesture.scale0;
      const wly = (gesture.cy - gesture.ty0) / gesture.scale0;
      _mmScale = novo;
      _mmTx = gesture.cx - wlx * novo;
      _mmTy = gesture.cy - wly * novo;
      mmApplyViewportTransform();
      return;
    }
    if (gesture.kind === "window") {
      const loc = localXY(ev);
      gesture.x1 = loc.x;
      gesture.y1 = loc.y;
      const band = document.getElementById("mmZoomRubber");
      if (band) {
        const left = Math.min(gesture.x0, gesture.x1);
        const top = Math.min(gesture.y0, gesture.y1);
        band.style.left = left + "px";
        band.style.top = top + "px";
        band.style.width = Math.abs(gesture.x1 - gesture.x0) + "px";
        band.style.height = Math.abs(gesture.y1 - gesture.y0) + "px";
      }
    }
  });

  const endGesture = (ev) => {
    if (!gesture) return;
    const g = gesture;
    gesture = null;
    try { svgEl.releasePointerCapture(ev.pointerId); } catch (e) {}
    svgEl.style.cursor = "";
    mmApplyViewCursor();
    if (g.kind === "window") {
      const band = document.getElementById("mmZoomRubber");
      if (band) band.hidden = true;
      mmZoomToRect(g.x0, g.y0, g.x1, g.y1);
    }
  };

  svgEl.addEventListener("pointerup", endGesture);
  svgEl.addEventListener("pointercancel", endGesture);

  svgEl.addEventListener("wheel", (ev) => {
    ev.preventDefault();
    const rect = el.getBoundingClientRect();
    const px = ev.clientX - rect.left, py = ev.clientY - rect.top;
    const fator = ev.deltaY < 0 ? 1.12 : 1 / 1.12;
    mmZoomAt(px, py, fator);
  }, { passive: false });

  mmApplyViewCursor();
}

/* ── Colapsar/expandir subárvores (toggle no badge de filhos) ─────────────── */

function mmAttachToggle(svgEl) {
  svgEl.querySelectorAll(".mm-toggle").forEach((t) => {
    const id = t.getAttribute("data-item-id");
    t.addEventListener("pointerdown", (e) => { e.stopPropagation(); }); // não inicia arraste do nó
    t.addEventListener("click", (e) => {
      e.stopPropagation();
      if (_mmCollapsed.has(id)) _mmCollapsed.delete(id);
      else _mmCollapsed.add(id);
      mmEnsureBuilt(true);
      mmDrawFull();
    });
  });
}

/* ── Integrar grafo (!) — tornar filho ou pai de outro nó ─────────────────── */

let _mmIntegrateId = null;

function mmAttachIntegrate(svgEl) {
  svgEl.querySelectorAll(".mm-integrate").forEach((t) => {
    const id = t.getAttribute("data-item-id");
    t.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
      e.preventDefault();
    });
    t.addEventListener("click", (e) => {
      e.stopPropagation();
      e.preventDefault();
      mmOpenIntegratePopup(id);
    });
  });
}

function mmOpenIntegratePopup(itemId) {
  const item = findItemById(itemId);
  const backdrop = document.getElementById("mmIntegrateModalBackdrop");
  if (!item || !backdrop) return;
  _mmIntegrateId = itemId;
  _mmFocusId = itemId;
  document.getElementById("mmIntegrateNome").textContent = item.nome;
  const isRoot = item.parentId === null;
  const sel = document.getElementById("mmIntegrateAlvo");
  const itens = activeItems()
    .filter((i) => i.id !== itemId)
    .filter((i) => {
      // não listar descendentes do item (evitaria ciclo se ele virasse filho deles)
      return !collectChildren(itemId).includes(i.id);
    })
    .sort((a, b) => String(a.nome).localeCompare(String(b.nome), "pt-BR"));
  sel.innerHTML = itens.length
    ? itens.map((i) => {
      const marca = i.parentId === null ? " (raiz)" : "";
      return `<option value="${i.id}">${mmEscXml(i.nome)}${marca}</option>`;
    }).join("")
    : `<option value="">— nenhum grafo disponível —</option>`;

  const optFilho = document.getElementById("mmIntegratePapelFilho");
  const optPai = document.getElementById("mmIntegratePapelPai");
  if (optFilho) {
    optFilho.disabled = isRoot;
    optFilho.checked = !isRoot;
  }
  if (optPai) {
    optPai.disabled = false;
    optPai.checked = isRoot;
  }
  const aviso = document.getElementById("mmIntegrateAviso");
  if (aviso) {
    aviso.hidden = !isRoot;
    aviso.textContent = isRoot
      ? "A raiz do site não pode se tornar filha. Você só pode torná-la pai de outro grafo."
      : "";
  }
  backdrop.classList.add("active");
}

function mmCloseIntegratePopup() {
  _mmIntegrateId = null;
  document.getElementById("mmIntegrateModalBackdrop")?.classList.remove("active");
}

function mmConfirmarIntegrate() {
  const itemId = _mmIntegrateId;
  const alvoId = document.getElementById("mmIntegrateAlvo")?.value;
  const papel = document.querySelector('input[name="mmIntegratePapel"]:checked')?.value;
  if (!itemId || !alvoId) {
    toast("Selecione outro grafo para integrar.", "info");
    return;
  }
  if (papel !== "filho" && papel !== "pai") {
    toast("Escolha se este grafo será filho ou pai.", "info");
    return;
  }

  // filho = este item passa a ter o alvo como pai
  // pai   = o alvo passa a ter este item como pai
  const moverId = papel === "filho" ? itemId : alvoId;
  const novoPaiId = papel === "filho" ? alvoId : itemId;

  mmCloseIntegratePopup();
  _mmIgnoreCanvasUntil = Date.now() + 400;
  mmTentarReparentar(moverId, novoPaiId);
}

function mmRenderLegenda() {
  const el = document.getElementById("mmLegenda");
  if (!el) return;
  const dot = (cor) => `<span class="mm-legenda-swatch" style="background:${cor}"></span>`;
  el.innerHTML = `
    <span class="pill">${dot(MM_COR.raiz)}Site (raiz)</span>
    <span class="pill">${dot(MM_COR["Crítica"])}Crítica</span>
    <span class="pill">${dot(MM_COR["Alta"])}Alta</span>
    <span class="pill">${dot(MM_COR["Média"])}Média</span>
    <span class="pill">${dot(MM_COR["Baixa"])}Baixa</span>
    <span class="pill">🔵 número = sub-itens diretos</span>
    <span class="pill">❗ integrar filho/pai</span>
  `;
}

/* ── Exportações: PNG, PDF, JSON, impressão ──────────────────────────────── */

/* ── Utilitário compartilhado: SVG (string) → <canvas> rasterizado ───────
   Usado pela exportação PNG/PDF de QUALQUER ferramenta de mapa do app
   (hierárquico aqui, e o Mapa de Dependências em depgraph.js). Extraído
   para um único lugar para não duplicar a lógica de canvas em cada tool. */
function svgParaCanvas(svgStr, w, h, scale = 2) {
  return new Promise((resolve, reject) => {
    const svgBlob = new Blob([svgStr], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(svgBlob);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(w * scale);
      canvas.height = Math.round(h * scale);
      const ctx = canvas.getContext("2d");
      ctx.scale(scale, scale);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      resolve(canvas);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("falha-svg")); };
    img.src = url;
  });
}

function _mmSvgToCanvas(scale = 2) {
  if (!mmEnsureBuilt()) return Promise.reject(new Error("sem-arvore"));
  const svgStr = mmRenderSVG(_mmLayoutData);
  const w = _mmLayoutData.width + 48, h = _mmLayoutData.height + 48;
  return svgParaCanvas(svgStr, w, h, scale);
}

async function exportMindMapPNG() {
  try {
    const canvas = await _mmSvgToCanvas(2);
    const a = document.createElement("a");
    a.href = canvas.toDataURL("image/png");
    a.download = `${safeExportName(activeSite().codigo)}_mapa_mental.png`;
    a.click();
    recordAudit("EXPORT", "mindmap", activeSite().id, "Mapa mental exportado em PNG.");
    scheduleAutosave();
    toast("Mapa mental exportado em PNG.");
  } catch (e) {
    toast(e.message === "sem-arvore" ? "Não há item raiz cadastrado neste site." : "Não foi possível gerar o PNG.", "error");
  }
}

async function exportMindMapPDF() {
  if (typeof window.jspdf === "undefined") {
    toast("Biblioteca de PDF não carregada. Verifique sua conexão.", "error");
    return;
  }
  try {
    const canvas = await _mmSvgToCanvas(2);
    const { jsPDF } = window.jspdf;
    const cabecalho = 90;
    const W = canvas.width, H = canvas.height;
    const doc = new jsPDF({ unit: "px", format: [W, H + cabecalho], orientation: W >= H ? "landscape" : "portrait" });

    doc.setFillColor(0, 122, 83);
    doc.rect(0, 0, W, cabecalho, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(20);
    doc.text(`Mapa Mental — ${activeSite().nome}`, 22, 32);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    doc.text(
      `Código ${activeSite().codigo}  ·  Criticidade do site: ${activeSite().criticidade}  ·  ${activeItems().length} itens  ·  Gerado em ${new Date().toLocaleString("pt-BR")}`,
      22, 54
    );
    doc.text("CFI Serviços — Inventário Inteligente de Sites Telecom", 22, 72);

    doc.addImage(canvas.toDataURL("image/png"), "PNG", 0, cabecalho, W, H);
    doc.save(`${safeExportName(activeSite().codigo)}_mapa_mental.pdf`);
    recordAudit("EXPORT", "mindmap", activeSite().id, "Mapa mental exportado em PDF.");
    scheduleAutosave();
    toast("PDF do mapa mental exportado.");
  } catch (e) {
    console.error(e);
    toast(e.message === "sem-arvore" ? "Não há item raiz cadastrado neste site." : "Não foi possível gerar o PDF.", "error");
  }
}

function exportMindMapJSON() {
  if (!mmEnsureBuilt()) {
    toast("Não há item raiz cadastrado neste site.", "error");
    return;
  }
  const payload = {
    ferramenta: "Mapa Mental — CFI Serviços",
    gerado_em: new Date().toISOString(),
    site: {
      nome: activeSite().nome, codigo: activeSite().codigo,
      criticidade: activeSite().criticidade,
      latitude: activeSite().latitude, longitude: activeSite().longitude,
    },
    total_itens: activeItems().length,
    arvore: _mmTree,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${safeExportName(activeSite().codigo)}_mapa_mental.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  recordAudit("EXPORT", "mindmap", activeSite().id, "Mapa mental exportado em JSON.");
  scheduleAutosave();
  toast("Estrutura do mapa mental exportada em JSON.");
}

function printMindMap() {
  if (!mmEnsureBuilt()) {
    toast("Não há item raiz cadastrado neste site.", "error");
    return;
  }
  const svgStr = mmRenderSVG(_mmLayoutData);
  const w = window.open("", "_blank");
  if (!w) {
    toast("Permita pop-ups neste navegador para imprimir o mapa mental.", "error");
    return;
  }
  const s = activeSite();
  w.document.write(`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">
<title>Mapa Mental — ${esc(s.nome)}</title>
<style>
  *{box-sizing:border-box;font-family:'Segoe UI',Inter,system-ui,sans-serif}
  body{margin:0;padding:22px;color:#18332b}
  header{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:3px solid #007a53;padding-bottom:12px;margin-bottom:16px}
  h1{margin:0;font-size:21px} p{margin:4px 0 0;color:#687b73;font-size:12px}
  .legenda{display:flex;gap:16px;margin-bottom:16px;font-size:11px;color:#31594c}
  .dot{display:inline-block;width:9px;height:9px;border-radius:3px;margin-right:5px;vertical-align:middle}
  footer{margin-top:16px;font-size:10px;color:#9aa9a2;text-align:right}
  @page{size:A3 landscape;margin:10mm}
</style></head><body>
  <header>
    <div>
      <h1>Mapa Mental — ${esc(s.nome)}</h1>
      <p>Código ${esc(s.codigo)} · Criticidade do site: ${esc(s.criticidade)} · ${activeItems().length} itens inventariados</p>
    </div>
    <p>Emitido em ${new Date().toLocaleString("pt-BR")}</p>
  </header>
  <div class="legenda">
    <span><span class="dot" style="background:${MM_COR.raiz}"></span>Site</span>
    <span><span class="dot" style="background:${MM_COR["Crítica"]}"></span>Crítica</span>
    <span><span class="dot" style="background:${MM_COR["Alta"]}"></span>Alta</span>
    <span><span class="dot" style="background:${MM_COR["Média"]}"></span>Média</span>
    <span><span class="dot" style="background:${MM_COR["Baixa"]}"></span>Baixa</span>
  </div>
  ${svgStr}
  <footer>CFI Serviços — Inventário Inteligente de Sites Telecom</footer>
  <script>window.onload=()=>setTimeout(()=>window.print(),300)</script>
</body></html>`);
  w.document.close();
}
