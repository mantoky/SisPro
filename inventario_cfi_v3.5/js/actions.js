/* ==========================================================================
   CFI Serviços — Inventário Inteligente de Sites Telecom
   actions.js — Ações disparadas pela interface (CRUD, seleção, modal)
   ==========================================================================
   CORREÇÕES (vs. protótipo original):
   - saveSite() agora valida antes de salvar (nome, código, lat/lng).
   - removerAtributo(), removeDependency() e removeChecklist() agora
     chamam renderAll() de forma consistente após alterações.
   - deleteSelectedItem() agora também remove dependências de OUTROS itens
     que apontavam para o item excluído (pruneDependenciesTo), evitando
     pendências fantasmas — eram só escondidas pelo pill-broken antes.
   - cloneSite() trocou prompt() nativo por um modal consistente com a UI.
   ========================================================================== */

function currentItem() {
  return findItemById(selectedId());
}

/** ID da raiz (item sem pai) do site ativo. Mais confiável que o global `root`. */
function rootId() {
  const r = activeItems().find((i) => i.parentId === null);
  return r ? r.id : null;
}

function selectItem(id) {
  setSelectedId(id);
  document.body.classList.toggle("item-selected", !!id);
  renderAll();
}

/** Desseleciona o item atual e fecha o detalhe (bottom sheet no mobile). */
function deselectItem() {
  setSelectedId(null);
  document.body.classList.remove("item-selected");
  itemDetails.classList.add("hidden");
  itemEmpty.classList.remove("hidden");
  itemStatusBadge.className = "status warn";
  itemStatusBadge.textContent = "● Nenhum item selecionado";
  renderTree();
}

/** Desce um nível na hierarquia (drill-down) até os filhos de `id`. */
function enterNode(id) {
  setFocusItem(id);
  renderTree();
}

/** Atalho do FAB "+": adiciona um filho no nível atual do drill-down. */
function addChildAtFocus() {
  openItemModal(focusItemId());
}

/* ── Site ──────────────────────────────────────────────────────────────── */

function saveSite() {
  if (!validarFormSite()) {
    toast("Corrija os campos destacados antes de salvar.", "error");
    return;
  }
  activeSite().nome = siteNome.value.trim();
  activeSite().codigo = siteCodigo.value.trim();
  activeSite().criticidade = siteCriticidade.value;
  activeSite().latitude = siteLat.value.trim();
  activeSite().longitude = siteLng.value.trim();
  activeSite().resumo = siteResumo.value;
  activeSite().localInstalacao = siteLocalInstalacao.value.trim();
  activeSite().centroTrabalho = siteCentroTrabalho.value.trim();
  activeSite().statusOperacional = siteStatusOperacional.value;
  activeSite().updatedAt = nowIso();
  const raiz = activeItems().find((i) => i.parentId === null);
  if (raiz) {
    raiz.nome = "SITE " + activeSite().nome;
    raiz.atributos = raiz.atributos || {};
    raiz.atributos["Local de Instalação"] = activeSite().localInstalacao;
    raiz.atributos["Centro de Trabalho"] = activeSite().centroTrabalho || "Não informado";
    raiz.updatedAt = nowIso();
  }
  recordAudit("UPDATE", "site", activeSite().id, `Dados do site ${activeSite().codigo} atualizados.`);
  scheduleAutosave();
  vaultProvisionSite(activeSite()).catch(() => {});
  toast("Site salvo. A árvore raiz foi atualizada.");
  renderAll();
}

function openCloneModal() {
  const origem = activeSite();
  cloneNomeInput.value = `${origem.nome} — CÓPIA`;
  cloneCodigoInput.value = proximoCodigoDisponivel(`${origem.codigo}-C`);
  cloneLocalInput.value = "";
  [cloneNomeInput, cloneCodigoInput, cloneLocalInput].forEach(clearFieldError);
  cloneModalBackdrop.classList.add("active");
  cloneNomeInput.focus();
}

function closeCloneModal() {
  cloneModalBackdrop.classList.remove("active");
}

