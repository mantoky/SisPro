/* ==========================================================================
   CFI Serviços — Inventário Inteligente de Sites Telecom
   render.js — Renderização da interface
   ==========================================================================
   CORREÇÕES (vs. protótipo original):
   - renderAll() agora é chamado de forma consistente em toda ação que
     altera o estado (remoção de atributo/dependência também atualiza KPIs).
   - Pílulas de dependência quebrada (item removido) ficam visualmente
     destacadas em vermelho.
   - Mapa mental é gerado dinamicamente a partir da árvore real do site,
     em vez de 9 nós fixos no código.

   - renderCatalogos(): Categoria/Tipo viram texto livre + sugestão
     (datalist) com os valores já usados em TODOS os sites — reduz
     divergência de nomenclatura sem travar a flexibilidade do campo.
   ========================================================================== */

function renderAll() {
  renderSiteSelector();
  renderSidebarTree();
  renderCatalogos();
  renderTree();
  renderParentOptions();
  renderInspection();
  renderMindMap();
  renderAuditLog();
  renderSiteStatus();
  if (selectedId()) renderItemDetails();
}

function renderSiteStatus() {
  const badge = document.getElementById("siteStatusBadge");
  const site = activeSite();
  if (!badge || !site) return;
  const classe = site.statusOperacional === "Operacional" ? "ok" : site.statusOperacional === "Indisponível" ? "danger" : "warn";
  badge.className = `status ${classe}`;
  badge.textContent = `● ${site.statusOperacional || "Operacional"}`;

  const prBadge = document.getElementById("prontuarioStatusBadge");
  if (prBadge) {
    const st = site.prontuarioStatus || "rascunho";
    const prClass =
      st === "concluido" ? "ok" :
      st === "devolvido_campo" || st === "enviado_pelo_tecnico" ? "warn" :
      st === "em_revisao" ? "warn" : "";
    prBadge.className = `status ${prClass}`.trim();
    prBadge.textContent = `📋 ${typeof prontuarioStatusLabel === "function" ? prontuarioStatusLabel(st) : st}`;
  }
}

/* ── Catálogo dinâmico de Categoria/Tipo (datalist) ───────────────────────
   Os campos continuam texto livre (não tira a flexibilidade do técnico
   em campo), mas agora sugerem os valores já usados em qualquer site,
   reduzindo o mesmo equipamento sendo grafado de formas diferentes. */

function renderCatalogos() {
  const dlCat = document.getElementById("catalogoCategoria");
  const dlTipo = document.getElementById("catalogoTipo");
  if (!dlCat || !dlTipo) return;
  const categorias = new Set(), tipos = new Set();
  state.sites.forEach((s) => (s.items || []).forEach((i) => {
    if (i.categoria) categorias.add(i.categoria);
    if (i.tipo) tipos.add(i.tipo);
  }));
  dlCat.innerHTML = [...categorias].sort().map((c) => `<option value="${esc(c)}">`).join("");
  dlTipo.innerHTML = [...tipos].sort().map((t) => `<option value="${esc(t)}">`).join("");
}

/* ── Seletor de sites ─────────────────────────────────────────────────── */

function renderSiteSelector() {
  const sel = document.getElementById("siteSelector");
  if (!sel) return;
  sel.innerHTML = "";
  state.sites.forEach((s) => {
    const o = document.createElement("option");
    o.value = s.id;
    o.textContent = `${s.nome} (${s.codigo})`;
    if (s.id === state.activeSiteId) o.selected = true;
    sel.appendChild(o);
  });
}

/* ── Árvore lateral padrão Explorer (v3.7) ────────────────────────────────
   A barra lateral agora navega o inventário inteiro: cada site é uma pasta
   expansível que revela sua hierarquia de itens. Clicar no site troca o site
   ativo; clicar no item seleciona e abre em Hierarquias. O estado de
   expansão fica em memória (_explorerExpanded); o site ativo abre sozinho. */

let _explorerExpanded = new Set();

function toggleExplorer(id) {
  if (_explorerExpanded.has(id)) _explorerExpanded.delete(id);
  else _explorerExpanded.add(id);
  renderSidebarTree();
}

