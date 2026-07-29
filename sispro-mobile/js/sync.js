/* Sync SisPro — fila local → payload compatível com desktop (sites[]) */

import { Network } from "@capacitor/network";
import { loadSites, saveSites, nowIso } from "./storage.js";
import { getSession, isFirebaseConfigured, canSyncToPlatform, syncBlockReason } from "./auth.js";
import { pushSitesToFirestore, mapFirestoreError } from "./firebase-bridge.js";
import { ROOT_CATEGORIA, ROOT_TIPO, withSitePrefix } from "./site-contract.js";

export async function getPendingSites() {
  const sites = await loadSites();
  return sites.filter((s) => s.syncStatus !== "synced");
}

export async function markForSync(siteId) {
  const sites = await loadSites();
  const s = sites.find((x) => x.id === siteId);
  if (!s) return false;
  s.syncStatus = "pending";
  s.updatedAt = nowIso();
  await saveSites(sites);
  return true;
}

export async function isOnline() {
  try {
    const st = await Network.getStatus();
    return !!st.connected;
  } catch {
    return navigator.onLine !== false;
  }
}

/**
 * Empacota sites no formato próximo do harness desktop (site + raiz item).
 * Quando Firestore estiver ligado, este payload é o documento a upsert.
 */
export function toDesktopSitePayload(mobileSite, session) {
  const rootId = mobileSite.rootItemId || ("root-" + mobileSite.id);
  let items = Array.isArray(mobileSite.items) ? mobileSite.items.slice() : [];
  if (!items.length || !items.some((i) => i.parentId === null)) {
    items = [
      {
        id: rootId,
        parentId: null,
        nome: withSitePrefix(mobileSite.nome),
        categoria: ROOT_CATEGORIA,
        tipo: ROOT_TIPO,
        criticidade: mobileSite.criticidade || "Média",
        descricao: mobileSite.resumo || "Raiz criada pelo SisPro Mobile",
        atributos: {
          "Local de Instalação": mobileSite.localInstalacao || "",
          "Centro de Trabalho": mobileSite.centroTrabalho || "",
        },
        dependencias: [],
        fotos: [],
        checklist: [],
        createdAt: mobileSite.createdAt,
        updatedAt: mobileSite.updatedAt || nowIso(),
      },
    ];
  }
  items = items.map((i) => ({
    id: i.id,
    parentId: i.parentId === undefined ? null : i.parentId,
    nome: i.nome,
    categoria: i.categoria || "Outro",
    tipo: i.tipo || "Equipamento",
    criticidade: i.criticidade || "Média",
    descricao: i.descricao || "",
    atributos: i.atributos && typeof i.atributos === "object" ? i.atributos : {},
    dependencias: Array.isArray(i.dependencias) ? i.dependencias : [],
    fotos: Array.isArray(i.fotos) ? i.fotos : [],
    checklist: Array.isArray(i.checklist) ? i.checklist : [],
    createdAt: i.createdAt || mobileSite.createdAt,
    updatedAt: i.updatedAt || nowIso(),
  }));
  // marca origem no root
  const root = items.find((i) => i.parentId === null);
  if (root) {
    root.categoria = ROOT_CATEGORIA;
    root.tipo = ROOT_TIPO;
    root.nome = withSitePrefix(root.nome || mobileSite.nome);
    root.atributos = {
      ...root.atributos,
      origem: "sispro-mobile",
      tecnico: session?.email || root.atributos?.tecnico || "",
      "Local de Instalação":
        root.atributos?.["Local de Instalação"] || mobileSite.localInstalacao || "",
      "Centro de Trabalho":
        root.atributos?.["Centro de Trabalho"] || mobileSite.centroTrabalho || "",
    };
  }

  return {
    id: mobileSite.id,
    nome: mobileSite.nome,
    codigo: mobileSite.codigo,
    criticidade: mobileSite.criticidade || "Média",
    latitude: mobileSite.latitude || "",
    longitude: mobileSite.longitude || "",
    resumo: mobileSite.resumo || "",
    localInstalacao: mobileSite.localInstalacao || "",
    centroTrabalho: mobileSite.centroTrabalho || "",
    statusOperacional: mobileSite.statusOperacional || "Operacional",
    prontuarioStatus: mobileSite.prontuarioStatus || "em_campo",
    createdAt: mobileSite.createdAt,
    updatedAt: mobileSite.updatedAt || nowIso(),
    selectedItemId: root?.id || rootId,
    focusItemId: null,
    circuitos: Array.isArray(mobileSite.circuitos) ? mobileSite.circuitos : [],
    links: Array.isArray(mobileSite.links) ? mobileSite.links : [],
    items,
    metaMobile: {
      deviceUid: session?.uid || "",
      syncedAt: nowIso(),
      itensCount: items.length,
      envelope: "sispro-mobile-v1",
    },
  };
}