async function confirmClone() {
  const n = cloneNomeInput.value.trim();
  const codigo = cloneCodigoInput.value.trim();
  const local = cloneLocalInput.value.trim();
  const nomeErr = validarObrigatorio(n, "Nome do novo site");
  const codigoErr = validarObrigatorio(codigo, "Código") || validarFormatoCodigo(codigo);
  const localErr = validarObrigatorio(local, "Local de Instalação");
  setFieldError(cloneNomeInput, nomeErr);
  setFieldError(cloneCodigoInput, codigoErr);
  setFieldError(cloneLocalInput, localErr);
  if (nomeErr || codigoErr || localErr) return;

  const resolved = await vaultResolveCodigoCriacao(codigo, n);
  if (resolved.action === "abort") return;
  if (resolved.action === "open") {
    closeCloneModal();
    sincronizarCamposSite();
    renderAll();
    toast("Site existente aberto.");
    return;
  }

  const origem = activeSite();

  // Cria o novo site (vira o ativo)
  const novo = createSite(
    resolved.nome,
    resolved.codigo,
    origem.criticidade,
    origem.latitude,
    origem.longitude,
    origem.resumo,
    local,
    origem.centroTrabalho || "",
    origem.statusOperacional || "Operacional"
  );
  novo.prontuarioStatus = "rascunho";

  // Clona itens com novos IDs, mantendo o mapeamento antigo→novo para
  // remapear parentId e as dependências corretamente.
  const mapaId = {};
  origem.items.forEach((it) => { mapaId[it.id] = uid(); });

  novo.items = origem.items.map((it) => ({
    id: mapaId[it.id],
    parentId: it.parentId === null ? null : (mapaId[it.parentId] || null),
    nome: it.nome,
    categoria: it.categoria,
    tipo: it.tipo,
    criticidade: it.criticidade,
    descricao: it.descricao,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    atributos: { ...it.atributos },
    dependencias: (it.dependencias || [])
      .filter((d) => mapaId[d.itemId])
      .map((d) => ({ tipo: d.tipo, itemId: mapaId[d.itemId] })),
    fotos: (it.fotos || []).map((f) => ({ ...f })),
    checklist: (it.checklist || []).map((c) => ({ ...c })),
  }));

  const raiz = novo.items.find((i) => i.parentId === null);
  if (raiz) {
    raiz.nome = "SITE " + resolved.nome;
    raiz.atributos = raiz.atributos || {};
    raiz.atributos["Local de Instalação"] = local;
  }

  recordAudit("CLONE", "site", novo.id, `Site ${origem.codigo} clonado como ${novo.codigo}.`, novo);
  scheduleAutosave();
  await vaultProvisionSite(novo);
  closeCloneModal();
  sincronizarCamposSite();
  toast(`Novo site "${resolved.nome}" criado a partir do modelo. Agora você tem ${state.sites.length} sites.`);
  renderAll();
}

/** Atualiza os campos do formulário do site com os dados do site ativo. */
function sincronizarCamposSite() {
  const s = activeSite();
  if (!s) return;
  siteNome.value = s.nome;
  siteCodigo.value = s.codigo;
  siteCriticidade.value = s.criticidade;
  siteLat.value = s.latitude;
  siteLng.value = s.longitude;
  siteResumo.value = s.resumo;
  siteLocalInstalacao.value = s.localInstalacao || "";
  siteCentroTrabalho.value = s.centroTrabalho || "";
  siteStatusOperacional.value = s.statusOperacional || "Operacional";
}

function proximoCodigoDisponivel(base) {
  let candidate = base;
  let suffix = 1;
  while (codigoJaExiste(candidate, null)) candidate = `${base}${suffix++}`;
  return candidate;
}

