import { Capacitor } from "@capacitor/core";
import { App } from "@capacitor/app";
import { StatusBar, Style } from "@capacitor/status-bar";
import { login, loginDemo, logout, restoreSession, getSession, isFirebaseConfigured } from "./auth.js";
import { listSites, getSite, upsertSite, deleteSite } from "./sites.js";
import { runSync, getPendingSites, markForSync, isOnline, enviarParaRevisao } from "./sync.js";
import { listRodadas, rodadaRapidaPDF, syncRodada } from "./rodadas.js";
import {
  CATEGORIAS_SUGERIDAS,
  TIPOS_SUGERIDOS,
  listAssetsTree,
  listParentOptions,
  getAsset,
  upsertAsset,
  deleteAsset,
  countChildren,
  listAssets,
} from "./assets.js";

const $ = (id) => document.getElementById(id);

let _currentSiteId = null;
let _defaultParentId = null;

function toast(msg, tipo = "info") {
  const el = $("toast");
  el.hidden = false;
  el.textContent = msg;
  el.classList.toggle("error", tipo === "error");
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.hidden = true; }, 2800);
}

function showView(name) {
  document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
  $(`view-${name}`)?.classList.add("active");
}

function showPanel(name) {
  ["list", "form", "detail", "assets", "asset-form"].forEach((p) =>
    $(`panel-${p}`)?.classList.toggle("active", p === name)
  );
  document.querySelectorAll(".tabbar-btn").forEach((b) => {
    b.classList.toggle("active", b.dataset.panel === "list" && name === "list");
  });
  $("panel-sync")?.classList.remove("active");
  $("panel-about")?.classList.remove("active");
  if (name === "list") {
    document.querySelector('.tabbar-btn[data-panel="list"]')?.classList.add("active");
  }
}

function openSheet(name) {
  $("panel-sync")?.classList.toggle("active", name === "sync");
  $("panel-about")?.classList.toggle("active", name === "about");
  document.querySelectorAll(".tabbar-btn").forEach((b) => {
    b.classList.toggle("active", b.dataset.panel === name);
  });
}

async function refreshSyncBanner() {
  const banner = $("syncBanner");
  const pending = await getPendingSites();
  const online = await isOnline();
  if (!pending.length) {
    banner.hidden = true;
    return;
  }
  banner.hidden = false;
  banner.className = "sync-banner" + (online ? "" : " err");
  banner.textContent = online
    ? `${pending.length} site(s) aguardando sincronização com o SisPro.`
    : `${pending.length} pendente(s) · sem rede — sync quando conectar.`;
}

async function renderSiteList(filtro = "") {
  const q = filtro.trim().toLowerCase();
  const sites = await listSites();
  const filtered = q
    ? sites.filter((s) => `${s.nome} ${s.codigo} ${s.localInstalacao}`.toLowerCase().includes(q))
    : sites;
  const list = $("siteList");
  const empty = $("emptySites");
  list.innerHTML = "";
  empty.hidden = filtered.length > 0;
  filtered.forEach((s) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "site-card";
    btn.setAttribute("role", "listitem");
    const badge =
      s.syncStatus === "synced" ? "synced" : s.syncStatus === "queued" ? "pending" : "pending";
    const badgeTxt =
      s.syncStatus === "synced" ? "Sincronizado" : s.syncStatus === "queued" ? "Na fila" : "Pendente sync";
    btn.innerHTML = `
      <div class="code">${esc(s.codigo)}</div>
      <div class="name">${esc(s.nome)}</div>
      <div class="meta">${esc(s.localInstalacao || "Sem local")} · ${esc(s.statusOperacional || "—")}</div>
      <span class="badge ${badge}">${badgeTxt}</span>
    `;
    btn.addEventListener("click", () => openDetail(s.id));
    list.appendChild(btn);
  });
  await refreshSyncBanner();
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (m) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[m]
  ));
}

