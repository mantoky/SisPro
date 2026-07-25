/* ==========================================================================
   CFI Serviços — Inventário Inteligente de Sites Telecom
   app.js — Inicialização da aplicação
   ==========================================================================
   NOVO (vs. protótipo original): ao carregar, tenta restaurar do
   localStorage antes de gerar o site fictício de demonstração. Isso é o
   que dá persistência real entre sessões do navegador.
   ========================================================================== */

/* ── Confirmação in-app (substitui confirm() nativo) ───────────────────────
   confirmarDialog(mensagem, {titulo, confirmText, danger}) → Promise<boolean>.
   Usada por ações destrutivas (excluir site/item/circuito, importar backup).
   Em WebView (APK) o confirm() nativo é inconsistente; este modal é estável. */
let _confirmResolve = null;
function confirmarDialog(mensagem, opts = {}) {
  const { titulo = "Confirmação", confirmText = "Confirmar", danger = false } = opts;
  return new Promise((resolve) => {
    _confirmResolve = resolve;
    const tituloEl = document.getElementById("confirmTitulo");
    const msgEl = document.getElementById("confirmMensagem");
    const ok = document.getElementById("confirmOk");
    if (tituloEl) tituloEl.textContent = titulo;
    if (msgEl) msgEl.textContent = mensagem;
    if (ok) {
      ok.textContent = confirmText;
      ok.className = "btn" + (danger ? " danger" : "");
    }
    document.getElementById("confirmModalBackdrop").classList.add("active");
  });
}
function _confirmResult(valor) {
  document.getElementById("confirmModalBackdrop").classList.remove("active");
  const r = _confirmResolve;
  _confirmResolve = null;
  if (r) r(valor);
}
function confirmarSim() { _confirmResult(true); }
function confirmarNao() { _confirmResult(false); }

function initNavegacao() {
  document.querySelectorAll(".nav-btn").forEach((b) =>
    b.addEventListener("click", () => showView(b.dataset.view))
  );
}

/** Botão engrenagem do topbar — cofre SisPro_Data. */
function openAppSettings() {
  vaultOpenSettings();
}

/** Troca de abas (v3.4): antes, clicar numa aba limpava TODAS as abas do
 *  documento, mesmo as de outro grupo (ex.: trocar de aba na Inspeção
 *  reiniciava a aba aberta nos Detalhes do item, e vice-versa). Agora cada
 *  grupo é isolado pelo seu container comum (o pai que tem o .tabs e os
 *  .panel's como filhos diretos) — escala pra quantos grupos existirem. */
function initTabs() {
  document.querySelectorAll(".tabs").forEach(instalarSetasAba);
  document.querySelectorAll(".tab").forEach((t) =>
    t.addEventListener("click", () => ativarAba(t))
  );
}

function ativarAba(tabEl) {
  const tabsEl = tabEl.closest(".tabs");
  const grupo = tabsEl.parentElement;
  grupo.querySelectorAll(".tab").forEach((x) => x.classList.remove("active"));
  grupo.querySelectorAll(".panel").forEach((p) => p.classList.remove("active"));
  tabEl.classList.add("active");
  const painel = document.getElementById(tabEl.dataset.panel);
  if (painel) painel.classList.add("active");
  atualizarSetasAba(tabsEl);
}

/** Cria as duas setas (‹ ›) ao final da barra de abas de um grupo, pra
 *  navegar Anterior/Próximo sem precisar clicar na aba exata. */
function instalarSetasAba(tabsEl) {
  if (tabsEl.querySelector(".tab-nav-setas")) return; // já instalado
  const nav = document.createElement("div");
  nav.className = "tab-nav-setas";
  nav.innerHTML = `
    <button type="button" class="tab-seta" data-dir="-1" title="Guia anterior" aria-label="Guia anterior">‹</button>
    <button type="button" class="tab-seta" data-dir="1" title="Próxima guia" aria-label="Próxima guia">›</button>
  `;
  tabsEl.appendChild(nav);
  nav.querySelectorAll(".tab-seta").forEach((b) =>
    b.addEventListener("click", () => moverAba(tabsEl, parseInt(b.dataset.dir, 10)))
  );
  atualizarSetasAba(tabsEl);
}

function moverAba(tabsEl, direcao) {
  const tabs = Array.from(tabsEl.querySelectorAll(".tab"));
  const atual = tabs.findIndex((t) => t.classList.contains("active"));
  const proximo = atual + direcao;
  if (proximo < 0 || proximo >= tabs.length) return;
  ativarAba(tabs[proximo]);
}

