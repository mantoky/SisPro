/* ==========================================================================
   CFI Serviços — Inventário Inteligente de Sites Telecom
   depgraph.js — Ferramenta de Mapa de Dependências
   ==========================================================================
   DECISÃO DE ARQUITETURA (registrada para o histórico do projeto):
   Avaliamos sobrepor as setas de dependência no mapa mental hierárquico
   (Opção A) vs. um canvas dedicado (Opção B). Mesmo objetivo nos dois —
   visualizar o grafo de `dependencias` que hoje só aparece como pills de
   texto — mas o layout do mapa mental posiciona os nós pela PROFUNDIDADE
   NA ÁRVORE, e dependência é, por natureza, cruzada entre ramos (ex.: o
   LTE depende do Retificador, que está no ramo de Energia). Sobrepor
   geraria linhas longas cruzando o canvas inteiro e disputaria a cor que
   já significa criticidade no nó. Por isso: Opção B — canvas dedicado,
   com um layout por NÍVEL DE DEPENDÊNCIA (não por hierarquia) e uma
   paleta de cor própria para o tipo de relação, sem colidir com a cor
   de criticidade dos nós (mantida igual à do mapa mental, por consistência).

   Reaproveita de mindmap.js: svgParaCanvas(), mmCorPara(), mmWrapLines(),
   mmEscXml() — mesma linguagem visual, sem duplicar lógica.
   ========================================================================== */

const DG_RELACAO = {
  depende_de: "estrutura", suporta: "estrutura",
  alimenta: "energia", protege: "energia", aterra: "energia", refrigera: "energia",
  monitora: "informacao", conecta_com: "informacao", impacta: "informacao",
};
const DG_COR = { estrutura: "#4f46e5", energia: "#0891b2", informacao: "#be185d" };

function dgGrupoDe(tipo) { return DG_RELACAO[tipo] || "estrutura"; }

/* ── Construção do grafo: só entram itens com pelo menos 1 relação ──────── */

function dgBuildGraph() {
  const itens = activeItems();
  const envolvidos = new Set();
  const edges = [];
  itens.forEach((it) => {
    (it.dependencias || []).forEach((d) => {
      if (depIsBroken(d)) return; // não desenha pendência fantasma (item removido)
      envolvidos.add(it.id);
      envolvidos.add(d.itemId);
      edges.push({ from: it.id, to: d.itemId, tipo: d.tipo });
    });
  });
  const nodes = itens.filter((i) => envolvidos.has(i.id)).map((i) => ({
    id: i.id, nome: i.nome, categoria: i.categoria, criticidade: i.criticidade,
  }));
  return { nodes, edges, totalSite: itens.length };
}

/* ── Layout por NÍVEL DE DEPENDÊNCIA (Sugiyama simplificado) ──────────────
   nivel(nó) = maior caminho a partir de uma fonte (item sem nada apontando
   pra ele). O grafo é garantidamente acíclico — criaDependenciaCiclo() já
   bloqueia ciclos na hora de cadastrar, então a recursão sempre termina.
   Dentro de cada nível, 2 passes de barycenter (média da posição dos
   predecessores) reduzem cruzamento de linhas. */

function dgLayout(graph, opts = {}) {
  const nodeW = opts.nodeW || 190, nodeH = opts.nodeH || 56;
  const colGap = opts.colGap || 260, rowGap = opts.rowGap || 74;
  const { nodes, edges } = graph;

  const byId = {};
  nodes.forEach((n) => (byId[n.id] = n));
  const incoming = {}, outgoing = {};
  nodes.forEach((n) => { incoming[n.id] = []; outgoing[n.id] = []; });
  edges.forEach((e) => { outgoing[e.from].push(e.to); incoming[e.to].push(e.from); });

  const nivel = {};
  function calcNivel(id) {
    if (nivel[id] !== undefined) return nivel[id];
    const preds = incoming[id] || [];
    nivel[id] = preds.length ? Math.max(...preds.map(calcNivel)) + 1 : 0;
    return nivel[id];
  }
  nodes.forEach((n) => calcNivel(n.id));

  const porNivel = {};
  nodes.forEach((n) => { (porNivel[nivel[n.id]] = porNivel[nivel[n.id]] || []).push(n); });

  // ordem inicial estável = ordem de aparição na árvore (DFS a partir da raiz)
  const ordemArvore = {};
  (function () {
    let i = 0;
    const itens = activeItems();
    function walk(id) {
      ordemArvore[id] = i++;
      itens.filter((x) => x.parentId === id).forEach((c) => walk(c.id));
    }
    const raiz = itens.find((x) => x.parentId === null);
    if (raiz) walk(raiz.id);
  })();
  Object.values(porNivel).forEach((lista) => lista.sort((a, b) => (ordemArvore[a.id] ?? 0) - (ordemArvore[b.id] ?? 0)));

  const niveisOrdenados = Object.keys(porNivel).map(Number).sort((a, b) => a - b);
  const posY = {};
  niveisOrdenados.forEach((lvl) => porNivel[lvl].forEach((n, idx) => (posY[n.id] = idx)));

  for (let pass = 0; pass < 2; pass++) {
    niveisOrdenados.forEach((lvl) => {
      if (lvl === 0) return;
      porNivel[lvl].forEach((n) => {
        const preds = incoming[n.id];
        n._bary = preds.length ? preds.reduce((s, p) => s + (posY[p] || 0), 0) / preds.length : posY[n.id];
      });
      porNivel[lvl].sort((a, b) => a._bary - b._bary);
      porNivel[lvl].forEach((n, idx) => (posY[n.id] = idx));
    });
  }

  nodes.forEach((n) => { n._x = nivel[n.id] * colGap; n._y = posY[n.id] * rowGap; });

  const maxNivel = niveisOrdenados.length ? Math.max(...niveisOrdenados) : 0;
  const maxLinhas = Math.max(1, ...Object.values(porNivel).map((l) => l.length));
  return { nodes, edges, byId, width: (maxNivel + 1) * colGap, height: maxLinhas * rowGap, nodeW, nodeH };
}