async function renderRodadas(siteId) {
  const box = $("rodadasList");
  if (!box) return;
  const rodadas = await listRodadas(siteId);
  if (!rodadas.length) {
    box.innerHTML = `<p class="hint">Nenhuma rodada ainda. Use <strong>PDF rodada</strong> para gerar o espelho SisPro.</p>`;
    return;
  }
  box.innerHTML = `<h4 class="rodadas-title">Rodadas locais</h4>` + rodadas.map((r) => `
    <div class="rodada-card" data-id="${esc(r.id)}">
      <div>
        <strong>${esc(r.tipo)}</strong>
        <small class="muted">${esc(new Date(r.createdAt).toLocaleString("pt-BR"))} · ${esc(r.syncStatus)}</small>
      </div>
      <button type="button" class="btn btn-ghost btn-sm btn-sync-rodada" data-id="${esc(r.id)}" ${r.syncStatus === "synced" || !isFirebaseConfigured() ? "disabled" : ""}>Sync</button>
    </div>
  `).join("");
  box.querySelectorAll(".btn-sync-rodada").forEach((btn) => {
    btn.addEventListener("click", async () => {
      try {
        await syncRodada(btn.dataset.id);
        toast("Rodada sincronizada no Firestore.");
        await renderRodadas(siteId);
      } catch (err) {
        toast(err.message || "Falha ao sync rodada.", "error");
      }
    });
  });
}

async function openDetail(id) {
  const s = await getSite(id);
  if (!s) return;
  _currentSiteId = id;
  const items = await listAssets(id);
  const nAtivos = Math.max(0, items.length - 1);
  $("siteDetail").innerHTML = `
    <h3>${esc(s.nome)}</h3>
    <div class="detail-grid">
      <div><span>Código</span><b>${esc(s.codigo)}</b></div>
      <div><span>Local</span><b>${esc(s.localInstalacao || "—")}</b></div>
      <div><span>Centro</span><b>${esc(s.centroTrabalho || "—")}</b></div>
      <div><span>Criticidade</span><b>${esc(s.criticidade)}</b></div>
      <div><span>Status</span><b>${esc(s.statusOperacional)}</b></div>
      <div><span>Coords</span><b>${esc(s.latitude || "—")}, ${esc(s.longitude || "—")}</b></div>
      <div><span>Ativos</span><b>${nAtivos} camada(s) + raiz</b></div>
      <div><span>Prontuário</span><b>${esc(s.prontuarioStatus || "em_campo")}</b></div>
      <div><span>Resumo</span><b>${esc(s.resumo || "—")}</b></div>
      <div><span>Sync</span><b>${esc(s.syncStatus || "pending")}</b></div>
    </div>
  `;
  await renderRodadas(id);
  showPanel("detail");
}

function fillDatalists() {
  const dlCat = $("listaCategorias");
  const dlTipo = $("listaTipos");
  if (dlCat) dlCat.innerHTML = CATEGORIAS_SUGERIDAS.map((c) => `<option value="${esc(c)}">`).join("");
  if (dlTipo) dlTipo.innerHTML = TIPOS_SUGERIDOS.map((t) => `<option value="${esc(t)}">`).join("");
}

function collectAttrsFromForm() {
  const attrs = {};
  $("attrRows")?.querySelectorAll(".attr-row").forEach((row) => {
    const k = row.querySelector(".attr-key")?.value?.trim();
    const v = row.querySelector(".attr-val")?.value?.trim();
    if (k && v) attrs[k] = v;
  });
  return attrs;
}

function addAttrRow(key = "", val = "") {
  const box = $("attrRows");
  if (!box) return;
  const row = document.createElement("div");
  row.className = "attr-row";
  row.innerHTML = `
    <input class="attr-key" maxlength="80" placeholder="Chave" value="${esc(key)}" />
    <input class="attr-val" maxlength="200" placeholder="Valor" value="${esc(val)}" />
    <button type="button" class="icon-chip attr-del" aria-label="Remover">✕</button>
  `;
  row.querySelector(".attr-del").addEventListener("click", () => row.remove());
  box.appendChild(row);
}

function setAttrRows(attrs = {}) {
  const box = $("attrRows");
  if (!box) return;
  box.innerHTML = "";
  const entries = Object.entries(attrs || {});
  if (!entries.length) {
    addAttrRow("", "");
    return;
  }
  entries.forEach(([k, v]) => addAttrRow(k, v));
}

