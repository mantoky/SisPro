/* ==========================================================================
   CFI Serviços — Inventário Inteligente de Sites Telecom
   circuitgraph.js — Mapa de Circuito físico (v3.6)
   ==========================================================================
   Reaproveita o motor visual do mindmap.js/depgraph.js (SVG + svgParaCanvas),
   mas desenha um CAMINHO ORDENADO (esquerda → direita) dos trechos do circuito,
   em vez de uma árvore/grafo livre. Cada nó mostra o item e os atributos físicos
   daquele ponto (posição, disjuntor, bitola, fase, comprimento). É o "mapa mental
   da sequência" do circuito físico. 100% offline. */

const CIRC_COR = {
  quadro: "#007a53",
  dj: "#0a5f9e",
  disjuntor: "#0a5f9e",
  cabo: "#64748b",
  ativo: "#f59e0b",
  medio: "#7c3aed",
  outro: "#64748b",
};

const CIRC_PAPEL_LABEL = {
  quadro: "Quadro", dj: "DJ", disjuntor: "Disjuntor", cabo: "Cabo",
  ativo: "Ativo", medio: "Medição", outro: "Ponto",
};

/* ── Layout horizontal simples: um trecho atrás do outro ─────────────────── */
function circLayout(c) {
  const trechos = c.trechos || [];
  const nodeW = 214, nodeH = 138, gapX = 64, pad = 26;
  const nodes = trechos.map((t, i) => {
    const item = findItemById(t.itemId);
    return {
      idx: i, trecho: t,
      nome: item ? item.nome : "— (item removido)",
      x: pad + i * (nodeW + gapX),
      y: pad,
    };
  });
  const width = pad * 2 + Math.max(1, trechos.length) * nodeW + Math.max(0, trechos.length - 1) * gapX;
  const height = pad * 2 + nodeH;
  return { nodes, width, height, nodeW, nodeH, pad };
}

/* ── Renderização SVG do caminho ordenado ────────────────────────────────── */
function circRenderSVG(layout) {
  const { nodes, width, height, nodeW, nodeH, pad } = layout;
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" font-family="'Segoe UI', Inter, system-ui, sans-serif">`;
  svg += `<rect x="0" y="0" width="${width}" height="${height}" fill="#ffffff"/>`;

  // Setas entre trechos consecutivos (origem → destino)
  for (let i = 0; i < nodes.length - 1; i++) {
    const a = nodes[i], b = nodes[i + 1];
    const x1 = a.x + nodeW, y1 = a.y + nodeH / 2, x2 = b.x, y2 = b.y + nodeH / 2;
    svg += `<line x1="${x1}" y1="${y1}" x2="${x2 - 8}" y2="${y2}" stroke="#a9d2c4" stroke-width="2.4"/>`;
    svg += `<polygon points="${x2 - 8},${y2 - 6} ${x2},${y2} ${x2 - 8},${y2 + 6}" fill="#7fbfa6"/>`;
  }

  nodes.forEach((n) => {
    const cor = CIRC_COR[n.trecho.papel] || "#64748b";
    const x = n.x, y = n.y;
    svg += `<g class="cm-node" data-item-id="${mmEscXml(n.trecho.itemId)}" style="cursor:pointer">`;
    svg += `<rect x="${x}" y="${y}" width="${nodeW}" height="${nodeH}" rx="12" fill="#ffffff" stroke="${cor}" stroke-width="2"/>`;
    // cabeçalho colorido com o nome do item
    svg += `<path d="M ${x} ${y + 12} a 12 12 0 0 1 12 -12 h ${nodeW - 24} a 12 12 0 0 1 12 12 v 26 h ${-nodeW} z" fill="${cor}"/>`;
    const nomeLinhas = mmWrapLines(n.nome, 28, 1);
    svg += `<text x="${x + 12}" y="${y + 23}" font-size="13" font-weight="700" fill="#ffffff">${mmEscXml(nomeLinhas[0] || "—")}</text>`;

    // atributos físicos
    const linhas = [];
    if (n.trecho.posicao) linhas.push(["Posição", n.trecho.posicao]);
    if (n.trecho.disjuntor) linhas.push(["Disjuntor", n.trecho.disjuntor]);
    if (n.trecho.bitola) linhas.push(["Bitola", n.trecho.bitola]);
    if (n.trecho.fase) linhas.push(["Fase", n.trecho.fase]);
    if (n.trecho.comprimento) linhas.push(["Comp.", n.trecho.comprimento]);
    let ty = y + 50;
    linhas.forEach(([k, v]) => {
      svg += `<text x="${x + 12}" y="${ty}" font-size="11" fill="#18332b"><tspan font-weight="700">${mmEscXml(k)}:</tspan> ${mmEscXml(v)}</text>`;
      ty += 15;
    });
    if (n.trecho.observacao) {
      const obs = mmWrapLines(n.trecho.observacao, 32, 2);
      obs.forEach((l) => {
        svg += `<text x="${x + 12}" y="${ty}" font-size="10" font-style="italic" fill="#687b73">${mmEscXml(l)}</text>`;
        ty += 13;
      });
    }

    // selo do papel + índice
    svg += `<rect x="${x + nodeW - 86}" y="${y + nodeH - 22}" width="76" height="16" rx="8" fill="#eef5f1" stroke="${cor}" stroke-width="1"/>`;
    svg += `<text x="${x + nodeW - 48}" y="${y + nodeH - 10}" font-size="10" font-weight="700" fill="${cor}" text-anchor="middle">${mmEscXml(CIRC_PAPEL_LABEL[n.trecho.papel] || "Ponto")} · ${n.idx + 1}</text>`;
    svg += `</g>`;
  });

  svg += `</svg>`;
  return svg;
}