function atualizarSetasAba(tabsEl) {
  const tabs = Array.from(tabsEl.querySelectorAll(".tab"));
  const atual = tabs.findIndex((t) => t.classList.contains("active"));
  const setas = tabsEl.querySelectorAll(".tab-seta");
  if (setas.length !== 2) return;
  setas[0].disabled = atual <= 0;
  setas[1].disabled = atual >= tabs.length - 1;
}

function initModais() {
  modalBackdrop.addEventListener("click", (e) => {
    if (e.target.id === "modalBackdrop") closeItemModal();
  });
  cloneModalBackdrop.addEventListener("click", (e) => {
    if (e.target.id === "cloneModalBackdrop") closeCloneModal();
  });
  const nsb = document.getElementById("novoSiteModalBackdrop");
  if (nsb) nsb.addEventListener("click", (e) => {
    if (e.target.id === "novoSiteModalBackdrop") closeNovoSiteModal();
  });
  const fmb = document.getElementById("fotoModalBackdrop");
  if (fmb) fmb.addEventListener("click", (e) => {
    if (e.target.id === "fotoModalBackdrop") fecharFotoModal();
  });
  const mmb = document.getElementById("mindMapModalBackdrop");
  // Mapa Mental: fechar só pelos controles − / + / ✕ (não pelo backdrop)
  const dgb = document.getElementById("depGraphModalBackdrop");
  if (dgb) dgb.addEventListener("click", (e) => {
    if (e.target.id === "depGraphModalBackdrop") closeDepGraphModal();
  });
  const mcb = document.getElementById("mmConectarModalBackdrop");
  if (mcb) mcb.addEventListener("click", (e) => {
    if (e.target.id === "mmConectarModalBackdrop") mmCancelarConectar();
  });
  const cmb = document.getElementById("circuitoModalBackdrop");
  if (cmb) cmb.addEventListener("click", (e) => {
    if (e.target.id === "circuitoModalBackdrop") closeCircuitoModal();
  });
  const cmmb = document.getElementById("circMapModalBackdrop");
  if (cmmb) cmmb.addEventListener("click", (e) => {
    if (e.target.id === "circMapModalBackdrop") closeCircMapModal();
  });
  const cfmb = document.getElementById("confirmModalBackdrop");
  if (cfmb) cfmb.addEventListener("click", (e) => {
    if (e.target.id === "confirmModalBackdrop") confirmarNao();
  });

  document.addEventListener("fullscreenchange", mmSincronizarBotaoFullscreen);

  initHubs();

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      // Mapa Mental: Esc NÃO fecha o editor (use − minimizar, + maximizar, ✕ fechar).
      // Em fullscreen o navegador pode sair sozinho; o modal permanece aberto.
      if (mmb && mmb.classList.contains("active")) {
        const integModal = document.getElementById("mmIntegrateModalBackdrop");
        if (integModal && integModal.classList.contains("active")) {
          mmCloseIntegratePopup();
          return;
        }
        const linkModal = document.getElementById("mmLinkModalBackdrop");
        if (linkModal && linkModal.classList.contains("active")) {
          mmCloseLinkModal();
          return;
        }
        if (typeof mmAnyGuidePopupOpen === "function" && mmAnyGuidePopupOpen()) {
          mmCloseAllGuidePopups();
        }
        return;
      }
      if (document.fullscreenElement) return;
      if (mcb && mcb.classList.contains("active")) { mmCancelarConectar(); return; }
      if (cmb && cmb.classList.contains("active")) { closeCircuitoModal(); return; }
      if (cmmb && cmmb.classList.contains("active")) { closeCircMapModal(); return; }
      if (cfmb && cfmb.classList.contains("active")) { confirmarNao(); return; }
      if (dgb && dgb.classList.contains("active")) closeDepGraphModal();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === "z" || e.key === "Z")) {
      if (mmb && mmb.classList.contains("active")) {
        e.preventDefault();
        mmUndo();
      }
      return;
    }
    if ((e.ctrlKey || e.metaKey) && ((e.shiftKey && (e.key === "z" || e.key === "Z")) || e.key === "y" || e.key === "Y")) {
      if (mmb && mmb.classList.contains("active")) {
        e.preventDefault();
        mmRedo();
      }
      return;
    }
    // Atalhos do motor do mapa mental (apenas com o modal aberto e sem foco em input)
    if (mmb && mmb.classList.contains("active")) {
      const tag = (e.target.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return;
      if ((e.ctrlKey || e.metaKey) && (e.key === "c" || e.key === "C")) { e.preventDefault(); mmCopy(); return; }
      if ((e.ctrlKey || e.metaKey) && (e.key === "x" || e.key === "X")) { e.preventDefault(); mmCut(); return; }
      if ((e.ctrlKey || e.metaKey) && (e.key === "v" || e.key === "V")) { e.preventDefault(); mmPaste(); return; }
      if (e.key === "Insert") { e.preventDefault(); mmAddChild(); return; }
      if (e.key === "Delete") { e.preventDefault(); mmDeleteFocused(); return; }
      if (e.key === "F2") { e.preventDefault(); mmRenameFocused(); return; }
    }
  });
}