async function renderAssetTree() {
  if (!_currentSiteId) return;
  const tree = await listAssetsTree(_currentSiteId);
  const items = await listAssets(_currentSiteId);
  const box = $("assetTree");
  box.innerHTML = "";
  tree.forEach((node) => {
    const kids = countChildren(items, node.id);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "asset-node" + (node.parentId === null ? " root" : "");
    btn.style.setProperty("--depth", String(node.depth));
    btn.setAttribute("role", "listitem");
    const attrN = Object.keys(node.atributos || {}).length;
    btn.innerHTML = `
      <div class="asset-node-main">
        <strong>${esc(node.nome)}</strong>
        <span class="meta">${esc(node.categoria)} · ${esc(node.tipo)} · ${esc(node.criticidade)}</span>
      </div>
      <span class="asset-node-meta">${kids ? kids + " filho(s)" : "folha"}${attrN ? " · " + attrN + " atr." : ""}</span>
    `;
    btn.addEventListener("click", () => openAssetForm(node.id));
    btn.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      openAssetForm(null, node.id);
    });
    const addChild = document.createElement("button");
    addChild.type = "button";
    addChild.className = "icon-chip asset-add-child";
    addChild.title = "Adicionar filho";
    addChild.textContent = "+";
    addChild.addEventListener("click", (e) => {
      e.stopPropagation();
      openAssetForm(null, node.id);
    });
    const wrap = document.createElement("div");
    wrap.className = "asset-node-wrap";
    wrap.style.setProperty("--depth", String(node.depth));
    wrap.appendChild(btn);
    wrap.appendChild(addChild);
    box.appendChild(wrap);
  });
}

async function openAssetsPanel() {
  if (!_currentSiteId) return;
  fillDatalists();
  await renderAssetTree();
  showPanel("assets");
}

async function openAssetForm(itemId = null, parentId = null) {
  fillDatalists();
  const parents = await listParentOptions(_currentSiteId, itemId);
  const sel = $("assetParent");
  sel.innerHTML = parents.map((p) =>
    `<option value="${esc(p.id)}">${esc(p.nome)} (${esc(p.categoria)})</option>`
  ).join("");

  const item = itemId ? await getAsset(_currentSiteId, itemId) : null;
  const isRoot = item && item.parentId === null;

  $("assetFormTitle").textContent = item ? (isRoot ? "Editar raiz do site" : "Editar ativo") : "Novo ativo";
  $("assetId").value = item?.id || "";
  $("assetNome").value = item?.nome || "";
  $("assetCategoria").value = item?.categoria || "";
  $("assetTipo").value = item?.tipo || "";
  $("assetCriticidade").value = item?.criticidade || "Média";
  $("assetDescricao").value = item?.descricao || "";
  setAttrRows(item?.atributos || {});

  if (isRoot) {
    sel.disabled = true;
    sel.value = item.id;
    // raiz não tem pai na lista de filhos — inclui a si como opção desabilitada visual
    if (![...sel.options].some((o) => o.value === item.id)) {
      const opt = document.createElement("option");
      opt.value = item.id;
      opt.textContent = `${item.nome} (raiz)`;
      sel.appendChild(opt);
      sel.value = item.id;
    }
    $("btnExcluirAtivo").hidden = true;
  } else {
    sel.disabled = false;
    const prefer = item?.parentId || parentId || _defaultParentId || parents[0]?.id;
    if (prefer) sel.value = prefer;
    $("btnExcluirAtivo").hidden = !item;
  }

  showPanel("asset-form");
}

function openForm(site = null) {
  $("formTitle").textContent = site ? "Editar site" : "Novo site";
  $("siteId").value = site?.id || "";
  $("siteNome").value = site?.nome || "";
  $("siteCodigo").value = site?.codigo || "";
  $("siteLocal").value = site?.localInstalacao || "";
  $("siteCentro").value = site?.centroTrabalho || "";
  $("siteCriticidade").value = site?.criticidade || "Média";
  $("siteStatus").value = site?.statusOperacional || "Operacional";
  $("siteLat").value = site?.latitude || "";
  $("siteLng").value = site?.longitude || "";
  $("siteResumo").value = site?.resumo || "";
  $("btnExcluirSite").hidden = !site;
  showPanel("form");
}

