/* Rodadas locais de campo — cadastro + PDF espelhando prontuário SisPro */

import { loadJSON, saveJSON, uid, nowIso } from "./storage.js";
import { getSite } from "./sites.js";
import { getSession } from "./auth.js";
import { generateRodadaPDF } from "./pdf-rodada.js";
import { firebaseReady, pushRodadaToFirestore } from "./firebase-bridge.js";
import { isOnline } from "./sync.js";

const KEY_RODADAS = "sispro_mobile_rodadas";

async function loadRodadas() {
  return (await loadJSON(KEY_RODADAS, [])) || [];
}

async function saveRodadas(list) {
  await saveJSON(KEY_RODADAS, list || []);
}

export async function listRodadas(siteId = null) {
  const all = await loadRodadas();
  const filtered = siteId ? all.filter((r) => r.siteId === siteId) : all;
  return filtered.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

export async function getRodada(id) {
  const all = await loadRodadas();
  return all.find((r) => r.id === id) || null;
}

/**
 * Cria rodada local a partir do site (snapshot para PDF / sync).
 */
export async function createRodada(siteId, { observacoes = "", tipo = "Rodada local" } = {}) {
  const site = await getSite(siteId);
  if (!site) throw new Error("Site não encontrado.");
  const session = getSession();
  const now = nowIso();
  const rodada = {
    id: uid(),
    siteId: site.id,
    tipo,
    observacoes: String(observacoes || "").trim(),
    createdAt: now,
    updatedAt: now,
    syncStatus: "pending",
    tecnico: {
      uid: session?.uid || "",
      email: session?.email || "",
      nome: session?.nome || "Técnico",
    },
    siteSnapshot: {
      id: site.id,
      nome: site.nome,
      codigo: site.codigo,
      localInstalacao: site.localInstalacao || "",
      centroTrabalho: site.centroTrabalho || "",
      criticidade: site.criticidade || "Média",
      statusOperacional: site.statusOperacional || "Operacional",
      latitude: site.latitude || "",
      longitude: site.longitude || "",
      resumo: site.resumo || "",
      items: Array.isArray(site.items) ? site.items : [],
    },
  };
  const all = await loadRodadas();
  all.push(rodada);
  await saveRodadas(all);
  return rodada;
}

export async function exportRodadaPDF(rodadaId) {
  const rodada = await getRodada(rodadaId);
  if (!rodada) throw new Error("Rodada não encontrada.");
  await generateRodadaPDF(rodada);
  return rodada;
}

/** Cria rodada + gera PDF imediatamente (fluxo de teste). */
export async function rodadaRapidaPDF(siteId, observacoes = "") {
  const rodada = await createRodada(siteId, {
    observacoes,
    tipo: "Rodada local de teste",
  });
  await generateRodadaPDF(rodada);
  return rodada;
}

export async function syncRodada(rodadaId) {
  const rodada = await getRodada(rodadaId);
  if (!rodada) throw new Error("Rodada não encontrada.");
  if (!firebaseReady()) {
    throw new Error("Firebase não configurado — PDF local ok; sync requer apiKey.");
  }
  const online = await isOnline();
  if (!online) throw new Error("Sem rede para sincronizar a rodada.");
  await pushRodadaToFirestore(rodada);
  const all = await loadRodadas();
  const idx = all.findIndex((r) => r.id === rodadaId);
  if (idx >= 0) {
    all[idx].syncStatus = "synced";
    all[idx].syncedAt = nowIso();
    await saveRodadas(all);
  }
  return all[idx] || rodada;
}
