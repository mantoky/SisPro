/* ==========================================================================
   CFI Serviços — Links entre grafos (Display Model / CAD)
   Ligação tipada entre itens, com metadados em cada extremidade.
   Vários links podem coexistir entre o mesmo par de nós.
   ========================================================================== */

const LINK_COR_CATEGORIA = {
  circuito_eletrico: "#f59e0b",
  servico: "#0ea5e9",
  logico: "#a78bfa",
  dados: "#22c55e",
  outro: "#94a3b8",
};

const LINK_LABEL_CATEGORIA = {
  circuito_eletrico: "Circuito elétrico",
  servico: "Serviço",
  logico: "Lógico",
  dados: "Dados",
  outro: "Outro",
};

let _mmLinkPickFromId = null;
let _mmLinkCategoriaPadrao = "circuito_eletrico";
let _mmLinkEditId = null;

function mmLinkCor(cat) {
  return LINK_COR_CATEGORIA[cat] || LINK_COR_CATEGORIA.outro;
}

function mmLinkNodeAnchor(layout, bounds, itemId, side) {
  const n = (layout.nodes || []).find((x) => x.id === itemId);
  if (!n) return null;
  const pad = bounds?.pad ?? 24;
  const ox = bounds?.ox ?? 0;
  const oy = bounds?.oy ?? 0;
  const x = n._x + pad + ox;
  const y = n._y + pad + oy;
  const w = layout.nodeW || 190;
  const h = layout.nodeH || 58;
  const cy = y + h / 2;
  if (side === "right") return { x: x + w, y: cy, cx: x + w / 2, cy };
  if (side === "left") return { x, y: cy, cx: x + w / 2, cy };
  return { x: x + w / 2, y: cy, cx: x + w / 2, cy };
}

/** SVG dos links sobre o plano de construção (editor). */
function mmRenderGraphLinksSvg(layout, bounds) {
  if (typeof siteLinks !== "function") return "";
  const links = siteLinks();
  if (!links.length) return "";
  let svg = `<g class="mm-links-layer" pointer-events="all">`;
  links.forEach((link, idx) => {
    const a = mmLinkNodeAnchor(layout, bounds, link.from.itemId, "right");
    const b = mmLinkNodeAnchor(layout, bounds, link.to.itemId, "left");
    if (!a || !b) return;
    // Offset paralelo quando há vários links no mesmo par
    const twins = links.filter((l) =>
      (l.from.itemId === link.from.itemId && l.to.itemId === link.to.itemId) ||
      (l.from.itemId === link.to.itemId && l.to.itemId === link.from.itemId)
    );
    const twinIdx = twins.findIndex((l) => l.id === link.id);
    const bend = (twinIdx - (twins.length - 1) / 2) * 18;
    const midX = (a.x + b.x) / 2;
    const midY = (a.y + b.y) / 2 + bend;
    const cor = mmLinkCor(link.categoria);
    const label = link.nome || link.tipo || link.categoria;
    const fromTag = link.from.terminal || link.from.papel || "";
    const toTag = link.to.terminal || link.to.papel || "";
    svg += `<g class="mm-link" data-link-id="${link.id}" style="cursor:pointer">`;
    svg += `<path class="mm-link-hit" d="M ${a.x} ${a.y} Q ${midX} ${midY} ${b.x} ${b.y}" fill="none" stroke="transparent" stroke-width="14"/>`;
    svg += `<path class="mm-link-path" d="M ${a.x} ${a.y} Q ${midX} ${midY} ${b.x} ${b.y}" fill="none" stroke="${cor}" stroke-width="2.4" stroke-dasharray="${link.categoria === "logico" ? "6 4" : "0"}"/>`;
    svg += `<circle class="mm-link-end" data-end="from" cx="${a.x}" cy="${a.y}" r="5.5" fill="${cor}" stroke="#1E1E1E" stroke-width="1.2"/>`;
    svg += `<circle class="mm-link-end" data-end="to" cx="${b.x}" cy="${b.y}" r="5.5" fill="#fff" stroke="${cor}" stroke-width="2"/>`;
    if (fromTag) {
      svg += `<text x="${a.x + 6}" y="${a.y - 8}" font-size="9" fill="${cor}" font-weight="700">${mmEscXml(fromTag)}</text>`;
    }
    if (toTag) {
      svg += `<text x="${b.x - 6}" y="${b.y - 8}" font-size="9" fill="${cor}" font-weight="700" text-anchor="end">${mmEscXml(toTag)}</text>`;
    }
    svg += `<text x="${midX}" y="${midY - 6}" font-size="10" fill="${cor}" font-weight="700" text-anchor="middle">${mmEscXml(label)}</text>`;
    svg += `</g>`;
    void idx;
  });
  svg += `</g>`;
  return svg;
}