/** Troca o site ativo (chamado pelo seletor de sites). */
function trocarSite(siteId) {
  setActiveSite(siteId);
  const s = activeSite();
  if (s) s.selectedItemId = null;
  setFocusItem(null); // volta o drill-down para a raiz do novo site
  document.body.classList.remove("item-selected");
  itemDetails.classList.add("hidden");
  itemEmpty.classList.remove("hidden");
  itemStatusBadge.className = "status warn";
  itemStatusBadge.textContent = "● Nenhum item selecionado";
  // trocou de site: histórico de desfazer/refazer e foco do mapa mental não se aplicam mais
  if (typeof mmLimparPilhasDeOutroSite === "function") mmLimparPilhasDeOutroSite();
  if (typeof _mmFocusId !== "undefined") _mmFocusId = null;
  if (typeof _mmCollapsed !== "undefined") _mmCollapsed = new Set();
  sincronizarCamposSite();
  renderAll();
  toast(`Site ativo: ${s ? s.nome : "—"}`);
}

/** Cria um site novo em branco (sem itens, exceto a raiz).
 *  v3: deixou de usar prompt() nativo do navegador (inconsistente com o
 *  resto da UI) — agora usa modal estilizado, igual ao de "Duplicar site".
 *  Também passou a deixar o código do site visível e editável na criação,
 *  com validação de unicidade (o código nomeia todos os exports). */
function openNovoSiteModal() {
  novoSiteNomeInput.value = "NOVO SITE LTE";
  novoSiteCodigoInput.value = proximoCodigoDisponivel("SITE-NOVO");
  novoSiteLocalInput.value = "";
  [novoSiteNomeInput, novoSiteCodigoInput, novoSiteLocalInput].forEach(clearFieldError);
  novoSiteModalBackdrop.classList.add("active");
  novoSiteNomeInput.focus();
}

function closeNovoSiteModal() {
  novoSiteModalBackdrop.classList.remove("active");
}

async function confirmNovoSite() {
  const nome = novoSiteNomeInput.value.trim();
  const codigo = novoSiteCodigoInput.value.trim();
  const local = novoSiteLocalInput.value.trim();

  const nomeErr = validarObrigatorio(nome, "Nome do site");
  setFieldError(novoSiteNomeInput, nomeErr);

  // unicidade tratada pelo cofre (popup duplicidade); aqui só formato
  const codigoErr = validarObrigatorio(codigo, "Código") || validarFormatoCodigo(codigo);
  setFieldError(novoSiteCodigoInput, codigoErr);

  const localErr = validarObrigatorio(local, "Local de Instalação");
  setFieldError(novoSiteLocalInput, localErr);

  if (nomeErr || codigoErr || localErr) return;

  const resolved = await vaultResolveCodigoCriacao(codigo, nome);
  if (resolved.action === "abort") return;
  if (resolved.action === "open") {
    closeNovoSiteModal();
    sincronizarCamposSite();
    renderAll();
    toast("Site existente aberto.");
    return;
  }

  const site = createSite(
    resolved.nome,
    resolved.codigo,
    "Alta",
    "0.000000",
    "0.000000",
    "Novo site criado em branco.",
    local,
    "",
    "Em implantação"
  );
  site.prontuarioStatus = "rascunho";
  root = addItem("SITE " + resolved.nome, "Raiz", "Site Telecom", "Crítica", null, "Raiz do novo site.");
  findItemById(root).atributos["Local de Instalação"] = local;
  await vaultProvisionSite(site);
  sincronizarCamposSite();
  closeNovoSiteModal();
  toast(`Site "${resolved.nome}" (${resolved.codigo}) criado.`);
  renderAll();
}

/** Exclui o site ATIVO (com confirmação). Bloqueado se for o único site
 *  restante — o app sempre precisa de pelo menos um. Não existia nenhuma
 *  forma de remover um site criado por engano/duplicado; sites de teste
 *  se acumulavam para sempre no seletor. */
async function excluirSiteAtual() {
  const s = activeSite();
  if (!s) return;
  if (state.sites.length <= 1) {
    toast("Não é possível excluir o único site cadastrado.", "error");
    return;
  }
  const ok = await confirmarDialog(
    `Excluir o site "${s.nome}" (${s.codigo}) e todos os seus ${activeItems().length} itens? Esta ação não pode ser desfeita.`,
    { titulo: "Excluir site", confirmText: "Excluir", danger: true }
  );
  if (!ok) return;

  const r = removeSiteFromState(s.id);
  if (!r.ok) {
    toast(r.motivo, "error");
    return;
  }
  sincronizarCamposSite();
  itemDetails.classList.add("hidden");
  itemEmpty.classList.remove("hidden");
  toast(`Site "${s.nome}" excluído. Site ativo agora: ${activeSite().nome}.`);
  renderAll();
}