function renderSidebarTree() {
  const cont = document.getElementById("sidebarTree");
  if (!cont) return;
  cont.replaceChildren();
  if (!state.sites.length) {
    const p = document.createElement("p");
    p.className = "muted";
    p.textContent = "Nenhum site cadastrado.";
    cont.appendChild(p);
    return;
  }
  // abre o site ativo por padrão se nada estiver aberto
  if (_explorerExpanded.size === 0 && state.activeSiteId) _explorerExpanded.add(state.activeSiteId);
  state.sites.forEach((site) => cont.appendChild(explorerSiteNode(site)));
}

function explorerSiteNode(site) {
  const expanded = _explorerExpanded.has(site.id);
  const node = document.createElement("div");
  node.className = "explorer-node";
  node.setAttribute("role", "treeitem");
  node.setAttribute("aria-expanded", expanded ? "true" : "false");

  const row = document.createElement("div");
  row.className = "explorer-row explorer-site" + (site.id === state.activeSiteId ? " active" : "");
  const chev = document.createElement("span");
  chev.className = "explorer-chev" + (expanded ? " open" : "");
  chev.textContent = expanded ? "▾" : "▸";
  const icon = document.createElement("span");
  icon.className = "explorer-icon";
  icon.textContent = expanded ? "📂" : "📁";
  const label = document.createElement("span");
  label.className = "explorer-label";
  label.textContent = `${site.nome} (${site.codigo})`;
  row.append(chev, icon, label);
  chev.addEventListener("click", (e) => { e.stopPropagation(); toggleExplorer(site.id); });
  row.addEventListener("click", () => { trocarSite(site.id); showView("dashboard"); });

  node.appendChild(row);
  if (expanded) {
    const kids = document.createElement("div");
    kids.className = "explorer-subtree";
    const root = (site.items || []).find((i) => i.parentId === null);
    if (root) kids.appendChild(explorerItemNode(root, site));
    node.appendChild(kids);
  }
  return node;
}

function explorerItemNode(item, site) {
  const expanded = _explorerExpanded.has(item.id);
  const hasKids = (site.items || []).some((i) => i.parentId === item.id);
  const node = document.createElement("div");
  node.className = "explorer-node";

  const row = document.createElement("div");
  row.className = "explorer-row explorer-item" + (item.id === selectedId() ? " active" : "");
  const chev = document.createElement("span");
  chev.className = "explorer-chev" + (expanded ? " open" : "") + (hasKids ? "" : " leaf");
  chev.textContent = hasKids ? (expanded ? "▾" : "▸") : "";
  const icon = document.createElement("span");
  icon.className = "explorer-icon";
  icon.textContent = hasKids && expanded ? "📂" : "📁";
  const label = document.createElement("span");
  label.className = "explorer-label";
  const tag = item.atributos && item.atributos.TAG;
  label.textContent = tag ? `${tag} · ${item.nome}` : item.nome;
  label.title = typeof itemPath === "function" ? itemPath(item.id, site) : item.nome;
  row.append(chev, icon, label);
  if (hasKids) chev.addEventListener("click", (e) => { e.stopPropagation(); toggleExplorer(item.id); });
  row.addEventListener("click", () => {
    // Bidirectional binding: Explorer ↔ Canvas (mesma Single Source of Truth)
    if (typeof mmIsEditorOpen === "function" && mmIsEditorOpen()) {
      if (site.id !== state.activeSiteId) {
        toast("O mapa mental está editando outro site. Feche-o ou troque o site ativo.", "info");
        return;
      }
      setSelectedId(item.id);
      if (typeof _mmFocusId !== "undefined") _mmFocusId = item.id;
      explorerRevealItem(item.id);
      const svg = document.querySelector("#mindMapFull svg");
      if (svg && typeof mmHighlightFocus === "function") mmHighlightFocus(svg, item.id);
      if (typeof mmUpdatePropPanel === "function") mmUpdatePropPanel();
      renderSidebarTree();
      return;
    }
    selectItem(item.id);
    showView("inventario");
  });

  node.appendChild(row);
  if (expanded && hasKids) {
    const kids = document.createElement("div");
    kids.className = "explorer-subtree";
    (site.items || []).filter((i) => i.parentId === item.id).forEach((c) => kids.appendChild(explorerItemNode(c, site)));
    node.appendChild(kids);
  }
  return node;
}

/* ── Árvore hierárquica (com busca/filtro) ────────────────────────────── */