/** "Hub": botão que abre/fecha um menu suspenso com um grupo de funções
 *  (em vez de espalhar todos os botões numa única barra). Genérico — vale
 *  pra qualquer ferramenta que adotar o padrão `.hub` / `.hub-menu`. */
function toggleHub(botao) {
  const menu = botao.nextElementSibling;
  const jaAberto = menu.classList.contains("open");
  document.querySelectorAll(".hub-menu.open").forEach((m) => m.classList.remove("open"));
  if (!jaAberto) menu.classList.add("open");
}

function initHubs() {
  document.addEventListener("click", (e) => {
    if (e.target.closest(".hub")) return;
    document.querySelectorAll(".hub-menu.open").forEach((m) => m.classList.remove("open"));
  });
}

function initValidacaoAoDigitar() {
  // Limpa o erro visual assim que o usuário começa a corrigir o campo.
  [siteNome, siteCodigo, siteLocalInstalacao, siteLat, siteLng].forEach((el) => {
    el.addEventListener("input", () => clearFieldError(el));
  });
  [newNome, newCategoria].forEach((el) => {
    el.addEventListener("input", () => clearFieldError(el));
  });
  const nsn = document.getElementById("novoSiteNomeInput");
  const nsc = document.getElementById("novoSiteCodigoInput");
  const nsl = document.getElementById("novoSiteLocalInput");
  if (nsn) nsn.addEventListener("input", () => clearFieldError(nsn));
  if (nsc) nsc.addEventListener("input", () => clearFieldError(nsc));
  if (nsl) nsl.addEventListener("input", () => clearFieldError(nsl));
  ["cloneNomeInput", "cloneCodigoInput", "cloneLocalInput"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener("input", () => clearFieldError(el));
  });
}

const HOME_MM_GUIDE_KEY = "cfi_home_mm_guide_open";

/** Guia recolhível do Início (Mapa mental): persiste preferência do arquiteto. */
function initHomeGuides() {
  const guide = document.getElementById("homeMindMapGuide");
  if (!guide) return;
  try {
    const saved = localStorage.getItem(HOME_MM_GUIDE_KEY);
    if (saved === "0") guide.removeAttribute("open");
    else if (saved === "1") guide.setAttribute("open", "");
  } catch (e) { /* ignore */ }
  guide.addEventListener("toggle", () => {
    try {
      localStorage.setItem(HOME_MM_GUIDE_KEY, guide.open ? "1" : "0");
    } catch (e) { /* ignore */ }
    if (guide.open && typeof renderMindMap === "function") renderMindMap();
  });
}

function initApp() {
  const restaurado = loadFromLocalStorage();
  if (!restaurado) {
    seedInitialData();
  } else {
    const raiz = activeItems().find((i) => i.parentId === null);
    root = raiz ? raiz.id : null;
  }
  sincronizarCamposSite();

  const vEl = document.getElementById("appVersionLabel");
  if (vEl) vEl.textContent = `CFI Serviços · v${APP_VERSION}`;

  initNavegacao();
  initTabs();
  initModais();
  initValidacaoAoDigitar();
  initBuscaArvore();
  initSeletorSite();
  initHomeGuides();
  if (typeof vaultInit === "function") vaultInit();

  renderAll();
  setAutosaveStatus(restaurado ? "restaurado" : "novo site");
}

function initBuscaArvore() {
  const busca = document.getElementById("buscaArvore");
  if (busca) busca.addEventListener("input", () => setFiltroArvore(busca.value));
}

function initSeletorSite() {
  const sel = document.getElementById("siteSelector");
  if (sel) sel.addEventListener("change", () => trocarSite(sel.value));

  const busca = document.getElementById("buscaSite");
  if (busca && sel) {
    busca.addEventListener("input", () => {
      const q = busca.value.trim().toLowerCase();
      Array.from(sel.options).forEach((o) => {
        const txt = o.textContent.toLowerCase();
        o.hidden = q && !txt.includes(q);
      });
      // se houver exatamente um site visível, seleciona-o
      const visiveis = Array.from(sel.options).filter((o) => !o.hidden);
      if (q && visiveis.length === 1 && visiveis[0].value !== state.activeSiteId) {
        trocarSite(visiveis[0].value);
      }
    });
  }
}

document.addEventListener("DOMContentLoaded", initApp);