/* ── Item selecionado: edição e exclusão ─────────────────────────────────── */

function updateSelectedItem() {
  const item = currentItem();
  if (!item) return;
  if (!detailNome.value.trim() || !detailCategoria.value.trim()) return toast("Nome e categoria são obrigatórios.", "error");
  item.nome = detailNome.value.trim();
  item.categoria = detailCategoria.value.trim();
  item.tipo = detailTipo.value.trim() || "Item personalizado";
  item.criticidade = detailCriticidade.value;
  item.descricao = detailDescricao.value.trim();
  item.updatedAt = nowIso();
  activeSite().updatedAt = nowIso();
  recordAudit("UPDATE", "item", item.id, `Item ${item.nome} atualizado.`);
  scheduleAutosave();
  toast("Item atualizado com sucesso.");
  renderAll();
}

async function deleteSelectedItem() {
  const item = currentItem();
  if (!item || item.parentId === null) {
    toast("A raiz do site não pode ser excluída.", "error");
    return;
  }
  const ok = await confirmarDialog("Excluir este item e seus filhos?", {
    titulo: "Excluir item", confirmText: "Excluir", danger: true,
  });
  if (!ok) return;

  const ids = collectChildren(item.id);
  ids.push(item.id);

  // Remove referências de dependência em QUALQUER outro item que apontava
  // para os itens excluídos — não deixa pendência fantasma no inventário.
  ids.forEach((removedId) => pruneDependenciesTo(removedId));

  const site = activeSite();
  recordAudit("DELETE", "item", item.id, `${item.nome} e ${ids.length - 1} descendente(s) excluídos.`);
  site.items = site.items.filter((i) => !ids.includes(i.id));
  site.updatedAt = nowIso();
  site.selectedItemId = null;
  document.body.classList.remove("item-selected");
  itemDetails.classList.add("hidden");
  itemEmpty.classList.remove("hidden");
  itemStatusBadge.className = "status warn";
  itemStatusBadge.textContent = "● Nenhum item selecionado";
  scheduleAutosave();
  toast("Item excluído da árvore.");
  renderAll();
}

/* ── Atributos ─────────────────────────────────────────────────────────── */

function addAttribute() {
  const item = currentItem();
  const n = attrNome.value.trim();
  const v = attrValor.value.trim();
  if (!item || !n) return toast("Informe o nome do atributo.", "error");
  item.atributos[n] = v || "-";
  item.updatedAt = nowIso();
  recordAudit("UPDATE", "attribute", item.id, `Atributo ${n} definido em ${item.nome}.`);
  attrNome.value = "";
  attrValor.value = "";
  scheduleAutosave();
  renderAttrList();
  toast("Atributo adicionado.");
}

function removerAtributo(n) {
  const item = currentItem();
  if (!item) return;
  delete item.atributos[n];
  item.updatedAt = nowIso();
  recordAudit("DELETE", "attribute", item.id, `Atributo ${n} removido de ${item.nome}.`);
  scheduleAutosave();
  renderAll();
}

/* ── Dependências ──────────────────────────────────────────────────────── */

function addDependency() {
  const item = currentItem();
  const targetId = depItemSelect.value;
  if (!item || !targetId) return toast("Selecione o item relacionado.", "error");
  const r = addDependencyDirect(item.id, targetId, depTipo.value);
  if (!r.ok) return toast(r.motivo, "error");
  renderDepList();
  toast("Dependência criada.");
}

function removeDependency(i) {
  const item = currentItem();
  if (!item || !item.dependencias[i]) return;
  const removed = item.dependencias.splice(i, 1)[0];
  item.updatedAt = nowIso();
  recordAudit("DELETE", "dependency", item.id, `Relação ${removed.tipo} removida de ${item.nome}.`);
  scheduleAutosave();
  renderAll();
}