/** Marca site como enviado para revisão do gestor e enfileira sync. */
export async function enviarParaRevisao(siteId) {
  const sites = await loadSites();
  const s = sites.find((x) => x.id === siteId);
  if (!s) throw new Error("Site não encontrado.");
  if (s.prontuarioStatus === "concluido") {
    throw new Error("Prontuário já concluído na plataforma. Aguarde devolução do gestor.");
  }
  s.prontuarioStatus = "enviado_pelo_tecnico";
  s.syncStatus = "pending";
  s.updatedAt = nowIso();
  await saveSites(sites);
  return runSync();
}

async function markSitesSynced(siteIds) {
  if (!siteIds?.length) return;
  const sites = await loadSites();
  const now = nowIso();
  const idSet = new Set(siteIds);
  for (const s of sites) {
    if (idSet.has(s.id)) {
      s.syncStatus = "synced";
      s.lastSyncAttempt = now;
      s.syncedAt = now;
    }
  }
  await saveSites(sites);
}

/**
 * Executa sync:
 * 1) monta fila pending
 * 2) se Firebase ok + online → envia
 * 3) senão → gera bundle local e marca como "queued"
 */
export async function runSync() {
  const session = getSession();
  if (!session) throw new Error("Faça login para sincronizar.");

  const pending = await getPendingSites();
  if (!pending.length) {
    return { ok: true, enviados: 0, mensagem: "Nada pendente para sincronizar." };
  }

  const online = await isOnline();
  const bundle = pending.map((s) => toDesktopSitePayload(s, session));

  if (isFirebaseConfigured() && online) {
    if (!canSyncToPlatform()) {
      return {
        ok: false,
        enviados: 0,
        mensagem: syncBlockReason() || "Não é possível sincronizar com a plataforma.",
        bundle,
      };
    }
    try {
      const result = await pushSitesToFirestore(bundle);
      await markSitesSynced(pending.map((p) => p.id));
      return {
        ok: true,
        enviados: result.enviados ?? pending.length,
        mensagem: `${pending.length} site(s) sincronizado(s) com o SisPro (Firestore).`,
        bundle,
      };
    } catch (err) {
      const partialIds = Array.isArray(err?.partialOk) ? err.partialOk : [];
      if (partialIds.length) {
        await markSitesSynced(partialIds);
      }
      return {
        ok: false,
        enviados: partialIds.length,
        mensagem: mapFirestoreError(err),
        bundle,
        partialOk: partialIds,
      };
    }
  }

  // Modo campo: grava fila exportável e marca sites
  const sites = await loadSites();
  const now = nowIso();
  for (const p of pending) {
    const s = sites.find((x) => x.id === p.id);
    if (s) {
      s.syncStatus = online ? "queued" : "pending";
      s.lastSyncAttempt = now;
    }
  }
  await saveSites(sites);

  try {
    localStorage.setItem("sispro_mobile_last_sync_bundle", JSON.stringify({
      exportedAt: now,
      device: session.uid,
      sites: bundle,
    }));
  } catch { /* quota */ }

  return {
    ok: true,
    enviados: pending.length,
    mensagem: online
      ? `${pending.length} site(s) enfileirado(s). Cole a apiKey em js/firebase-config.js para publicar no Firestore.`
      : `${pending.length} site(s) mantido(s) pendente(s) — sem rede.`,
    bundle,
  };
}
