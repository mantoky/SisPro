/* SisPro — Painel de Liderança (totem / tablet → TV)
   Lê o estado local do harness (cfi_inventario_v2) quando disponível;
   senão usa seed de demonstração alinhado ao piloto Grafana. */

const STORAGE_KEY = "cfi_inventario_v2";

const FALLBACK = {
  region: { id: "local", nome: "Dados locais / piloto", codigo: "LOCAL" },
  sites: [],
};

let _state = null;
let _regionId = null;
let _siteId = null;
let _selectedAssetId = null;
let _expanded = new Set();

function $(id) {
  return document.getElementById(id);
}

function showView(name) {
  document.querySelectorAll(".kiosk-view").forEach((v) => v.classList.remove("active"));
  const map = { regions: "viewRegions", sites: "viewSites", hierarchy: "viewHierarchy" };
  $(map[name])?.classList.add("active");
}

function loadHarnessState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.sites?.length) return null;
    return parsed;
  } catch {
    return null;
  }
}

function buildModel() {
  const harness = loadHarnessState();
  if (harness) {
    const region = {
      id: "local",
      nome: "Ambiente local SisPro",
      codigo: "LOCAL",
    };
    const sites = harness.sites.map((s) => ({
      id: s.id,
      codigo: s.codigo,
      nome: s.nome,
      criticidade: s.criticidade || "—",
      statusOperacional: s.statusOperacional || "—",
      prontuarioStatus: s.prontuarioStatus || "rascunho",
      localInstalacao: s.localInstalacao || "—",
      items: Array.isArray(s.items) ? s.items : [],
    }));
    return { regions: [region], sitesByRegion: { local: sites } };
  }

  // Seed alinhado ao Postgres piloto (sispro-plataforma)
  return {
    regions: [
      { id: "carajas", nome: "Regional Carajás", codigo: "LTE-CAR" },
      { id: "piloto", nome: "Regional Piloto", codigo: "LTE-PIL" },
    ],
    sitesByRegion: {
      carajas: [
        {
          id: "seed-lte-ma01",
          codigo: "LTE-MA01",
          nome: "LTE MORRO ALFA",
          criticidade: "Alta",
          statusOperacional: "Operacional",
          prontuarioStatus: "em_campo",
          localInstalacao: "FECJ-APD-TEL-REDTI-AB_16",
          items: [
            { id: "a-root-ma01", parentId: null, nome: "SITE LTE MORRO ALFA", categoria: "Site", tipo: "Raiz", criticidade: "Crítica", descricao: "Raiz do site" },
            { id: "a-energia", parentId: "a-root-ma01", nome: "Sistema de Energia", categoria: "Energia", tipo: "Sistema", criticidade: "Crítica", descricao: "AC/DC crítico" },
            { id: "a-qta", parentId: "a-energia", nome: "QTA", categoria: "Energia AC", tipo: "Transferência Automática", criticidade: "Crítica", descricao: "Rede/gerador" },
            { id: "a-lte", parentId: "a-root-ma01", nome: "LTE / eNode-B", categoria: "LTE", tipo: "eNode-B", criticidade: "Crítica", descricao: "Camada LTE" },
            { id: "a-torre", parentId: "a-root-ma01", nome: "Torre Autoportante 42m", categoria: "Estrutura Vertical", tipo: "Torre", criticidade: "Crítica", descricao: "Estrutura vertical" },
          ],
        },
        {
          id: "seed-lte-mb02",
          codigo: "LTE-MB02",
          nome: "LTE MORRO BETA",
          criticidade: "Média",
          statusOperacional: "Em implantação",
          prontuarioStatus: "rascunho",
          localInstalacao: "FECJ-APD-TEL-REDTI-AB_17",
          items: [
            { id: "b-root", parentId: null, nome: "SITE LTE MORRO BETA", categoria: "Site", tipo: "Raiz", criticidade: "Média", descricao: "Raiz" },
          ],
        },
      ],
      piloto: [],
    },
  };
}

function pillClass(status) {
  if (status === "concluido" || status === "Operacional") return "ok";
  if (status === "enviado_pelo_tecnico" || status === "em_revisao" || status === "Em implantação") return "warn";
  return "";
}

function renderRegions() {
  const grid = $("regionGrid");
  grid.innerHTML = "";
  _state.regions.forEach((r) => {
    const n = (_state.sitesByRegion[r.id] || []).length;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "tile";
    btn.innerHTML = `
      <div class="code">${esc(r.codigo)}</div>
      <strong>${esc(r.nome)}</strong>
      <div class="meta">${n} site(s) disponíveis nesta regional</div>
      <span class="pill">Abrir regional</span>
    `;
    btn.addEventListener("click", () => openRegion(r.id));
    grid.appendChild(btn);
  });
}

function openRegion(regionId) {
  _regionId = regionId;
  const region = _state.regions.find((r) => r.id === regionId);
  $("crumbRegion").textContent = region ? `${region.nome} · ${region.codigo}` : regionId;
  $("kioskTitle").textContent = region?.nome || "Regional";
  renderSites();
  showView("sites");
}