function mmSetLinkCategoria(cat) {
  if (!LINK_CATEGORIAS.includes(cat)) cat = "circuito_eletrico";
  _mmLinkCategoriaPadrao = cat;
  document.querySelectorAll("#mmLinkCatToggle .seg-btn").forEach((b) => {
    b.classList.toggle("active", b.dataset.linkcat === cat);
  });
  toast(`Categoria de link: ${LINK_LABEL_CATEGORIA[cat] || cat}`);
}

function mmLinkClearPick() {
  _mmLinkPickFromId = null;
  document.querySelectorAll("#mindMapFull .mm-node.mm-link-pick").forEach((n) => n.classList.remove("mm-link-pick"));
}

function mmLinkPickNode(itemId) {
  if (!itemId) return;
  if (!_mmLinkPickFromId) {
    _mmLinkPickFromId = itemId;
    const g = document.querySelector(`#mindMapFull .mm-node[data-item-id="${itemId}"]`);
    if (g) g.classList.add("mm-link-pick");
    toast("Origem marcada. Clique no grafo de destino.");
    return;
  }
  if (_mmLinkPickFromId === itemId) {
    toast("Escolha um grafo diferente como destino.", "info");
    return;
  }
  const fromId = _mmLinkPickFromId;
  mmLinkClearPick();
  mmOpenLinkModal({ fromId, toId: itemId });
}

function mmFillLinkPapelSelect(sel, value) {
  if (!sel) return;
  sel.innerHTML = LINK_PAPEIS_ENDPOINT.map((p) =>
    `<option value="${p}"${p === value ? " selected" : ""}>${p}</option>`
  ).join("");
}

function mmOpenLinkModal(opts = {}) {
  const backdrop = document.getElementById("mmLinkModalBackdrop");
  if (!backdrop) return;
  _mmLinkEditId = opts.linkId || null;
  const existing = _mmLinkEditId ? findLink(_mmLinkEditId) : null;
  const fromId = existing?.from?.itemId || opts.fromId;
  const toId = existing?.to?.itemId || opts.toId;
  const fromItem = findItemById(fromId);
  const toItem = findItemById(toId);
  if (!fromItem || !toItem) {
    toast("Itens do link inválidos.", "error");
    return;
  }

  document.getElementById("mmLinkModalTitulo").textContent = existing ? "Editar link" : "Novo link entre grafos";
  document.getElementById("mmLinkResumo").textContent = `"${fromItem.nome}"  ↔  "${toItem.nome}"`;
  document.getElementById("mmLinkFromId").value = fromId;
  document.getElementById("mmLinkToId").value = toId;
  document.getElementById("mmLinkNome").value = existing?.nome || "";
  document.getElementById("mmLinkCategoria").value = existing?.categoria || _mmLinkCategoriaPadrao;
  document.getElementById("mmLinkTipo").value = existing?.tipo || "alimenta";

  mmFillLinkPapelSelect(document.getElementById("mmLinkFromPapel"), existing?.from?.papel || "quadro");
  mmFillLinkPapelSelect(document.getElementById("mmLinkToPapel"), existing?.to?.papel || "ativo");
  document.getElementById("mmLinkFromTerminal").value = existing?.from?.terminal || "";
  document.getElementById("mmLinkToTerminal").value = existing?.to?.terminal || "";
  document.getElementById("mmLinkFromPosicao").value = existing?.from?.posicao || "";
  document.getElementById("mmLinkToPosicao").value = existing?.to?.posicao || "";
  document.getElementById("mmLinkFromFase").value = existing?.from?.fase || "";
  document.getElementById("mmLinkToFase").value = existing?.to?.fase || "";
  document.getElementById("mmLinkFromBitola").value = existing?.from?.bitola || "";
  document.getElementById("mmLinkToBitola").value = existing?.to?.bitola || "";
  document.getElementById("mmLinkFromObs").value = existing?.from?.observacao || "";
  document.getElementById("mmLinkToObs").value = existing?.to?.observacao || "";

  const btnDel = document.getElementById("mmLinkBtnExcluir");
  if (btnDel) btnDel.hidden = !existing;

  backdrop.classList.add("active");
}

