/* ==========================================================================
   CFI Serviços — Inventário Inteligente de Sites Telecom
   validation.js — Validação de formulários
   ========================================================================== */

/** Marca/desmarca um campo com erro visual, mostrando mensagem se houver. */
function setFieldError(inputEl, mensagem) {
  const field = inputEl.closest(".field");
  if (!field) return;
  let errorEl = field.querySelector(".field-error");
  if (!errorEl) {
    errorEl = document.createElement("div");
    errorEl.className = "field-error";
    field.appendChild(errorEl);
  }
  if (mensagem) {
    field.classList.add("has-error");
    errorEl.textContent = mensagem;
  } else {
    field.classList.remove("has-error");
    errorEl.textContent = "";
  }
}

function clearFieldError(inputEl) {
  setFieldError(inputEl, null);
}

/** Latitude válida: número entre -90 e 90. */
function validarLatitude(valor) {
  const n = Number(valor);
  if (valor.trim() === "" || Number.isNaN(n)) return "Informe um número válido.";
  if (n < -90 || n > 90) return "Latitude deve estar entre -90 e 90.";
  return null;
}

/** Longitude válida: número entre -180 e 180. */
function validarLongitude(valor) {
  const n = Number(valor);
  if (valor.trim() === "" || Number.isNaN(n)) return "Informe um número válido.";
  if (n < -180 || n > 180) return "Longitude deve estar entre -180 e 180.";
  return null;
}

function validarObrigatorio(valor, label) {
  if (!valor || !valor.trim()) return `${label} é obrigatório.`;
  return null;
}

/** Código duplicado entre sites é risco real: ele nomeia o arquivo em
 *  TODO export (PDF, Excel, JSON, mapa mental) — dois sites com o mesmo
 *  código sobrescrevem o arquivo um do outro na pasta de downloads. */
function validarCodigoUnico(valor, siteIdAtual) {
  if (codigoJaExiste(valor, siteIdAtual)) {
    return "Já existe outro site com este código. Use um código exclusivo.";
  }
  return null;
}

function validarFormatoCodigo(valor) {
  if (!/^[A-Za-z0-9._-]+$/.test(String(valor || "").trim())) {
    return "Use apenas letras, números, ponto, hífen ou sublinhado.";
  }
  return null;
}

/**
 * Valida o formulário de dados do site.
 * Retorna true se válido; caso contrário, marca os campos com erro e retorna false.
 */
function validarFormSite() {
  let ok = true;

  const nomeErr = validarObrigatorio(siteNome.value, "Nome do site");
  setFieldError(siteNome, nomeErr);
  if (nomeErr) ok = false;

  const codigoErr = validarObrigatorio(siteCodigo.value, "Código") || validarFormatoCodigo(siteCodigo.value) || validarCodigoUnico(siteCodigo.value, activeSite()?.id);
  setFieldError(siteCodigo, codigoErr);
  if (codigoErr) ok = false;

  const localErr = validarObrigatorio(siteLocalInstalacao.value, "Local de Instalação");
  setFieldError(siteLocalInstalacao, localErr);
  if (localErr) ok = false;

  const latErr = validarLatitude(siteLat.value);
  setFieldError(siteLat, latErr);
  if (latErr) ok = false;

  const lngErr = validarLongitude(siteLng.value);
  setFieldError(siteLng, lngErr);
  if (lngErr) ok = false;

  return ok;
}

/** Valida o formulário de novo item (modal). */
function validarFormNovoItem() {
  let ok = true;

  const nomeErr = validarObrigatorio(newNome.value, "Nome");
  setFieldError(newNome, nomeErr);
  if (nomeErr) ok = false;

  const catErr = validarObrigatorio(newCategoria.value, "Categoria");
  setFieldError(newCategoria, catErr);
  if (catErr) ok = false;

  return ok;
}
