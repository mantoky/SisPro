/* ==========================================================================
   SisPro — Cofre local SisPro_Data (metadados + pastas por site)
   ==========================================================================
   Plataforma governa o processo; o disco (PC/VPS) guarda o volume.
   Usa File System Access API (Chrome/Edge). Sem handle: fallback download.
   ========================================================================== */

const VAULT_IDB = "sispro_vault_v1";
const VAULT_STORE = "handles";
const VAULT_HANDLE_KEY = "root";
const VAULT_META_KEY = "cfi_sispro_vault_meta";

const PRONTUARIO_STATUS = [
  "rascunho",
  "em_campo",
  "enviado_pelo_tecnico",
  "em_revisao",
  "concluido",
  "devolvido_campo",
];

const PRONTUARIO_LABEL = {
  rascunho: "Rascunho",
  em_campo: "Em campo",
  enviado_pelo_tecnico: "Enviado pelo técnico",
  em_revisao: "Em revisão",
  concluido: "Concluído",
  devolvido_campo: "Devolvido ao campo",
};

let _vaultRootHandle = null;
let _vaultDupResolve = null;

function vaultDefaultMeta() {
  return {
    labelPath: "",
    connected: false,
    lastSyncAt: null,
    index: { version: 1, sites: {} }, // codigoLower → { codigo, nome, siteId, folder, updatedAt }
  };
}

function vaultLoadMeta() {
  try {
    const raw = localStorage.getItem(VAULT_META_KEY);
    if (!raw) return vaultDefaultMeta();
    const parsed = JSON.parse(raw);
    return { ...vaultDefaultMeta(), ...parsed, index: parsed.index || { version: 1, sites: {} } };
  } catch {
    return vaultDefaultMeta();
  }
}

function vaultSaveMeta(meta) {
  localStorage.setItem(VAULT_META_KEY, JSON.stringify(meta));
}

function vaultFsSupported() {
  return typeof window.showDirectoryPicker === "function";
}

function vaultIdbOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(VAULT_IDB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(VAULT_STORE)) db.createObjectStore(VAULT_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function vaultIdbSet(key, value) {
  const db = await vaultIdbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(VAULT_STORE, "readwrite");
    tx.objectStore(VAULT_STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function vaultIdbGet(key) {
  const db = await vaultIdbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(VAULT_STORE, "readonly");
    const req = tx.objectStore(VAULT_STORE).get(key);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

function vaultSafeFolderName(codigo) {
  return String(codigo || "SITE")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w.-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80) || "SITE";
}

function vaultNextCopyCodigo(codigoBase) {
  const base = String(codigoBase || "SITE").replace(/_\d+$/, "");
  let n = 2;
  while (codigoJaExiste(`${base}_${n}`, null) || vaultIndexHas(`${base}_${n}`)) n += 1;
  return `${base}_${n}`;
}

function vaultIndexHas(codigo) {
  const meta = vaultLoadMeta();
  return Boolean(meta.index.sites[String(codigo || "").trim().toLowerCase()]);
}

function vaultIndexGet(codigo) {
  const meta = vaultLoadMeta();
  return meta.index.sites[String(codigo || "").trim().toLowerCase()] || null;
}

function vaultIndexUpsert(site, folderName) {
  const meta = vaultLoadMeta();
  const key = String(site.codigo || "").trim().toLowerCase();
  if (!key) return;
  meta.index.sites[key] = {
    codigo: site.codigo,
    nome: site.nome,
    siteId: site.id,
    folder: folderName || vaultSafeFolderName(site.codigo),
    prontuarioStatus: site.prontuarioStatus || "rascunho",
    updatedAt: nowIso(),
  };
  meta.lastSyncAt = nowIso();
  vaultSaveMeta(meta);
}

async function vaultEnsureDir(parent, name) {
  return parent.getDirectoryHandle(name, { create: true });
}

async function vaultWriteText(dirHandle, fileName, text) {
  const file = await dirHandle.getFileHandle(fileName, { create: true });
  const writable = await file.createWritable();
  await writable.write(text);
  await writable.close();
}

async function vaultGetRoot() {
  if (_vaultRootHandle) return _vaultRootHandle;
  try {
    const stored = await vaultIdbGet(VAULT_HANDLE_KEY);
    if (stored) {
      const perm = await stored.queryPermission({ mode: "readwrite" });
      if (perm === "granted") {
        _vaultRootHandle = stored;
        return _vaultRootHandle;
      }
      if (perm === "prompt") {
        const next = await stored.requestPermission({ mode: "readwrite" });
        if (next === "granted") {
          _vaultRootHandle = stored;
          return _vaultRootHandle;
        }
      }
    }
  } catch { /* ignore */ }
  return null;
}

async function vaultPickRoot() {
  if (!vaultFsSupported()) {
    toast("Seu navegador não suporta pasta local (use Chrome/Edge). O cofre usará downloads como fallback.", "error");
    return null;
  }
  const handle = await window.showDirectoryPicker({
    id: "sispro-data-root",
    mode: "readwrite",
    startIn: "documents",
  });
  // Garante estrutura raiz
  await vaultEnsureDir(handle, "sites");
  await vaultEnsureDir(handle, "_inbox");
  await vaultEnsureDir(handle, "_quarantine");
  await vaultEnsureDir(handle, "registry");
  _vaultRootHandle = handle;
  await vaultIdbSet(VAULT_HANDLE_KEY, handle);
  const meta = vaultLoadMeta();
  meta.connected = true;
  meta.labelPath = handle.name || "SisPro_Data";
  vaultSaveMeta(meta);
  await vaultWriteRegistry();
  toast(`Cofre ligado: ${meta.labelPath}`);
  return handle;
}

async function vaultWriteRegistry() {
  const root = await vaultGetRoot();
  if (!root) return false;
  const registry = await vaultEnsureDir(root, "registry");
  const meta = vaultLoadMeta();
  await vaultWriteText(registry, "sites-index.json", JSON.stringify(meta.index, null, 2));
  return true;
}

function vaultSitePayload(site) {
  return {
    id: site.id,
    nome: site.nome,
    codigo: site.codigo,
    criticidade: site.criticidade,
    latitude: site.latitude,
    longitude: site.longitude,
    resumo: site.resumo,
    localInstalacao: site.localInstalacao,
    centroTrabalho: site.centroTrabalho,
    statusOperacional: site.statusOperacional,
    prontuarioStatus: site.prontuarioStatus || "rascunho",
    createdAt: site.createdAt,
    updatedAt: site.updatedAt,
    items: site.items || [],
    circuitos: site.circuitos || [],
    links: site.links || [],
    meta: {
      origem: "sispro-desktop",
      exportedAt: nowIso(),
    },
  };
}

async function vaultMaterializeSite(site) {
  const folderName = vaultSafeFolderName(site.codigo);
  const root = await vaultGetRoot();
  if (!root) {
    // Fallback: baixa pacote JSON do site
    const blob = new Blob([JSON.stringify(vaultSitePayload(site), null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${folderName}_vault_meta.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    vaultIndexUpsert(site, folderName);
    return { ok: true, mode: "download", folder: folderName };
  }

  const sitesDir = await vaultEnsureDir(root, "sites");
  const siteDir = await vaultEnsureDir(sitesDir, folderName);
  const metaDir = await vaultEnsureDir(siteDir, "00_meta");
  await vaultEnsureDir(siteDir, "01_fotos");
  await vaultEnsureDir(siteDir, "02_rodadas");
  await vaultEnsureDir(siteDir, "03_laudos");
  await vaultEnsureDir(siteDir, "04_exports");

  const payload = vaultSitePayload(site);
  await vaultWriteText(metaDir, "site.json", JSON.stringify(payload, null, 2));
  await vaultWriteText(
    metaDir,
    "assets.json",
    JSON.stringify({ siteId: site.id, codigo: site.codigo, items: site.items || [], updatedAt: nowIso() }, null, 2)
  );
  await vaultWriteText(
    metaDir,
    "sync.log",
    `[${nowIso()}] materialize status=${payload.prontuarioStatus} items=${(site.items || []).length}\n`
  );

  vaultIndexUpsert(site, folderName);
  await vaultWriteRegistry();
  return { ok: true, mode: "fs", folder: folderName };
}

async function vaultWriteExportBlob(site, subfolder, fileName, blob) {
  const root = await vaultGetRoot();
  if (!root) return false;
  try {
    const sitesDir = await vaultEnsureDir(root, "sites");
    const siteDir = await vaultEnsureDir(sitesDir, vaultSafeFolderName(site.codigo));
    const dir = await vaultEnsureDir(siteDir, subfolder);
    const file = await dir.getFileHandle(fileName, { create: true });
    const writable = await file.createWritable();
    await writable.write(blob);
    await writable.close();
    return true;
  } catch {
    return false;
  }
}

/** Popup 3 opções: cancel | open | copy */
function vaultAskDuplicidade(codigo, nomeExistente) {
  return new Promise((resolve) => {
    _vaultDupResolve = resolve;
    const msg = document.getElementById("vaultDupMensagem");
    if (msg) {
      msg.textContent =
        `Já existe cadastro/pasta para o código "${codigo}"` +
        (nomeExistente ? ` (${nomeExistente})` : "") +
        ".\n\nCancelar — não cria nada.\n" +
        "Abrir existente — seleciona o prontuário já cadastrado.\n" +
        "Criar cópia — gera código com sufixo _2, _3… e pasta própria.";
    }
    document.getElementById("vaultDupModalBackdrop")?.classList.add("active");
  });
}

function vaultDupResult(choice) {
  document.getElementById("vaultDupModalBackdrop")?.classList.remove("active");
  const r = _vaultDupResolve;
  _vaultDupResolve = null;
  if (r) r(choice);
}

/**
 * Resolve código único antes de criar site.
 * Retorna { action: 'abort'|'proceed'|'open', codigo, nomeSuffix? }
 */
async function vaultResolveCodigoCriacao(codigoDesejado, nomeDesejado) {
  const codigo = String(codigoDesejado || "").trim();
  const existeEstado = codigoJaExiste(codigo, null);
  const existeIndice = vaultIndexHas(codigo);
  if (!existeEstado && !existeIndice) {
    return { action: "proceed", codigo, nome: nomeDesejado };
  }

  const idx = vaultIndexGet(codigo);
  const existente = state.sites.find((s) => String(s.codigo).toLowerCase() === codigo.toLowerCase());
  const choice = await vaultAskDuplicidade(codigo, existente?.nome || idx?.nome || "");

  if (choice === "cancel") return { action: "abort" };
  if (choice === "open") {
    if (existente) {
      state.activeSiteId = existente.id;
      scheduleAutosave();
      return { action: "open", siteId: existente.id };
    }
    toast("Código está no índice do cofre, mas o site não está carregado neste navegador. Importe o JSON da pasta do site.", "info");
    return { action: "abort" };
  }
  if (choice === "copy") {
    const novoCodigo = vaultNextCopyCodigo(codigo);
    const novoNome = `${nomeDesejado} (cópia ${novoCodigo.split("_").pop()})`;
    return { action: "proceed", codigo: novoCodigo, nome: novoNome };
  }
  return { action: "abort" };
}

async function vaultProvisionSite(site) {
  try {
    const r = await vaultMaterializeSite(site);
    if (r.mode === "fs") toast(`Pasta do site pronta: sites/${r.folder}`);
    else toast(`Metadados do site baixados (cof. sem pasta ligada): ${r.folder}_vault_meta.json`);
    return r;
  } catch (err) {
    toast(err?.message || "Falha ao materializar pasta do site.", "error");
    return { ok: false };
  }
}

function vaultSetProntuarioStatus(site, status, detalhe) {
  if (!site) return;
  if (!PRONTUARIO_STATUS.includes(status)) return;
  site.prontuarioStatus = status;
  site.updatedAt = nowIso();
  recordAudit("STATUS", "prontuario", site.id, detalhe || `Prontuário → ${PRONTUARIO_LABEL[status]}`, site);
  scheduleAutosave();
  vaultIndexUpsert(site, vaultSafeFolderName(site.codigo));
  vaultWriteRegistry().catch(() => {});
  vaultMaterializeSite(site).catch(() => {});
}

function vaultEnviarParaRevisao() {
  const site = activeSite();
  if (!site) return;
  if (site.prontuarioStatus === "concluido") {
    toast("Prontuário concluído. Abra uma nova revisita ou devolva ao campo pelo gestor.", "error");
    return;
  }
  vaultSetProntuarioStatus(site, "enviado_pelo_tecnico", "Técnico enviou prontuário para revisão do gestor.");
  toast("Enviado para revisão do gestor.");
  renderAll();
}

function vaultGestorEmRevisao() {
  const site = activeSite();
  if (!site) return;
  vaultSetProntuarioStatus(site, "em_revisao", "Gestor iniciou revisão.");
  toast("Em revisão.");
  renderAll();
}

function vaultGestorConcluir() {
  const site = activeSite();
  if (!site) return;
  if (!["enviado_pelo_tecnico", "em_revisao"].includes(site.prontuarioStatus)) {
    toast("Só é possível concluir após envio do técnico / em revisão.", "error");
    return;
  }
  vaultSetProntuarioStatus(site, "concluido", "Gestor concluiu o prontuário.");
  toast("Prontuário concluído.");
  renderAll();
}

function vaultGestorDevolver() {
  const site = activeSite();
  if (!site) return;
  vaultSetProntuarioStatus(site, "devolvido_campo", "Gestor devolveu ao campo.");
  toast("Devolvido ao técnico de campo.");
  renderAll();
}

function vaultOpenSettings() {
  const meta = vaultLoadMeta();
  const pathEl = document.getElementById("vaultPathLabel");
  const statusEl = document.getElementById("vaultStatusText");
  if (pathEl) pathEl.value = meta.labelPath || "";
  if (statusEl) {
    statusEl.textContent = meta.connected
      ? `Cofre conectado · ${Object.keys(meta.index.sites || {}).length} site(s) no índice`
      : vaultFsSupported()
        ? "Nenhuma pasta ligada. Escolha a raiz SisPro_Data no PC/VPS."
        : "Navegador sem File System Access — use Chrome/Edge ou fallback por download.";
  }
  if (typeof platformSyncFillSettingsForm === "function") platformSyncFillSettingsForm();
  document.getElementById("vaultSettingsModalBackdrop")?.classList.add("active");
}

function vaultCloseSettings() {
  document.getElementById("vaultSettingsModalBackdrop")?.classList.remove("active");
}

async function vaultChooseFolderFromSettings() {
  await vaultPickRoot();
  vaultOpenSettings();
}

function vaultSavePathLabel() {
  const meta = vaultLoadMeta();
  meta.labelPath = document.getElementById("vaultPathLabel")?.value?.trim() || meta.labelPath;
  vaultSaveMeta(meta);
  toast("Rótulo do caminho salvo (referência operacional).");
}

/** Instruções: no browser não abrimos Explorer nativo; mostra caminho e reforça FS. */
function vaultRevealInstructions(site) {
  const s = site || activeSite();
  const meta = vaultLoadMeta();
  const folder = vaultSafeFolderName(s?.codigo || "SITE");
  const base = meta.labelPath || "SisPro_Data";
  const path = `${base}/sites/${folder}/`;
  const msg =
    `Abra o Explorador de Arquivos nesta pasta:\n\n${path}\n\n` +
    `Subpastas: 00_meta · 01_fotos · 02_rodadas · 03_laudos · 04_exports\n\n` +
    (meta.connected
      ? "O cofre está ligado neste navegador — os metadados já foram (ou serão) gravados lá."
      : "Ligue a pasta em ⚙ Configurações → Escolher pasta SisPro_Data.");
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(path).catch(() => {});
  }
  confirmarDialog(msg + "\n\n(Caminho copiado para a área de transferência, se permitido.)", {
    titulo: "Pasta do site",
    confirmText: "OK",
    danger: false,
  });
}

async function vaultImportInboxJsonFile(file) {
  const text = await file.text();
  const data = JSON.parse(text);
  const siteLike = data.sites?.[0] || data;
  if (!siteLike?.codigo || !siteLike?.nome) throw new Error("JSON sem nome/código de site.");

  const resolved = await vaultResolveCodigoCriacao(siteLike.codigo, siteLike.nome);
  if (resolved.action === "abort") return null;
  if (resolved.action === "open") {
    sincronizarCamposSite();
    renderAll();
    return activeSite();
  }

  const site = createSite(
    resolved.nome,
    resolved.codigo,
    siteLike.criticidade || "Média",
    siteLike.latitude || "",
    siteLike.longitude || "",
    siteLike.resumo || "",
    siteLike.localInstalacao || "",
    siteLike.centroTrabalho || "",
    siteLike.statusOperacional || "Em implantação"
  );
  site.prontuarioStatus = siteLike.prontuarioStatus || "enviado_pelo_tecnico";
  site.items = Array.isArray(siteLike.items) ? siteLike.items : [];
  site.circuitos = Array.isArray(siteLike.circuitos) ? siteLike.circuitos : [];
  site.links = Array.isArray(siteLike.links) ? siteLike.links : [];
  if (!site.items.length) {
    const rootId = addItem("SITE " + site.nome, "Raiz", "Site Telecom", "Crítica", null, "Raiz importada do campo.");
    site.selectedItemId = rootId;
  }
  await vaultProvisionSite(site);
  sincronizarCamposSite();
  renderAll();
  toast(`Site ${site.codigo} importado do inbox/campo.`);
  return site;
}

function vaultTriggerImportInbox() {
  const input = document.getElementById("vaultInboxInput");
  if (input) {
    input.value = "";
    input.click();
  }
}

async function vaultOnInboxSelected(ev) {
  const file = ev.target?.files?.[0];
  if (!file) return;
  try {
    await vaultImportInboxJsonFile(file);
  } catch (err) {
    toast(err?.message || "Falha ao importar pacote do campo.", "error");
  }
}

async function vaultInit() {
  const meta = vaultLoadMeta();
  try {
    const root = await vaultGetRoot();
    meta.connected = Boolean(root);
    vaultSaveMeta(meta);
  } catch {
    meta.connected = false;
    vaultSaveMeta(meta);
  }
}

function prontuarioStatusLabel(status) {
  return PRONTUARIO_LABEL[status] || status || "Rascunho";
}