/* ── Inspeção · ações sobre o checklist consolidado (v3.4) ────────────────
   Mesma escrita usada pelo formulário por-item, só que enderaçada por
   itemId — permite editar o checklist de qualquer item sem trocar de
   tela toda hora. */

function addChecklistGlobal() {
  const itemId = document.getElementById("inspChecklistItemSelect").value;
  const texto = document.getElementById("inspChecklistTexto").value.trim();
  const status = document.getElementById("inspChecklistStatusNovo").value;
  const item = findItemById(itemId);
  if (!item || !texto) return toast("Selecione o item e informe o ponto de inspeção.", "error");
  item.checklist.push({ texto, status });
  item.updatedAt = nowIso();
  recordAudit("CREATE", "checklist", item.id, `Ponto de inspeção adicionado: ${texto}.`);
  document.getElementById("inspChecklistTexto").value = "";
  scheduleAutosave();
  renderInspection();
  toast("Ponto de inspeção adicionado.");
}

function atualizarStatusChecklistGlobal(itemId, idx, novoStatus) {
  const item = findItemById(itemId);
  if (!item || !item.checklist[idx]) return;
  item.checklist[idx].status = novoStatus;
  item.updatedAt = nowIso();
  recordAudit("INSPECT", "checklist", item.id, `${item.nome}: ${item.checklist[idx].texto} → ${novoStatus}.`);
  scheduleAutosave();
  renderInspection();
  toast("Status atualizado.");
}

function removerChecklistGlobal(itemId, idx) {
  const item = findItemById(itemId);
  if (!item || !item.checklist[idx]) return;
  const removed = item.checklist.splice(idx, 1)[0];
  item.updatedAt = nowIso();
  recordAudit("DELETE", "checklist", item.id, `Ponto removido de ${item.nome}: ${removed.texto}.`);
  scheduleAutosave();
  renderInspection();
  toast("Ponto de inspeção removido.");
}

/* ── Checklist ─────────────────────────────────────────────────────────── */

function addChecklist() {
  const item = currentItem();
  const t = checkText.value.trim();
  if (!item || !t) return toast("Informe o ponto de inspeção.", "error");
  item.checklist.push({ texto: t, status: checkStatus.value });
  item.updatedAt = nowIso();
  recordAudit("CREATE", "checklist", item.id, `Ponto de inspeção adicionado: ${t}.`);
  checkText.value = "";
  scheduleAutosave();
  renderCheckList();
  renderInspection();
  toast("Checklist atualizado.");
}

function removeChecklist(i) {
  const item = currentItem();
  if (!item || !item.checklist[i]) return;
  const removed = item.checklist.splice(i, 1)[0];
  item.updatedAt = nowIso();
  recordAudit("DELETE", "checklist", item.id, `Ponto removido: ${removed.texto}.`);
  scheduleAutosave();
  renderCheckList();
  renderInspection();
}

/* ── Modal: novo item ──────────────────────────────────────────────────── */

function openItemModal(parentId = null) {
  renderParentOptions(parentId || selectedId() || rootId());
  clearFieldError(newNome);
  clearFieldError(newCategoria);
  modalBackdrop.classList.add("active");
}

function closeItemModal() {
  modalBackdrop.classList.remove("active");
}

function createItem() {
  if (!validarFormNovoItem()) {
    toast("Corrija os campos destacados.", "error");
    return;
  }
  const nome = newNome.value.trim();
  const cat = newCategoria.value.trim();
  const tipo = newTipo.value.trim();
  const desc = newDescricao.value.trim();
  addItem(nome, cat, tipo || "Item personalizado", newCriticidade.value, newParent.value, desc || "Item criado manualmente e totalmente editável.");
  [newNome, newCategoria, newTipo, newDescricao].forEach((e) => (e.value = ""));
  closeItemModal();
  toast("Novo item criado na árvore.");
  renderAll();
}