let _filtroArvore = "";

function setFiltroArvore(texto) {
  _filtroArvore = (texto || "").trim().toLowerCase();
  renderTree();
}

/** Um item "casa" com o filtro se nome/categoria/tipo/criticidade contêm o termo. */
function itemCasaFiltro(item) {
  if (!_filtroArvore) return true;
  return [item.nome, item.categoria, item.tipo, item.criticidade]
    .some((campo) => String(campo || "").toLowerCase().includes(_filtroArvore));
}

/** Um item deve aparecer se ele casa, OU se algum descendente casa (mantém contexto). */
function itemOuDescendenteCasa(item) {
  if (itemCasaFiltro(item)) return true;
  return activeItems()
    .filter((i) => i.parentId === item.id)
    .some((filho) => itemOuDescendenteCasa(filho));
}

function renderTree() {
  tree.innerHTML = "";
  renderBreadcrumb();
  if (_filtroArvore) {
    renderArvoreBusca();
  } else {
    renderArvoreDrilldown();
  }
}

/* ── Breadcrumb do drill-down (caminho raiz → nível atual) ───────────────
   Cada crumb é clicável e sobe um nível. O último (foco atual) é o "aqui". */
function renderBreadcrumb() {
  const el = document.getElementById("arvoreBreadcrumb");
  if (!el) return;
  const path = pathToItem(focusItemId());
  if (!path.length) {
    el.innerHTML = '<span class="muted">Crie a raiz do site para começar.</span>';
    return;
  }
  el.replaceChildren();
  path.forEach((item, idx) => {
    if (idx > 0) {
      const sep = document.createElement("span");
      sep.className = "crumb-sep";
      sep.textContent = "›";
      el.appendChild(sep);
    }
    const isLast = idx === path.length - 1;
    const crumb = document.createElement("button");
    crumb.type = "button";
    crumb.className = "crumb" + (isLast ? " crumb-current" : "");
    crumb.textContent = item.nome;
    if (!isLast) {
      crumb.addEventListener("click", () => { setFocusItem(item.id); renderTree(); });
    }
    el.appendChild(crumb);
  });
}

/* ── Drill-down: mostra os FILHOS do nível atual (foco) ────────────────────
   Em vez da árvore inteira aninhada (que espreme os nós contra a borda no
   celular), o técnico vê um nível por vez. Tocar na linha abre o detalhe
   (bottom sheet no mobile); o "›" desce para os filhos daquele nó. */
function renderArvoreDrilldown() {
  const focus = focusItemId();
  if (!focus) {
    tree.innerHTML = '<p class="muted">Crie a raiz do site para visualizar a hierarquia.</p>';
    return;
  }
  const filhos = activeItems().filter((i) => i.parentId === focus);
  if (!filhos.length) {
    const msg = document.createElement("p");
    msg.className = "muted drill-empty";
    msg.textContent = "Nenhum item neste nível. Toque em + para adicionar um filho aqui.";
    tree.appendChild(msg);
    return;
  }
  filhos.forEach((item) => tree.appendChild(drillRow(item)));
}

/** Linha grande e tocável de um item (drill-down e busca). */
function drillRow(item) {
  const row = document.createElement("div");
  row.className = "node-line" + (selectedId() === item.id ? " active" : "");
  row.tabIndex = 0;
  row.setAttribute("role", "button");
  row.setAttribute("aria-label", item.nome);

  const temFilhos = activeItems().some((i) => i.parentId === item.id);

  const icon = document.createElement("span");
  icon.className = "node-icon";
  icon.textContent = "📁";

  const text = document.createElement("div");
  text.className = "node-text";
  const nome = document.createElement("strong");
  nome.textContent = item.nome;
  const meta = document.createElement("small");
  meta.className = "muted";
  meta.textContent = `${item.categoria} · ${item.criticidade}`;
  text.append(nome, meta);

  const resumo = resumirInspecaoItem(item);
  const badge = document.createElement("span");
  badge.className = `status ${resumo.classe} node-status`;
  badge.textContent = `● ${resumo.status}`;

  const chevron = document.createElement("button");
  chevron.type = "button";
  chevron.className = "node-chevron";
  chevron.setAttribute("aria-label", `Entrar em ${item.nome}`);
  chevron.textContent = "›";
  if (!temFilhos) chevron.disabled = true;
  chevron.addEventListener("click", (e) => {
    e.stopPropagation();
    if (temFilhos) { setFocusItem(item.id); renderTree(); }
  });

  row.append(icon, text, badge, chevron);
  row.addEventListener("click", () => selectItem(item.id));
  row.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); selectItem(item.id); }
  });
  return row;
}

