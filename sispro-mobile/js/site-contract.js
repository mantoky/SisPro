/** Contrato da raiz do site (espelho SisPro desktop). */

export const ROOT_CATEGORIA = "Raiz";
export const ROOT_TIPO = "Site Telecom";
export const PILOT_ORG_ID = "cfiservicos";

/** Garante prefixo "SITE " na raiz da hierarquia. */
export function withSitePrefix(nome) {
  const n = String(nome || "").trim();
  if (!n) return "SITE Site";
  return /^SITE\s+/i.test(n) ? n.replace(/^SITE\s+/i, "SITE ") : `SITE ${n}`;
}

/** Nome canônico do documento site (sem prefixo SITE). */
export function withoutSitePrefix(nome) {
  const n = String(nome || "").trim();
  return n.replace(/^SITE\s+/i, "").trim() || n;
}

/** True se o item é a raiz (parentId null). */
export function isRootItem(item) {
  return item != null && item.parentId === null;
}

/** Normaliza categoria/tipo de um item raiz legado. */
export function normalizeRootShape(root) {
  if (!root) return root;
  root.categoria = ROOT_CATEGORIA;
  root.tipo = ROOT_TIPO;
  root.nome = withSitePrefix(root.nome || "Site");
  return root;
}