async function enterApp() {
  const session = getSession();
  showView("shell");
  $("topbarUser").textContent = `${session.nome} · ${session.modo === "campo" ? "modo campo" : "online"}`;
  $("topbarTitle").textContent = "Sites";
  showPanel("list");
  await renderSiteList();
  await refreshSyncPanel();
}

async function refreshSyncPanel() {
  const pending = await getPendingSites();
  const online = await isOnline();
  $("syncStatusText").textContent = online
    ? `Online · ${pending.length} pendente(s)`
    : `Offline · ${pending.length} pendente(s)`;
  const ul = $("syncQueue");
  ul.innerHTML = "";
  pending.forEach((s) => {
    const li = document.createElement("li");
    li.textContent = `${s.codigo} — ${s.nome}`;
    ul.appendChild(li);
  });
  if (!pending.length) {
    const li = document.createElement("li");
    li.textContent = "Fila vazia.";
    ul.appendChild(li);
  }
}

function bindEvents() {
  $("formLogin").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await login($("loginEmail").value, $("loginSenha").value);
      await enterApp();
      toast("Sessão iniciada.");
    } catch (err) {
      toast(err.message || "Falha no login.", "error");
    }
  });

  $("btnDemoLogin").addEventListener("click", async () => {
    await loginDemo();
    await enterApp();
    toast("Modo campo (offline) ativo.");
  });

  $("btnLogout").addEventListener("click", async () => {
    await logout();
    showView("login");
    toast("Sessão encerrada.");
  });

  $("btnNovoSite").addEventListener("click", () => openForm(null));
  $("btnCancelForm").addEventListener("click", () => showPanel("list"));
  $("btnBackList").addEventListener("click", async () => {
    showPanel("list");
    await renderSiteList($("buscaSite").value);
  });

  $("buscaSite").addEventListener("input", () => renderSiteList($("buscaSite").value));

  $("formSite").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const saved = await upsertSite({
        id: $("siteId").value || undefined,
        nome: $("siteNome").value,
        codigo: $("siteCodigo").value,
        localInstalacao: $("siteLocal").value,
        centroTrabalho: $("siteCentro").value,
        criticidade: $("siteCriticidade").value,
        statusOperacional: $("siteStatus").value,
        latitude: $("siteLat").value,
        longitude: $("siteLng").value,
        resumo: $("siteResumo").value,
      });
      toast("Site salvo no aparelho.");
      await openDetail(saved.id);
      await renderSiteList($("buscaSite").value);
    } catch (err) {
      toast(err.message || "Erro ao salvar.", "error");
    }
  });

  $("btnExcluirSite").addEventListener("click", async () => {
    const id = $("siteId").value;
    if (!id) return;
    if (!confirm("Excluir este site do aparelho?")) return;
    await deleteSite(id);
    toast("Site excluído.");
    showPanel("list");
    await renderSiteList();
  });

  $("btnEditarSite").addEventListener("click", async () => {
    const s = await getSite(_currentSiteId);
    if (s) openForm(s);
  });

  $("btnAtivos").addEventListener("click", () => openAssetsPanel());
  $("btnBackDetail").addEventListener("click", () => openDetail(_currentSiteId));
  $("btnNovoAtivo").addEventListener("click", async () => {
    const root = (await listAssets(_currentSiteId)).find((i) => i.parentId === null);
    openAssetForm(null, root?.id || null);
  });
  $("btnCancelAsset").addEventListener("click", () => openAssetsPanel());
  $("btnAddAttr").addEventListener("click", () => addAttrRow("", ""));

  $("formAsset").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const id = $("assetId").value || undefined;
      const existing = id ? await getAsset(_currentSiteId, id) : null;
      const isRoot = existing && existing.parentId === null;
      await upsertAsset(_currentSiteId, {
        id,
        parentId: isRoot ? null : $("assetParent").value,
        nome: $("assetNome").value,
        categoria: $("assetCategoria").value,
        tipo: $("assetTipo").value,
        criticidade: $("assetCriticidade").value,
        descricao: $("assetDescricao").value,
        atributos: collectAttrsFromForm(),
      });
      toast("Ativo salvo.");
      await openAssetsPanel();
    } catch (err) {
      toast(err.message || "Erro ao salvar ativo.", "error");
    }
  });

  $("btnExcluirAtivo").addEventListener("click", async () => {
    const id = $("assetId").value;
    if (!id) return;
    if (!confirm("Excluir este ativo e todos os filhos?")) return;
    try {
      await deleteAsset(_currentSiteId, id);
      toast("Ativo excluído.");
      await openAssetsPanel();
    } catch (err) {
      toast(err.message || "Erro ao excluir.", "error");
    }
  });

  $("btnMarcarSync").addEventListener("click", async () => {
    await markForSync(_currentSiteId);
    toast("Marcado para sincronização.");
    await refreshSyncBanner();
    await openDetail(_currentSiteId);
  });

  $("btnEnviarRevisao").addEventListener("click", async () => {
    if (!_currentSiteId) return;
    try {
      const r = await enviarParaRevisao(_currentSiteId);
      toast(r.mensagem || "Enviado para revisão do gestor.", r.ok ? "info" : "error");
      await openDetail(_currentSiteId);
      await refreshSyncPanel();
    } catch (err) {
      toast(err.message || "Falha ao enviar.", "error");
    }
  });

  $("btnPdfRodada").addEventListener("click", async () => {
    if (!_currentSiteId) return;
    try {
      const obs = $("rodadaObs")?.value || "";
      await rodadaRapidaPDF(_currentSiteId, obs);
      toast("PDF da rodada gerado.");
      if ($("rodadaObs")) $("rodadaObs").value = "";
      await renderRodadas(_currentSiteId);
    } catch (err) {
      toast(err.message || "Falha ao gerar PDF.", "error");
    }
  });

  const doSync = async () => {
    try {
      const r = await runSync();
      toast(r.mensagem, r.ok ? "info" : "error");
      await renderSiteList($("buscaSite").value);
      await refreshSyncPanel();
    } catch (err) {
      toast(err.message || "Falha no sync.", "error");
    }
  };
  $("btnSync").addEventListener("click", doSync);
  $("btnSyncNow").addEventListener("click", doSync);

  document.querySelectorAll(".tabbar-btn").forEach((b) => {
    b.addEventListener("click", async () => {
      const panel = b.dataset.panel;
      if (panel === "list") {
        showPanel("list");
        await renderSiteList($("buscaSite").value);
      } else if (panel === "sync") {
        await refreshSyncPanel();
        openSheet("sync");
      } else if (panel === "about") {
        openSheet("about");
      }
    });
  });

  // tap fora: fechar sheet pelo botão voltar do Android
  document.addEventListener("backbutton", () => {}, false);
}

async function initNative() {
  if (!Capacitor.isNativePlatform()) return;
  try {
    await StatusBar.setBackgroundColor({ color: "#063f31" });
    await StatusBar.setStyle({ style: Style.Dark });
  } catch {
    /* StatusBar indisponível no web */
  }
  App.addListener("backButton", ({ canGoBack }) => {
    if ($("panel-sync")?.classList.contains("active") || $("panel-about")?.classList.contains("active")) {
      showPanel("list");
      return;
    }
    if ($("panel-asset-form")?.classList.contains("active")) {
      openAssetsPanel();
      return;
    }
    if ($("panel-assets")?.classList.contains("active")) {
      openDetail(_currentSiteId);
      return;
    }
    if ($("panel-form")?.classList.contains("active") || $("panel-detail")?.classList.contains("active")) {
      showPanel("list");
      return;
    }
    if (!canGoBack) App.exitApp();
  });
}

async function boot() {
  bindEvents();
  await initNative();
  const session = await restoreSession();
  if (session) await enterApp();
  else showView("login");
}

boot();