/* ── Busca: lista plana de itens que casam com o filtro ───────────────────
   Quando o técnico filtra, não faz sentido drill-down — mostra todos os
   itens que casam, diretos. Tocar abre o detalhe. */
function renderArvoreBusca() {
  const matches = activeItems().filter(itemOuDescendenteCasa);
  if (!matches.length) {
    tree.innerHTML = '<p class="muted">Nenhum item corresponde à busca.</p>';
    return;
  }
  matches.forEach((item) => tree.appendChild(drillRow(item)));
}

/** Ícone padrão Explorer — apenas pastas (aberta/fechada). */
function iconFor(_cat, _item, expanded = false) {
  return expanded ? "📂" : "📁";
}

/* ── Circuitos físicos do item (v3.6) ──────────────────────────────────────
   Lista os circuitos que tocam o item atual, com atalhos para ver o mapa da
   sequência, editar e excluir. */

function renderCircuitoList() {
  const item = currentItem();
  const cont = document.getElementById("circuitoList");
  if (!item || !cont) return;
  cont.replaceChildren();
  const circuitos = circuitosOfItem(item.id);
  if (!circuitos.length) {
    const p = document.createElement("p");
    p.className = "muted";
    p.textContent = "Nenhum circuito físico envolve este item ainda.";
    cont.appendChild(p);
    return;
  }
  circuitos.forEach((c) => {
    const el = document.createElement("div");
    el.className = "pill circuito-pill";
    const info = document.createElement("span");
    info.className = "circ-info";
    const b = document.createElement("b");
    b.textContent = c.nome;
    const meta = document.createElement("small");
    meta.className = "muted";
    const nomes = (c.trechos || []).map((t) => findItemById(t.itemId)?.nome || "—");
    meta.textContent = ` ${c.tipo} · ${c.trechos.length} trechos · ${nomes.join(" → ")}`;
    info.append(b, meta);

    const btnMap = document.createElement("button");
    btnMap.className = "mini-btn mini-btn-txt";
    btnMap.textContent = "Mapa";
    btnMap.title = "Ver mapa do circuito";
    btnMap.setAttribute("aria-label", `Ver mapa do circuito ${c.nome}`);
    btnMap.addEventListener("click", () => openCircMapModal(c.id));

    const btnEdit = document.createElement("button");
    btnEdit.className = "mini-btn mini-btn-txt";
    btnEdit.textContent = "Editar";
    btnEdit.title = "Editar circuito";
    btnEdit.setAttribute("aria-label", `Editar circuito ${c.nome}`);
    btnEdit.addEventListener("click", () => openCircuitoModal(c.id));

    const btnDel = criarMiniBotao(`Excluir circuito ${c.nome}`, () => excluirCircuito(c.id), true);

    el.append(info, btnMap, btnEdit, btnDel);
    cont.appendChild(el);
  });
}

/* ── Detalhes do item selecionado ─────────────────────────────────────── */

function renderItemDetails() {
  const item = currentItem();
  if (!item) return;
  itemEmpty.classList.add("hidden");
  itemDetails.classList.remove("hidden");
  itemStatusBadge.className = "status " + (item.criticidade === "Crítica" ? "danger" : item.criticidade === "Alta" ? "warn" : "ok");
  itemStatusBadge.textContent = "● " + item.criticidade;
  detailNome.value = item.nome;
  detailCategoria.value = item.categoria;
  detailTipo.value = item.tipo;
  detailCriticidade.value = item.criticidade;
  detailDescricao.value = item.descricao;
  renderAttrList();
  renderDepList();
  renderCheckList();
  renderFotos();
  renderCircuitoList();
}