function mmCloseLinkModal() {
  _mmLinkEditId = null;
  document.getElementById("mmLinkModalBackdrop")?.classList.remove("active");
}

function mmReadEndpointFromForm(prefix) {
  return {
    itemId: document.getElementById(`mmLink${prefix}Id`).value,
    papel: document.getElementById(`mmLink${prefix}Papel`).value,
    terminal: document.getElementById(`mmLink${prefix}Terminal`).value,
    posicao: document.getElementById(`mmLink${prefix}Posicao`).value,
    fase: document.getElementById(`mmLink${prefix}Fase`).value,
    bitola: document.getElementById(`mmLink${prefix}Bitola`).value,
    observacao: document.getElementById(`mmLink${prefix}Obs`).value,
  };
}

function mmSalvarLinkModal() {
  const payload = {
    nome: document.getElementById("mmLinkNome").value,
    categoria: document.getElementById("mmLinkCategoria").value,
    tipo: document.getElementById("mmLinkTipo").value,
    from: mmReadEndpointFromForm("From"),
    to: mmReadEndpointFromForm("To"),
  };
  const editando = !!_mmLinkEditId;
  if (typeof mmPushUndo === "function") mmPushUndo();
  const r = editando ? updateLink(_mmLinkEditId, payload) : createLink(payload);
  if (!r.ok) {
    toast(r.motivo || "Não foi possível salvar o link.", "error");
    return;
  }
  mmCloseLinkModal();
  if (typeof mmEnsureBuilt === "function") mmEnsureBuilt(true);
  if (typeof mmDrawFull === "function") mmDrawFull();
  if (typeof mmRefreshUndoRedo === "function") mmRefreshUndoRedo();
  toast(editando ? "Link atualizado." : "Link criado entre os grafos.");
}

async function mmExcluirLinkModal() {
  if (!_mmLinkEditId) return;
  const ok = await confirmarDialog("Excluir este link entre grafos?", {
    titulo: "Excluir link", confirmText: "Excluir", danger: true,
  });
  _mmIgnoreCanvasUntil = Date.now() + 400;
  if (!ok) return;
  if (typeof mmPushUndo === "function") mmPushUndo();
  deleteLink(_mmLinkEditId);
  mmCloseLinkModal();
  if (typeof mmDrawFull === "function") mmDrawFull();
  if (typeof mmRefreshUndoRedo === "function") mmRefreshUndoRedo();
  toast("Link excluído.");
}

function mmAttachLinkHandlers(svgEl) {
  svgEl.querySelectorAll(".mm-link").forEach((g) => {
    g.addEventListener("pointerdown", (ev) => {
      ev.stopPropagation();
      ev.preventDefault();
    });
    g.addEventListener("click", (ev) => {
      ev.stopPropagation();
      const id = g.getAttribute("data-link-id");
      if (id) mmOpenLinkModal({ linkId: id });
    });
  });
}
