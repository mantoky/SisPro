/* Ativos do site — hierarquia pai/filho + atributos (espelho SisPro items[]) */

import { loadSites, saveSites, uid, nowIso } from "./storage.js";

export const CATEGORIAS_SUGERIDAS = [
  "Civil",
  "Estrutura Vertical",
  "Energia",
  "Energia AC",
  "Energia DC",
  "Shelter",
  "Climatização",
  "Transmissão",
  "Transmissão MW",
  "Fibra",
  "Rede IP",
  "LTE",
  "Sistema Irradiante",
  "Proteção",
  "Aterramento",
  "Proteção Elétrica",
  "Segurança em Altura",
  "Sinalização",
  "Elétrica",
  "Outro",
];

export const TIPOS_SUGERIDOS = [
  "Sistema",
  "Equipamento",
  "Quadro Geral",
  "Torre",
  "eNode-B",
  "RRU",
  "Antena setorial",
  "Retificador",
  "Bateria VRLA",
  "Gerador Diesel",
  "Transferência Automática",
  "Rádio Micro-ondas",
  "Switch industrial",
  "DIO",
  "SPDA",
  "Malha",
  "Abrigo climatizado",
  "Outro",
];

function ensureRoot(site) {
  if (!Array.isArray(site.items)) site.items = [];
  let root = site.items.find((i) => i.parentId === null);
  if (!root) {
    const rootId = site.rootItemId || uid();
    site.rootItemId = rootId;
    root = {
      id: rootId,
      parentId: null,
      nome: site.nome,
      categoria: "Site",
      tipo: "Raiz",
      criticidade: site.criticidade || "Média",
      descricao: site.resumo || "Raiz do site",
      atributos: {},
      dependencias: [],
      fotos: [],
      checklist: [],
      createdAt: site.createdAt || nowIso(),
      updatedAt: nowIso(),
    };
    site.items.push(root);
  } else {
    site.rootItemId = root.id;
  }
  return root;
}

async function withSite(siteId, mutator) {
  const sites = await loadSites();
  const site = sites.find((s) => s.id === siteId);
  if (!site) throw new Error("Site não encontrado.");
  ensureRoot(site);
  const result = await mutator(site);
  site.updatedAt = nowIso();
  site.syncStatus = "pending";
  await saveSites(sites);
  return result;
}

export async function listAssets(siteId) {
  const sites = await loadSites();
  const site = sites.find((s) => s.id === siteId);
  if (!site) return [];
  ensureRoot(site);
  await saveSites(sites);
  return site.items.slice();
}

export async function getAsset(siteId, itemId) {
  const items = await listAssets(siteId);
  return items.find((i) => i.id === itemId) || null;
}

export async function getRootAsset(siteId) {
  const items = await listAssets(siteId);
  return items.find((i) => i.parentId === null) || null;
}

/** Árvore ordenada para UI (profundidade). */
export async function listAssetsTree(siteId) {
  const items = await listAssets(siteId);
  const byParent = new Map();
  items.forEach((i) => {
    const key = i.parentId === null ? "__root__" : i.parentId;
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key).push(i);
  });
  byParent.forEach((arr) => arr.sort((a, b) => String(a.nome).localeCompare(String(b.nome), "pt-BR")));

  const out = [];
  function walk(parentKey, depth) {
    const list = byParent.get(parentKey) || [];
    list.forEach((node) => {
      out.push({ ...node, depth });
      walk(node.id, depth + 1);
    });
  }
  walk("__root__", 0);
  return out;
}

/** Opções de pai (exclui o próprio item e descendentes). */
export async function listParentOptions(siteId, excludeId = null) {
  const items = await listAssets(siteId);
  const blocked = new Set();
  if (excludeId) {
    blocked.add(excludeId);
    const stack = [excludeId];
    while (stack.length) {
      const id = stack.pop();
      items.filter((i) => i.parentId === id).forEach((c) => {
        blocked.add(c.id);
        stack.push(c.id);
      });
    }
  }
  return items
    .filter((i) => !blocked.has(i.id))
    .sort((a, b) => String(a.nome).localeCompare(String(b.nome), "pt-BR"));
}

function normalizeAttrs(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return Object.fromEntries(
    Object.entries(raw)
      .map(([k, v]) => [String(k).trim(), String(v ?? "").trim()])
      .filter(([k, v]) => k && v)
      .slice(0, 40)
  );
}

export async function upsertAsset(siteId, input) {
  return withSite(siteId, (site) => {
    const nome = String(input.nome || "").trim();
    if (!nome) throw new Error("Informe o nome do ativo.");

    const now = nowIso();
    const existing = input.id ? site.items.find((i) => i.id === input.id) : null;
    const editingRoot = Boolean(existing && existing.parentId === null);

    let parentId;
    if (editingRoot) {
      parentId = null;
    } else if (input.parentId === undefined || input.parentId === "" || input.parentId === null) {
      parentId = site.rootItemId;
    } else {
      parentId = input.parentId;
    }

    if (parentId !== null && !site.items.some((i) => i.id === parentId)) {
      throw new Error("Pai inválido.");
    }

    const payload = {
      nome,
      categoria: String(input.categoria || "Outro").trim() || "Outro",
      tipo: String(input.tipo || "Equipamento").trim() || "Equipamento",
      criticidade: input.criticidade || "Média",
      descricao: String(input.descricao || "").trim(),
      atributos: normalizeAttrs(input.atributos),
      parentId,
      updatedAt: now,
    };

    if (existing) {
      const idx = site.items.findIndex((i) => i.id === input.id);
      if (editingRoot) {
        site.items[idx] = {
          ...existing,
          ...payload,
          parentId: null,
          categoria: payload.categoria || "Site",
          tipo: payload.tipo || "Raiz",
        };
        site.nome = site.items[idx].nome;
      } else {
        if (payload.parentId === existing.id) throw new Error("Um ativo não pode ser pai de si mesmo.");
        site.items[idx] = { ...existing, ...payload };
      }
      return site.items[idx];
    }

    const item = {
      id: uid(),
      ...payload,
      dependencias: [],
      fotos: [],
      checklist: [
        { texto: "Item identificado", status: "Não inspecionado" },
        { texto: "Fotos registradas", status: "Não inspecionado" },
      ],
      createdAt: now,
    };
    site.items.push(item);
    return item;
  });
}

export async function deleteAsset(siteId, itemId) {
  return withSite(siteId, (site) => {
    const item = site.items.find((i) => i.id === itemId);
    if (!item) throw new Error("Ativo não encontrado.");
    if (item.parentId === null) throw new Error("A raiz do site não pode ser excluída.");
    const remove = new Set([itemId]);
    const stack = [itemId];
    while (stack.length) {
      const id = stack.pop();
      site.items.filter((i) => i.parentId === id).forEach((c) => {
        remove.add(c.id);
        stack.push(c.id);
      });
    }
    site.items = site.items.filter((i) => !remove.has(i.id));
    return true;
  });
}

export function countChildren(items, parentId) {
  return items.filter((i) => i.parentId === parentId).length;
}