/* ── Desenha o mapa no modal ─────────────────────────────────────────────── */
function drawCircMap(c) {
  const el = document.getElementById("circMapFull");
  if (!el) return;
  const layout = circLayout(c);
  el.innerHTML = circRenderSVG(layout);
  el.querySelectorAll(".cm-node").forEach((g) => {
    g.addEventListener("click", () => {
      const id = g.getAttribute("data-item-id");
      if (!id) return;
      selectItem(id);
      closeCircMapModal();
      showView("inventario");
      toast("Item selecionado a partir do mapa de circuito.");
    });
  });
}

/* ── Exportações (reaproveitam svgParaCanvas do mindmap.js) ────────────────── */
function _circSvgToCanvas(scale = 2) {
  const c = _circMapCurrent;
  if (!c) return Promise.reject(new Error("sem-circuito"));
  const layout = circLayout(c);
  const svgStr = circRenderSVG(layout);
  return svgParaCanvas(svgStr, layout.width, layout.height, scale);
}

let _circMapCurrent = null;

async function exportCircMapPNG() {
  if (!_circMapCurrent) return;
  try {
    const canvas = await _circSvgToCanvas(2);
    const a = document.createElement("a");
    a.href = canvas.toDataURL("image/png");
    a.download = `${safeExportName(activeSite().codigo)}_circuito_${safeExportName(_circMapCurrent.nome)}.png`;
    a.click();
    recordAudit("EXPORT", "circuito", _circMapCurrent.id, "Mapa de circuito exportado em PNG.");
    scheduleAutosave();
    toast("Mapa de circuito exportado em PNG.");
  } catch (e) {
    toast("Não foi possível gerar o PNG.", "error");
  }
}

async function exportCircMapPDF() {
  if (typeof window.jspdf === "undefined") { toast("Biblioteca de PDF não carregada.", "error"); return; }
  if (!_circMapCurrent) return;
  try {
    const canvas = await _circSvgToCanvas(2);
    const { jsPDF } = window.jspdf;
    const cabecalho = 90, W = canvas.width, H = canvas.height;
    const doc = new jsPDF({ unit: "px", format: [W, H + cabecalho], orientation: W >= H ? "landscape" : "portrait" });
    doc.setFillColor(0, 122, 83); doc.rect(0, 0, W, cabecalho, "F");
    doc.setTextColor(255, 255, 255); doc.setFont("helvetica", "bold"); doc.setFontSize(20);
    doc.text(`Circuito — ${_circMapCurrent.nome}`, 22, 32);
    doc.setFont("helvetica", "normal"); doc.setFontSize(11);
    doc.text(`Site ${activeSite().nome} (${activeSite().codigo}) · Tipo ${_circMapCurrent.tipo} · ${_circMapCurrent.trechos.length} trechos · ${new Date().toLocaleString("pt-BR")}`, 22, 54);
    doc.text("CFI Serviços — Inventário Inteligente de Sites Telecom", 22, 72);
    doc.addImage(canvas.toDataURL("image/png"), "PNG", 0, cabecalho, W, H);
    doc.save(`${safeExportName(activeSite().codigo)}_circuito_${safeExportName(_circMapCurrent.nome)}.pdf`);
    recordAudit("EXPORT", "circuito", _circMapCurrent.id, "Mapa de circuito exportado em PDF.");
    scheduleAutosave();
    toast("PDF do circuito exportado.");
  } catch (e) {
    toast("Não foi possível gerar o PDF.", "error");
  }
}