function renderAttrList() {
  const item = currentItem();
  if (!item) return;
  attrList.replaceChildren();
  Object.entries(item.atributos || {}).forEach(([k, v]) => {
    const el = document.createElement("span");
    el.className = "pill";
    const key = document.createElement("b");
    key.textContent = k;
    const value = document.createElement("span");
    value.textContent = v;
    const remove = criarMiniBotao(`Remover atributo ${k}`, () => removerAtributo(k));
    el.append(key, value, remove);
    attrList.appendChild(el);
  });
}

function renderDepList() {
  const item = currentItem();
  if (!item) return;
  renderDepItemOptions(item.id);
  depList.replaceChildren();
  (item.dependencias || []).forEach((d, idx) => {
    const broken = depIsBroken(d);
    const el = document.createElement("span");
    el.className = "pill" + (broken ? " pill-broken" : "");
    const type = document.createElement("b");
    type.textContent = d.tipo;
    const target = document.createElement("span");
    target.textContent = depItemNome(d);
    el.append(type, target, criarMiniBotao("Remover dependência", () => removeDependency(idx)));
    depList.appendChild(el);
  });
}

/** Popula o seletor "Item relacionado" com todos os itens exceto o atual. */
function renderDepItemOptions(currentId) {
  if (!depItemSelect) return;
  depItemSelect.innerHTML = "";
  activeItems()
    .filter((i) => i.id !== currentId)
    .forEach((i) => {
      const o = document.createElement("option");
      o.value = i.id;
      o.textContent = i.nome;
      depItemSelect.appendChild(o);
    });
}

function renderCheckList() {
  const item = currentItem();
  if (!item) return;
  checkList.replaceChildren();
  (item.checklist || []).forEach((c, idx) => {
    const cls = c.status === "Conforme" ? "ok" : c.status === "Não conforme" ? "danger" : c.status === "Não aplicável" ? "neutral" : "warn";
    const el = document.createElement("span");
    el.className = "pill";
    const status = document.createElement("span");
    status.className = `status ${cls}`;
    status.textContent = c.status;
    const text = document.createElement("span");
    text.textContent = c.texto;
    el.append(status, text, criarMiniBotao("Remover item de checklist", () => removeChecklist(idx)));
    checkList.appendChild(el);
  });
  if (!(item.checklist || []).length) {
    const warning = document.createElement("p");
    warning.className = "empty-warning";
    warning.textContent = "Este item está sem checklist e será contabilizado como pendente.";
    checkList.appendChild(warning);
  }
}

function criarMiniBotao(label, handler, danger = false) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `mini-btn${danger ? " danger" : ""}`;
  button.textContent = "×";
  button.setAttribute("aria-label", label);
  button.title = label;
  button.addEventListener("click", handler);
  return button;
}

/* ── Evidências fotográficas ──────────────────────────────────────────── */

function renderFotos() {
  const item = currentItem();
  if (!item) return;
  const cont = document.getElementById("fotoList");
  if (!cont) return;
  cont.replaceChildren();
  (item.fotos || []).forEach((f, idx) => {
    const fig = document.createElement("figure");
    fig.className = "foto-thumb";

    const img = document.createElement("img");
    img.src = f.dataUrl;
    img.alt = f.nome || "";
    img.addEventListener("click", () => abrirFotoModal(idx));

    const cap = document.createElement("figcaption");
    cap.textContent = f.nome || "";
    cap.title = f.nome || "";

    const del = document.createElement("button");
    del.type = "button";
    del.className = "mini-btn danger foto-del";
    del.setAttribute("aria-label", "Remover foto");
    del.textContent = "×";
    del.addEventListener("click", () => removerFoto(idx));

    fig.append(img, cap, del);
    cont.appendChild(fig);
  });
  if ((item.fotos || []).length === 0) {
    const p = document.createElement("p");
    p.className = "muted";
    p.textContent = "Nenhuma evidência anexada a este item.";
    cont.appendChild(p);
  }
}

/* ── Modal: opções de item pai ─────────────────────────────────────────── */

function renderParentOptions(def = null) {
  newParent.innerHTML = "";
  activeItems().forEach((item) => {
    const o = document.createElement("option");
    o.value = item.id;
    o.textContent = item.nome;
    if (def === item.id) o.selected = true;
    newParent.appendChild(o);
  });
}

/* ── Inspeção (tabela) ────────────────────────────────────────────────── */