/* ── Evidências fotográficas ──────────────────────────────────────────── */

const FOTO_MAX_DIM = 1280;     // px — redimensiona o lado maior para isto
const FOTO_QUALIDADE = 0.7;    // qualidade JPEG (0-1)

function triggerFotoUpload() {
  const item = currentItem();
  if (!item) return toast("Selecione um item antes de anexar foto.", "error");
  fotoInput.click();
}

/** Lê os arquivos escolhidos, redimensiona e guarda como JPEG base64. */
function onFotoSelected(input) {
  const item = currentItem();
  if (!item) return;
  const files = Array.from(input.files || []);
  let pendentes = files.length;
  if (!pendentes) return;

  files.forEach((file) => {
    if (!file.type.startsWith("image/")) {
      pendentes--;
      return toast(`"${file.name}" não é uma imagem.`, "error");
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const dataUrl = redimensionarImagem(img, FOTO_MAX_DIM, FOTO_QUALIDADE);
        item.fotos = item.fotos || [];
        item.fotos.push({ nome: file.name, dataUrl });
        item.updatedAt = nowIso();
        recordAudit("CREATE", "evidence", item.id, `Evidência ${file.name} anexada a ${item.nome}.`);
        pendentes--;
        if (pendentes === 0) {
          scheduleAutosave();
          renderFotos();
          marcarFotosRegistradas(item);
          toast("Evidência(s) anexada(s).");
        }
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
  input.value = "";
}

/** Desenha a imagem num canvas reduzido e devolve JPEG base64 (economiza espaço). */
function redimensionarImagem(img, maxDim, qualidade) {
  let { width, height } = img;
  if (width > height && width > maxDim) {
    height = Math.round((height * maxDim) / width);
    width = maxDim;
  } else if (height > maxDim) {
    width = Math.round((width * maxDim) / height);
    height = maxDim;
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d").drawImage(img, 0, 0, width, height);
  return canvas.toDataURL("image/jpeg", qualidade);
}

/** Se houver foto, marca o item de checklist "Fotos registradas" como Conforme. */
function marcarFotosRegistradas(item) {
  const chk = (item.checklist || []).find((c) => c.texto === "Fotos registradas");
  if (chk && (item.fotos || []).length > 0) {
    chk.status = "Conforme";
    renderCheckList();
    renderInspection();
  }
}

function removerFoto(idx) {
  const item = currentItem();
  if (!item || !item.fotos[idx]) return;
  const removed = item.fotos.splice(idx, 1)[0];
  item.updatedAt = nowIso();
  recordAudit("DELETE", "evidence", item.id, `Evidência ${removed.nome} removida de ${item.nome}.`);
  scheduleAutosave();
  renderFotos();
}

function abrirFotoModal(idx) {
  const item = currentItem();
  if (!item || !item.fotos[idx]) return;
  fotoModalImg.src = item.fotos[idx].dataUrl;
  fotoModalCaption.textContent = item.fotos[idx].nome;
  fotoModalBackdrop.classList.add("active");
}

/** Mesma coisa que abrirFotoModal(), mas endereçada por itemId — usada
 *  pela galeria consolidada de Evidências da Inspeção, que mostra fotos
 *  de itens diferentes na mesma grade (por isso o item entra na legenda). */
function abrirFotoModalDe(itemId, idx) {
  const item = findItemById(itemId);
  if (!item || !item.fotos[idx]) return;
  fotoModalImg.src = item.fotos[idx].dataUrl;
  fotoModalCaption.textContent = `${item.nome} — ${item.fotos[idx].nome}`;
  fotoModalBackdrop.classList.add("active");
}

function fecharFotoModal() {
  fotoModalBackdrop.classList.remove("active");
  fotoModalImg.src = "";
}

function gerarPendencias() {
  renderInspection();
  toast("Pendências recalculadas.");
}

/* ── Circuitos físicos (endereçamento) — UI ──────────────────────────────
   O modal edita um RASCUNHO em memória (_circDraft) e só persiste em "Salvar".
   add/remove/move relê o DOM para o rascunho antes de re-renderizar, pra não
   perder o que o técnico já digitou nos outros trechos. */

let _circDraft = null;

function openCircuitoModalForCurrent() {
  const item = currentItem();
  if (!item) return toast("Selecione um item primeiro.", "error");
  _circDraft = {
    id: null, nome: "", tipo: "alimentacao",
    trechos: [
      { itemId: "", papel: "quadro", posicao: "", disjuntor: "", bitola: "", fase: "", comprimento: "", observacao: "" },
      { itemId: item.id, papel: "ativo", posicao: "", disjuntor: "", bitola: "", fase: "", comprimento: "", observacao: "" },
    ],
  };
  _openCircuitoModalUI();
}

function openCircuitoModal(circId) {
  const c = findCircuito(circId);
  if (!c) return;
  _circDraft = { id: c.id, nome: c.nome, tipo: c.tipo, trechos: c.trechos.map((t) => ({ ...t })) };
  _openCircuitoModalUI();
}

function _openCircuitoModalUI() {
  document.getElementById("circNome").value = _circDraft.nome;
  document.getElementById("circTipo").value = _circDraft.tipo;
  circRenderTrechos();
  document.getElementById("circuitoModalBackdrop").classList.add("active");
}

function closeCircuitoModal() {
  document.getElementById("circuitoModalBackdrop").classList.remove("active");
  _circDraft = null;
}

function circAddTrecho() {
  circReadDraftFromDOM();
  _circDraft.trechos.push({ itemId: "", papel: "cabo", posicao: "", disjuntor: "", bitola: "", fase: "", comprimento: "", observacao: "" });
  circRenderTrechos();
}

function circRemoveTrecho(idx) {
  circReadDraftFromDOM();
  _circDraft.trechos.splice(idx, 1);
  circRenderTrechos();
}

function circMoveTrecho(idx, dir) {
  circReadDraftFromDOM();
  const j = idx + dir;
  if (j < 0 || j >= _circDraft.trechos.length) return;
  const arr = _circDraft.trechos;
  [arr[idx], arr[j]] = [arr[j], arr[idx]];
  circRenderTrechos();
}

function circRenderTrechos() {
  const cont = document.getElementById("circTrechos");
  if (!cont || !_circDraft) return;
  cont.replaceChildren();
  _circDraft.trechos.forEach((t, idx) => cont.appendChild(circTrechoRow(t, idx)));
}

function circTrechoRow(t, idx) {
  const row = document.createElement("div");
  row.className = "circ-trecho";

  const head = document.createElement("div");
  head.className = "circ-trecho-head";
  const title = document.createElement("b");
  title.textContent = `Trecho ${idx + 1}`;
  const moves = document.createElement("div");
  moves.className = "circ-trecho-moves";
  const up = document.createElement("button");
  up.className = "mini-btn"; up.type = "button"; up.textContent = "↑"; up.disabled = idx === 0;
  up.addEventListener("click", () => circMoveTrecho(idx, -1));
  const down = document.createElement("button");
  down.className = "mini-btn"; down.type = "button"; down.textContent = "↓";
  down.disabled = idx === _circDraft.trechos.length - 1;
  down.addEventListener("click", () => circMoveTrecho(idx, 1));
  const rm = document.createElement("button");
  rm.className = "mini-btn danger"; rm.type = "button"; rm.textContent = "×";
  rm.setAttribute("aria-label", "Remover trecho");
  rm.addEventListener("click", () => circRemoveTrecho(idx));
  moves.append(up, down, rm);
  head.append(title, moves);
  row.appendChild(head);

  const split = document.createElement("div");
  split.className = "split";
  const fItem = document.createElement("div");
  fItem.className = "field";
  const lI = document.createElement("label"); lI.textContent = "Item"; fItem.appendChild(lI);
  const sel = document.createElement("select");
  sel.className = "circ-t-item";
  const empty = document.createElement("option"); empty.value = ""; empty.textContent = "— selecionar —"; sel.appendChild(empty);
  activeItems().forEach((i) => {
    const o = document.createElement("option"); o.value = i.id; o.textContent = i.nome;
    if (i.id === t.itemId) o.selected = true;
    sel.appendChild(o);
  });
  fItem.appendChild(sel);

  const fPapel = document.createElement("div");
  fPapel.className = "field";
  const lP = document.createElement("label"); lP.textContent = "Papel"; fPapel.appendChild(lP);
  const selP = document.createElement("select");
  selP.className = "circ-t-papel";
  ["quadro", "dj", "disjuntor", "cabo", "ativo", "medio", "outro"].forEach((p) => {
    const o = document.createElement("option"); o.value = p; o.textContent = p;
    if (p === t.papel) o.selected = true;
    selP.appendChild(o);
  });
  fPapel.appendChild(selP);
  split.append(fItem, fPapel);
  row.appendChild(split);

  const grid = document.createElement("div");
  grid.className = "circ-t-attrs";
  [
    ["posicao", "Posição", "Ex.: QD-01 / DJ 3 / L1"],
    ["disjuntor", "Disjuntor", "Ex.: 1P 25A curva C"],
    ["bitola", "Bitola do cabo", "Ex.: 6 mm²"],
    ["fase", "Fase", "Ex.: L1+N+PE"],
    ["comprimento", "Comprimento", "Ex.: 12 m"],
    ["observacao", "Observação", ""],
  ].forEach(([key, label, ph]) => {
    const f = document.createElement("div");
    f.className = "field";
    const l = document.createElement("label"); l.textContent = label; f.appendChild(l);
    const inp = document.createElement("input");
    inp.className = "circ-t-attr"; inp.dataset.key = key;
    inp.value = t[key] || ""; inp.placeholder = ph;
    f.appendChild(inp);
    grid.appendChild(f);
  });
  row.appendChild(grid);
  return row;
}

function circReadDraftFromDOM() {
  if (!_circDraft) return;
  _circDraft.nome = document.getElementById("circNome").value.trim();
  _circDraft.tipo = document.getElementById("circTipo").value;
  _circDraft.trechos = Array.from(document.querySelectorAll("#circTrechos .circ-trecho")).map((row) => {
    const itemId = row.querySelector(".circ-t-item").value;
    const papel = row.querySelector(".circ-t-papel").value;
    const attrs = {};
    row.querySelectorAll(".circ-t-attr").forEach((inp) => { attrs[inp.dataset.key] = inp.value.trim(); });
    return { itemId, papel, ...attrs };
  });
}

function saveCircuitoModal() {
  circReadDraftFromDOM();
  const candidate = { nome: _circDraft.nome, tipo: _circDraft.tipo, trechos: _circDraft.trechos };
  const v = validarCircuito(candidate);
  if (!v.ok) return toast(v.motivo, "error");
  if (_circDraft.id) {
    updateCircuito(_circDraft.id, candidate);
    toast("Circuito atualizado.");
  } else {
    createCircuito(candidate.nome, candidate.tipo, candidate.trechos);
    toast("Circuito criado.");
  }
  closeCircuitoModal();
  renderAll();
}

async function excluirCircuito(id) {
  const c = findCircuito(id);
  if (!c) return;
  const ok = await confirmarDialog(`Excluir o circuito "${c.nome}"?`, {
    titulo: "Excluir circuito", confirmText: "Excluir", danger: true,
  });
  if (!ok) return;
  deleteCircuito(id);
  toast("Circuito excluído.");
  renderAll();
}

function openCircMapModal(circId) {
  const c = findCircuito(circId);
  if (!c) return;
  _circMapCurrent = c;
  document.getElementById("cmCircNome").textContent = c.nome;
  document.getElementById("cmResumo").textContent =
    `${c.tipo} · ${c.trechos.length} trechos · ${c.trechos.map((t) => findItemById(t.itemId)?.nome || "—").join(" → ")}`;
  drawCircMap(c);
  document.getElementById("circMapModalBackdrop").classList.add("active");
}

function closeCircMapModal() {
  document.getElementById("circMapModalBackdrop").classList.remove("active");
}
