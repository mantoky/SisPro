/* CRUD de sites locais (sem mapa mental) */

import { loadSites, saveSites, uid, nowIso } from "./storage.js";

export async function listSites() {
  const sites = await loadSites();
  return sites.sort((a, b) => String(a.nome).localeCompare(String(b.nome), "pt-BR"));
}

export async function getSite(id) {
  const sites = await loadSites();
  return sites.find((s) => s.id === id) || null;
}

export async function upsertSite(input) {
  const sites = await loadSites();
  const codigo = String(input.codigo || "").trim();
  const nome = String(input.nome || "").trim();
  if (!nome) throw new Error("Informe o nome do site.");
  if (!codigo) throw new Error("Informe o código do site.");

  const dup = sites.find(
    (s) => s.id !== input.id && String(s.codigo).toLowerCase() === codigo.toLowerCase()
  );
  if (dup) throw new Error("Já existe um site local com este código.");

  const now = nowIso();
  if (input.id) {
    const idx = sites.findIndex((s) => s.id === input.id);
    if (idx === -1) throw new Error("Site não encontrado.");
    sites[idx] = {
      ...sites[idx],
      ...normalize(input),
      id: input.id,
      codigo,
      nome,
      updatedAt: now,
      syncStatus: "pending",
    };
    await saveSites(sites);
    return sites[idx];
  }

  const rootItemId = uid();
  const site = {
    id: uid(),
    rootItemId,
    ...normalize(input),
    codigo,
    nome,
    createdAt: now,
    updatedAt: now,
    syncStatus: "pending",
    prontuarioStatus: "em_campo",
    items: [
      {
        id: rootItemId,
        parentId: null,
        nome,
        categoria: "Site",
        tipo: "Raiz",
        criticidade: input.criticidade || "Média",
        descricao: String(input.resumo || "").trim() || "Raiz do site",
        atributos: {},
        dependencias: [],
        fotos: [],
        checklist: [],
        createdAt: now,
        updatedAt: now,
      },
    ],
  };
  sites.push(site);
  await saveSites(sites);
  return site;
}

export async function deleteSite(id) {
  const sites = await loadSites();
  const next = sites.filter((s) => s.id !== id);
  await saveSites(next);
  return next.length !== sites.length;
}

function normalize(input) {
  return {
    localInstalacao: String(input.localInstalacao || "").trim(),
    centroTrabalho: String(input.centroTrabalho || "").trim(),
    criticidade: input.criticidade || "Média",
    statusOperacional: input.statusOperacional || "Operacional",
    latitude: String(input.latitude || "").trim(),
    longitude: String(input.longitude || "").trim(),
    resumo: String(input.resumo || "").trim(),
  };
}