function renderInspection() {
  const tbody = document.querySelector("#inspectionTable tbody");
  if (tbody) {
    tbody.replaceChildren();
    activeItems().forEach((item) => {
      const resumo = resumirInspecaoItem(item);
      const tr = document.createElement("tr");
      tr.className = "row-clickable";
      tr.onclick = () => { selectItem(item.id); showView("inventario"); };
      [item.nome, item.categoria, item.criticidade].forEach((value) => {
        const cell = document.createElement("td");
        cell.textContent = value;
        tr.appendChild(cell);
      });
      const statusCell = document.createElement("td");
      const status = document.createElement("span");
      status.className = `status ${resumo.classe}`;
      status.textContent = `● ${resumo.status}`;
      statusCell.appendChild(status);
      const pendingCell = document.createElement("td");
      pendingCell.textContent = resumo.pendencia;
      tr.append(statusCell, pendingCell);
      tbody.appendChild(tr);
    });
  }
  renderInspChecklistItemSelect();
  renderInspecaoChecklist();
  renderInspecaoEvidencias();
}

/* ── Inspeção · Checklist consolidado (v3.4) ──────────────────────────────
   Antes, ver/editar um ponto de inspeção exigia abrir o item na árvore.
   Aqui ficam TODOS os pontos de TODOS os itens do site, com status editável
   inline e atalho direto pra Hierarquias. */

function renderInspChecklistItemSelect() {
  const sel = document.getElementById("inspChecklistItemSelect");
  if (!sel) return;
  const atual = sel.value;
  sel.innerHTML = "";
  activeItems().forEach((item) => {
    const o = document.createElement("option");
    o.value = item.id;
    o.textContent = item.nome;
    sel.appendChild(o);
  });
  if (atual && activeItems().some((i) => i.id === atual)) sel.value = atual;
}

function renderInspecaoChecklist() {
  const tbody = document.querySelector("#inspChecklistTable tbody");
  if (!tbody) return;
  const filtro = document.getElementById("inspChecklistFiltro")?.value || "";
  const linhas = [];
  activeItems().forEach((item) => {
    (item.checklist || []).forEach((c, idx) => {
      if (filtro && c.status !== filtro) return;
      linhas.push({ item, c, idx });
    });
  });
  tbody.replaceChildren();
  if (!linhas.length) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 4;
    cell.className = "muted";
    cell.textContent = `Nenhum ponto de inspeção ${filtro ? "com esse status" : "cadastrado"} neste site.`;
    row.appendChild(cell);
    tbody.appendChild(row);
    return;
  }
  linhas.forEach(({ item, c, idx }) => {
    const row = document.createElement("tr");
    const itemCell = document.createElement("td");
    itemCell.className = "row-clickable";
    itemCell.textContent = item.nome;
    itemCell.addEventListener("click", () => { selectItem(item.id); showView("inventario"); });
    const textCell = document.createElement("td");
    textCell.textContent = c.texto;
    const statusCell = document.createElement("td");
    const select = document.createElement("select");
    ["Conforme", "Não conforme", "Não aplicável", "Não inspecionado"].forEach((value) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = value;
      option.selected = value === c.status;
      select.appendChild(option);
    });
    select.addEventListener("change", () => atualizarStatusChecklistGlobal(item.id, idx, select.value));
    statusCell.appendChild(select);
    const actionCell = document.createElement("td");
    actionCell.appendChild(criarMiniBotao("Remover ponto de inspeção", () => removerChecklistGlobal(item.id, idx), true));
    row.append(itemCell, textCell, statusCell, actionCell);
    tbody.appendChild(row);
  });
}

/* ── Inspeção · Evidências consolidadas (v3.4) ────────────────────────────
   Mesma vitrine de fotos do item (.foto-grid/.foto-thumb), só que juntando
   as de TODOS os itens do site numa visão só. Sem botão de excluir aqui de
   propósito — exclusão continua dentro do item, pra evitar engano numa
   tela densa que mistura itens diferentes. */