function renderSites() {
  const grid = $("siteGrid");
  grid.innerHTML = "";
  const sites = _state.sitesByRegion[_regionId] || [];
  if (!sites.length) {
    grid.innerHTML = `<p class="lead">Nenhum site nesta regional no momento.</p>`;
    return;
  }
  sites.forEach((s) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "tile";
    const n = (s.items || []).length;
    btn.innerHTML = `
      <div class="code">${esc(s.codigo)}</div>
      <strong>${esc(s.nome)}</strong>
      <div class="meta">${esc(s.localInstalacao)} · ${n} ativos</div>
      <span class="pill ${pillClass(s.prontuarioStatus)}">${esc(s.prontuarioStatus)}</span>
      <span class="pill ${pillClass(s.statusOperacional)}">${esc(s.statusOperacional)}</span>
    `;
    btn.addEventListener("click", () => openSite(s.id));
    grid.appendChild(btn);
  });
}

function openSite(siteId) {
  _siteId = siteId;
  const site = currentSite();
  if (!site) return;
  $("crumbSite").textContent = `${site.codigo} · ${site.nome}`;
  $("kioskTitle").textContent = site.nome;
  const root = (site.items || []).find((i) => i.parentId === null);
  _expanded = new Set(root ? [root.id] : []);
  _selectedAssetId = root?.id || null;
  renderFolderTree();
  renderAssetDetail();
  showView("hierarchy");
}

function currentSite() {
  return (_state.sitesByRegion[_regionId] || []).find((s) => s.id === _siteId) || null;
}

function childrenOf(items, parentId) {
  return items
    .filter((i) => i.parentId === parentId)
    .sort((a, b) => String(a.nome).localeCompare(String(b.nome), "pt-BR"));
}

function renderFolderTree() {
  const site = currentSite();
  const box = $("folderTree");
  box.innerHTML = "";
  if (!site) return;
  const items = site.items || [];
  const roots = items.filter((i) => i.parentId === null);

  function walk(parentId, depth) {
    const list = parentId === null ? roots : childrenOf(items, parentId);
    list.forEach((node) => {
      const kids = childrenOf(items, node.id);
      const hasKids = kids.length > 0;
      const open = _expanded.has(node.id);
      const row = document.createElement("button");
      row.type = "button";
      row.className = "folder-row" + (_selectedAssetId === node.id ? " active" : "");
      row.style.marginLeft = `${depth * 16}px`;
      row.innerHTML = `
        <span class="ico">${hasKids && open ? "📂" : "📁"}</span>
        <span>
          <span class="lbl">${esc(node.nome)}</span>
          <span class="sub">${esc(node.categoria || "—")} · ${esc(node.tipo || "—")}${hasKids ? ` · ${kids.length} pasta(s)` : ""}</span>
        </span>
      `;
      row.addEventListener("click", () => {
        _selectedAssetId = node.id;
        if (hasKids) {
          if (_expanded.has(node.id)) _expanded.delete(node.id);
          else _expanded.add(node.id);
        }
        renderFolderTree();
        renderAssetDetail();
      });
      box.appendChild(row);
      if (hasKids && open) walk(node.id, depth + 1);
    });
  }
  walk(null, 0);
}

function renderAssetDetail() {
  const site = currentSite();
  const el = $("assetDetail");
  if (!site) return;
  const item = (site.items || []).find((i) => i.id === _selectedAssetId);
  if (!item) {
    el.innerHTML = `<p class="muted">Toque numa pasta à esquerda para ver o detalhe.</p>`;
    return;
  }
  const kids = childrenOf(site.items || [], item.id);
  el.innerHTML = `
    <h3>${esc(item.nome)}</h3>
    <p class="muted">${esc(item.descricao || "Sem descrição cadastrada.")}</p>
    <div class="detail-grid">
      <div><span>Categoria</span><b>${esc(item.categoria || "—")}</b></div>
      <div><span>Tipo</span><b>${esc(item.tipo || "—")}</b></div>
      <div><span>Criticidade</span><b>${esc(item.criticidade || "—")}</b></div>
      <div><span>Subpastas</span><b>${kids.length}</b></div>
      <div><span>Site</span><b>${esc(site.codigo)}</b></div>
      <div><span>Prontuário</span><b>${esc(site.prontuarioStatus)}</b></div>
    </div>
  `;
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (m) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[m]
  ));
}

function tickClock() {
  $("clock").textContent = new Date().toLocaleString("pt-BR");
}

function bindChrome() {
  document.querySelectorAll("[data-back]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const to = btn.getAttribute("data-back");
      if (to === "regions") {
        $("kioskTitle").textContent = "Painel de Liderança";
        showView("regions");
      } else if (to === "sites") {
        openRegion(_regionId);
      }
    });
  });
  $("btnFullscreen").addEventListener("click", async () => {
    try {
      if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
      else await document.exitFullscreen();
    } catch {
      /* ignore */
    }
  });
}

function boot() {
  _state = buildModel();
  // Se há dados locais do harness, já entra na regional local
  if (_state.regions.length === 1 && _state.regions[0].id === "local") {
    renderRegions();
    openRegion("local");
  } else {
    renderRegions();
    showView("regions");
  }
  bindChrome();
  tickClock();
  setInterval(tickClock, 30000);
}

boot();