/* ── Renderização SVG (setas direcionadas, rótulo do tipo de relação) ────── */

function dgRenderSVG(layout) {
  const { nodes, edges, byId, width, height, nodeW, nodeH } = layout;
  const pad = 28;
  const W = Math.round(width + pad * 2), H = Math.round(height + pad * 2);
  const maxChars = Math.max(10, Math.round((nodeW - 36) / 6.4));

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="'Segoe UI', Inter, system-ui, sans-serif">`;
  svg += `<defs>`;
  Object.entries(DG_COR).forEach(([g, cor]) => {
    svg += `<marker id="dg-seta-${g}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0,0 L10,5 L0,10 z" fill="${cor}"/>
    </marker>`;
  });
  svg += `</defs>`;
  svg += `<rect x="0" y="0" width="${W}" height="${H}" fill="#ffffff"/>`;

  edges.forEach((e) => {
    const a = byId[e.from], b = byId[e.to];
    if (!a || !b) return;
    const grupo = dgGrupoDe(e.tipo);
    const cor = DG_COR[grupo];
    const x1 = a._x + pad + nodeW, y1 = a._y + pad + nodeH / 2;
    const x2 = b._x + pad, y2 = b._y + pad + nodeH / 2;
    const dx = Math.max(40, (x2 - x1) * 0.5);
    svg += `<path d="M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}" fill="none" stroke="${cor}" stroke-width="2" opacity="0.85" marker-end="url(#dg-seta-${grupo})"/>`;
    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
    const lw = Math.max(46, e.tipo.length * 5.6);
    svg += `<rect x="${mx - lw / 2}" y="${my - 9}" width="${lw}" height="15" rx="6" fill="#ffffff" stroke="${cor}" stroke-width="1"/>`;
    svg += `<text x="${mx}" y="${my + 2.8}" font-size="8.5" font-weight="700" fill="${cor}" text-anchor="middle">${mmEscXml(e.tipo)}</text>`;
  });

  nodes.forEach((n) => {
    const x = n._x + pad, y = n._y + pad;
    const cor = mmCorPara(n, false); // mesma cor de criticidade do mapa mental — consistência visual
    const linhas = mmWrapLines(n.nome, maxChars, 2);
    svg += `<g class="dg-node" data-item-id="${n.id}">`;
    svg += `<rect class="dg-box" x="${x}" y="${y}" width="${nodeW}" height="${nodeH}" rx="12" fill="#ffffff" stroke="${cor}" stroke-width="2"/>`;
    svg += `<rect x="${x}" y="${y}" width="6" height="${nodeH}" rx="3" fill="${cor}"/>`;
    let ty = y + 18;
    linhas.forEach((l) => { svg += `<text x="${x + 16}" y="${ty}" font-size="12" font-weight="700" fill="#18332b">${mmEscXml(l)}</text>`; ty += 13; });
    const meta = [n.categoria, n.criticidade].filter(Boolean).join(" · ");
    if (meta) svg += `<text x="${x + 16}" y="${ty + 3}" font-size="9.5" fill="#687b73">${mmEscXml(meta)}</text>`;
    svg += `</g>`;
  });

  svg += `</svg>`;
  return svg;
}

function dgAttachClickHandlers(svgEl) {
  svgEl.querySelectorAll(".dg-node").forEach((g) => {
    g.style.cursor = "pointer";
    g.addEventListener("click", () => {
      const id = g.getAttribute("data-item-id");
      if (!id) return;
      selectItem(id);
      closeDepGraphModal();
      showView("inventario");
      toast("Item selecionado a partir do mapa de dependências.");
    });
  });
}

/* ── Ferramenta completa: estado, abertura, zoom ─────────────────────────── */

let _dgGraph = null, _dgLayoutData = null, _dgScale = 1;

function dgEnsureBuilt(forcar = false) {
  if (forcar || !_dgGraph) {
    _dgGraph = dgBuildGraph();
    _dgLayoutData = _dgGraph.nodes.length ? dgLayout(_dgGraph) : null;
  }
  return _dgGraph.nodes.length > 0;
}

function openDepGraphModal() {
  const temDados = dgEnsureBuilt(true);
  document.getElementById("dgSiteNome").textContent = `${activeSite().nome} (${activeSite().codigo})`;
  const semDep = _dgGraph.totalSite - _dgGraph.nodes.length;
  document.getElementById("dgSiteResumo").textContent = temDados
    ? `${_dgGraph.edges.length} relações entre ${_dgGraph.nodes.length} itens` + (semDep > 0 ? ` · ${semDep} item(ns) sem dependências registradas não aparecem aqui` : "")
    : "Nenhuma dependência cadastrada neste site ainda — adicione relações na aba \"Dependências\" de cada item.";
  dgRenderLegenda();
  _dgScale = 1;
  dgDrawFull();
  document.getElementById("depGraphModalBackdrop").classList.add("active");
}

function closeDepGraphModal() {
  document.getElementById("depGraphModalBackdrop").classList.remove("active");
}

function dgDrawFull() {
  const el = document.getElementById("depGraphFull");
  if (!el) return;
  if (!_dgLayoutData) {
    el.innerHTML = '<p class="muted" style="padding:30px">Nenhuma dependência cadastrada neste site. Vá até um item na árvore → aba "Dependências" → adicionar relação.</p>';
    return;
  }
  el.innerHTML = dgRenderSVG(_dgLayoutData);
  const svgEl = el.querySelector("svg");
  if (svgEl) {
    const vb = svgEl.viewBox.baseVal;
    svgEl.setAttribute("width", Math.round(vb.width * _dgScale));
    svgEl.setAttribute("height", Math.round(vb.height * _dgScale));
    dgAttachClickHandlers(svgEl);
  }
}

function dgZoom(delta) {
  _dgScale = Math.min(2.2, Math.max(0.3, +(_dgScale + delta).toFixed(2)));
  dgDrawFull();
}

function dgResetZoom() {
  _dgScale = 1;
  dgDrawFull();
}

function dgRenderLegenda() {
  const el = document.getElementById("dgLegenda");
  if (!el) return;
  const dot = (cor) => `<span style="display:inline-block;width:10px;height:10px;border-radius:3px;background:${cor};margin-right:5px;vertical-align:middle"></span>`;
  el.innerHTML = `
    <span class="pill">${dot(DG_COR.estrutura)}Suporte/Estrutura — depende_de, suporta</span>
    <span class="pill">${dot(DG_COR.energia)}Energia/Proteção — alimenta, protege, aterra, refrigera</span>
    <span class="pill">${dot(DG_COR.informacao)}Informação/Monitoramento — monitora, conecta_com, impacta</span>
    <span class="pill">↳ a cor do NÓ continua sendo a criticidade (mesma do mapa mental)</span>
  `;
}

/* ── Exportações: PNG, PDF, JSON, impressão ──────────────────────────────── */

function _dgSvgToCanvas(scale = 2) {
  if (!dgEnsureBuilt() || !_dgLayoutData) return Promise.reject(new Error("sem-grafo"));
  const svgStr = dgRenderSVG(_dgLayoutData);
  const w = _dgLayoutData.width + 56, h = _dgLayoutData.height + 56;
  return svgParaCanvas(svgStr, w, h, scale);
}

async function exportDepGraphPNG() {
  try {
    const canvas = await _dgSvgToCanvas(2);
    const a = document.createElement("a");
    a.href = canvas.toDataURL("image/png");
    a.download = `${safeExportName(activeSite().codigo)}_mapa_dependencias.png`;
    a.click();
    recordAudit("EXPORT", "dependency_graph", activeSite().id, "Mapa de dependências exportado em PNG.");
    scheduleAutosave();
    toast("Mapa de dependências exportado em PNG.");
  } catch (e) {
    toast(e.message === "sem-grafo" ? "Nenhuma dependência cadastrada neste site." : "Não foi possível gerar o PNG.", "error");
  }
}

async function exportDepGraphPDF() {
  if (typeof window.jspdf === "undefined") {
    toast("Biblioteca de PDF não carregada. Verifique sua conexão.", "error");
    return;
  }
  try {
    const canvas = await _dgSvgToCanvas(2);
    const { jsPDF } = window.jspdf;
    const cabecalho = 90;
    const W = canvas.width, H = canvas.height;
    const doc = new jsPDF({ unit: "px", format: [W, H + cabecalho], orientation: W >= H ? "landscape" : "portrait" });

    doc.setFillColor(10, 95, 158);
    doc.rect(0, 0, W, cabecalho, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(20);
    doc.text(`Mapa de Dependências — ${activeSite().nome}`, 22, 32);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    doc.text(
      `Código ${activeSite().codigo}  ·  ${_dgGraph.edges.length} relações entre ${_dgGraph.nodes.length} itens  ·  Gerado em ${new Date().toLocaleString("pt-BR")}`,
      22, 54
    );
    doc.text("CFI Serviços — Inventário Inteligente de Sites Telecom", 22, 72);

    doc.addImage(canvas.toDataURL("image/png"), "PNG", 0, cabecalho, W, H);
    doc.save(`${safeExportName(activeSite().codigo)}_mapa_dependencias.pdf`);
    recordAudit("EXPORT", "dependency_graph", activeSite().id, "Mapa de dependências exportado em PDF.");
    scheduleAutosave();
    toast("PDF do mapa de dependências exportado.");
  } catch (e) {
    console.error(e);
    toast(e.message === "sem-grafo" ? "Nenhuma dependência cadastrada neste site." : "Não foi possível gerar o PDF.", "error");
  }
}

function exportDepGraphJSON() {
  if (!dgEnsureBuilt()) {
    toast("Nenhuma dependência cadastrada neste site.", "error");
    return;
  }
  const payload = {
    ferramenta: "Mapa de Dependências — CFI Serviços",
    gerado_em: new Date().toISOString(),
    site: { nome: activeSite().nome, codigo: activeSite().codigo, criticidade: activeSite().criticidade },
    nodos: _dgGraph.nodes.map((n) => ({ id: n.id, nome: n.nome, categoria: n.categoria, criticidade: n.criticidade })),
    relacoes: _dgGraph.edges,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${safeExportName(activeSite().codigo)}_mapa_dependencias.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  recordAudit("EXPORT", "dependency_graph", activeSite().id, "Mapa de dependências exportado em JSON.");
  scheduleAutosave();
  toast("Estrutura do mapa de dependências exportada em JSON.");
}

function printDepGraph() {
  if (!dgEnsureBuilt()) {
    toast("Nenhuma dependência cadastrada neste site.", "error");
    return;
  }
  const svgStr = dgRenderSVG(_dgLayoutData);
  const w = window.open("", "_blank");
  if (!w) {
    toast("Permita pop-ups neste navegador para imprimir o mapa de dependências.", "error");
    return;
  }
  const s = activeSite();
  w.document.write(`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">
<title>Mapa de Dependências — ${esc(s.nome)}</title>
<style>
  *{box-sizing:border-box;font-family:'Segoe UI',Inter,system-ui,sans-serif}
  body{margin:0;padding:22px;color:#18332b}
  header{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:3px solid #0a5f9e;padding-bottom:12px;margin-bottom:16px}
  h1{margin:0;font-size:21px} p{margin:4px 0 0;color:#687b73;font-size:12px}
  .legenda{display:flex;gap:16px;margin-bottom:16px;font-size:11px;color:#31594c;flex-wrap:wrap}
  .dot{display:inline-block;width:9px;height:9px;border-radius:3px;margin-right:5px;vertical-align:middle}
  footer{margin-top:16px;font-size:10px;color:#9aa9a2;text-align:right}
  @page{size:A3 landscape;margin:10mm}
</style></head><body>
  <header>
    <div>
      <h1>Mapa de Dependências — ${esc(s.nome)}</h1>
      <p>Código ${esc(s.codigo)} · ${_dgGraph.edges.length} relações entre ${_dgGraph.nodes.length} itens</p>
    </div>
    <p>Emitido em ${new Date().toLocaleString("pt-BR")}</p>
  </header>
  <div class="legenda">
    <span><span class="dot" style="background:${DG_COR.estrutura}"></span>Suporte/Estrutura</span>
    <span><span class="dot" style="background:${DG_COR.energia}"></span>Energia/Proteção</span>
    <span><span class="dot" style="background:${DG_COR.informacao}"></span>Informação/Monitoramento</span>
    <span>Cor do nó = criticidade (igual ao mapa mental)</span>
  </div>
  ${svgStr}
  <footer>CFI Serviços — Inventário Inteligente de Sites Telecom</footer>
  <script>window.onload=()=>setTimeout(()=>window.print(),300)</script>
</body></html>`);
  w.document.close();
}