function renderInspecaoEvidencias() {
  const cont = document.getElementById("inspEvidenciasGrid");
  if (!cont) return;
  cont.replaceChildren();
  let total = 0;
  activeItems().forEach((item) => {
    (item.fotos || []).forEach((f, idx) => {
      total++;
      const fig = document.createElement("figure");
      fig.className = "foto-thumb";

      const img = document.createElement("img");
      img.src = f.dataUrl;
      img.alt = `${item.nome} — ${f.nome || ""}`;
      img.addEventListener("click", () => abrirFotoModalDe(item.id, idx));

      const cap = document.createElement("figcaption");
      cap.textContent = `${item.nome} — ${f.nome || ""}`;
      cap.title = `${item.nome} — ${f.nome || ""}`;

      fig.append(img, cap);
      cont.appendChild(fig);
    });
  });
  if (!total) {
    const p = document.createElement("p");
    p.className = "muted";
    p.textContent = "Nenhuma evidência fotográfica cadastrada neste site ainda.";
    cont.appendChild(p);
  }
}

/* ── Mapa mental (miniatura no Dashboard) ─────────────────────────────────
   v3: substitui a visão de 1 nível (raiz + filhos diretos em círculo) por
   uma miniatura da ÁRVORE COMPLETA do site, usando o motor de mindmap.js
   (mesmo SVG reaproveitado pela ferramenta completa, PNG, PDF e impressão).
   A miniatura é só leitura rápida; clique em "🧠 Mapa mental completo"
   abre a ferramenta com zoom, impressão e exportação. */

function renderMindMap() {
  const wrap = document.getElementById("mindMap");
  if (!wrap) return;
  // Guia recolhida: não ocupa processamento nem altura do Início
  const guide = document.getElementById("homeMindMapGuide");
  if (guide && !guide.open) {
    wrap.innerHTML = "";
    return;
  }
  wrap.innerHTML = "";

  const tree = mmBuildTree();
  if (!tree) {
    wrap.innerHTML = '<p class="muted">Crie a raiz do site para visualizar o mapa mental.</p>';
    return;
  }

  const layout = mmLayout(tree, { nodeW: 168, nodeH: 54, rowH: 70, levelGap: 210 });
  wrap.innerHTML = mmRenderSVG(layout);

  const svgEl = wrap.querySelector("svg");
  if (svgEl) {
    const vb = svgEl.viewBox.baseVal;
    const containerW = (wrap.parentElement && wrap.parentElement.clientWidth) || 720;
    const escala = Math.min(1, (containerW - 4) / vb.width);
    svgEl.setAttribute("width", Math.round(vb.width * escala));
    svgEl.setAttribute("height", Math.round(vb.height * escala));
    mmAttachClickHandlers(svgEl);
  }
}

/* ── Trilha de auditoria local (v3.5) ───────────────────────────────── */

function renderAuditLog() {
  const tbody = document.getElementById("auditTableBody");
  if (!tbody) return;
  tbody.replaceChildren();
  const entries = (state.meta?.auditLog || []).slice(0, 100);
  entries.forEach((entry) => {
    const row = document.createElement("tr");
    const date = new Date(entry.timestamp);
    const values = [
      Number.isNaN(date.getTime()) ? entry.timestamp : date.toLocaleString("pt-BR"),
      entry.userName || "Usuário local",
      entry.action,
      entry.entityType,
      entry.siteCode || "—",
      entry.detail,
    ];
    values.forEach((value) => {
      const cell = document.createElement("td");
      cell.textContent = value;
      row.appendChild(cell);
    });
    tbody.appendChild(row);
  });
  if (!entries.length) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 6;
    cell.className = "muted";
    cell.textContent = "Nenhuma alteração registrada nesta base.";
    row.appendChild(cell);
    tbody.appendChild(row);
  }
}

/* ── Navegação entre views ────────────────────────────────────────────── */

function showView(id) {
  const alvo = document.getElementById(id);
  if (!alvo) return;
  document.querySelectorAll(".view").forEach((v) => v.classList.add("hidden"));
  alvo.classList.remove("hidden");
  document.querySelectorAll(".nav-btn").forEach((b) => b.classList.toggle("active", b.dataset.view === id));
}

/* ── Toast de notificação ─────────────────────────────────────────────── */

function toast(msg, tipo = "info") {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.className = "toast active" + (tipo === "error" ? " toast-error" : "");
  clearTimeout(el._timer);
  el._timer = setTimeout(() => el.classList.remove("active"), 3200);
}

/* ── Helpers de escape (segurança contra XSS no innerHTML) ───────────────── */

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[m]));
}

function escA(s) {
  return String(s ?? "").replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}
