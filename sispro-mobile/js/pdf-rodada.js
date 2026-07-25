/**
 * PDF de rodada local — espelho do prontuário SisPro (report.js / gerarPDF).
 * Identidade: verde CFI #007a53, A4, texto selecionável.
 */

import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { Filesystem, Directory } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";

function safeName(s) {
  return String(s || "site")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w.-]+/g, "_")
    .slice(0, 60);
}

function fmtDate(iso) {
  try {
    return new Date(iso).toLocaleString("pt-BR");
  } catch {
    return iso || "—";
  }
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const dataUrl = String(reader.result || "");
      resolve(dataUrl.split(",")[1] || "");
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function savePdfBlob(doc, filename) {
  const blob = doc.output("blob");
  try {
    const base64 = await blobToBase64(blob);
    const written = await Filesystem.writeFile({
      path: filename,
      data: base64,
      directory: Directory.Cache,
    });
    await Share.share({
      title: "SisPro — Rodada",
      text: filename,
      url: written.uri,
      dialogTitle: "Compartilhar PDF da rodada",
    });
    return { ok: true, mode: "share" };
  } catch {
    doc.save(filename);
    return { ok: true, mode: "download" };
  }
}

/**
 * Gera PDF espelhando entrega futura do SisPro (prontuário de site / rodada).
 */
export async function generateRodadaPDF(rodada) {
  const site = rodada.siteSnapshot || {};
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const margin = 40;
  let y = margin;
  const green = [0, 122, 83];

  doc.setFillColor(...green);
  doc.rect(0, 0, doc.internal.pageSize.getWidth(), 56, "F");
  doc.setTextColor(255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text("SisPro — Prontuário / Rodada de Campo", margin, 28);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text("CFI Serviços · Espelho da entrega SisPro (teste local)", margin, 44);
  doc.setTextColor(0);
  y = 78;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text("Dados do site", margin, y);
  y += 16;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);

  const info = [
    `Nome: ${site.nome || "—"}`,
    `Código: ${site.codigo || "—"}`,
    `Local de Instalação: ${site.localInstalacao || "Não informado"}`,
    `Centro de Trabalho: ${site.centroTrabalho || "Não informado"}`,
    `Status operacional: ${site.statusOperacional || "Operacional"}`,
    `Criticidade: ${site.criticidade || "Média"}`,
    `Coordenadas: ${site.latitude || "—"}, ${site.longitude || "—"}`,
  ];
  info.forEach((l) => {
    doc.text(l, margin, y);
    y += 14;
  });
  y += 6;

  const resumo = doc.splitTextToSize(site.resumo || "Sem resumo cadastrado.", 515);
  doc.text(resumo, margin, y);
  y += resumo.length * 12 + 18;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text("Rodada de campo", margin, y);
  y += 14;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  const rodadaInfo = [
    `Tipo: ${rodada.tipo || "Rodada local"}`,
    `Data/hora: ${fmtDate(rodada.createdAt)}`,
    `Técnico: ${rodada.tecnico?.nome || "—"} (${rodada.tecnico?.email || "—"})`,
    `ID da rodada: ${rodada.id}`,
    `Status sync: ${rodada.syncStatus || "pending"}`,
  ];
  rodadaInfo.forEach((l) => {
    doc.text(l, margin, y);
    y += 14;
  });
  y += 8;

  const obs = doc.splitTextToSize(
    `Observações: ${rodada.observacoes || "Nenhuma observação registrada nesta rodada."}`,
    515
  );
  doc.text(obs, margin, y);
  y += obs.length * 12 + 16;

  const items = Array.isArray(site.items) ? site.items : [];
  const body = items.length
    ? items.map((it) => {
      const atr = Object.entries(it.atributos || {})
        .slice(0, 3)
        .map(([k, v]) => `${k}: ${v}`)
        .join("; ");
      const pad = it.parentId === null ? "" : "· ";
      return [
        pad + (it.nome || "—"),
        it.categoria || "—",
        it.tipo || "—",
        it.criticidade || "—",
        atr || "—",
      ];
    })
    : [[site.nome || "Site", "Site", "Raiz", site.criticidade || "Média", "sem ativos"]];

  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin },
    head: [["Ativo", "Categoria", "Tipo", "Criticidade", "Atributos"]],
    body,
    styles: { fontSize: 7.5, cellPadding: 3.5 },
    headStyles: { fillColor: green, textColor: 255 },
    alternateRowStyles: { fillColor: [242, 248, 245] },
  });

  let nextY = (doc.lastAutoTable?.finalY || y) + 20;
  if (nextY > doc.internal.pageSize.getHeight() - 120) {
    doc.addPage();
    nextY = 42;
  }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("Parecer da rodada (espelho SisPro)", margin, nextY);
  nextY += 14;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  const parecer = doc.splitTextToSize(
    "Documento gerado pelo SisPro Mobile para testes de rodada local. " +
      "O harness SisPro desktop consumirá estes dados via Firestore " +
      "(orgs/cfiservicos/sites e orgs/cfiservicos/rodadas) e emitirá o prontuário completo " +
      "com inventário, checklist e laudo técnico.",
    515
  );
  doc.text(parecer, margin, nextY);
  nextY += parecer.length * 11 + 28;

  doc.setDrawColor(...green);
  doc.setLineWidth(0.8);
  doc.line(margin, nextY, margin + 200, nextY);
  nextY += 12;
  doc.setFontSize(8);
  doc.setTextColor(100);
  doc.text("Assinatura do técnico / carimbo da rodada", margin, nextY);
  doc.text(`Gerado em ${fmtDate(new Date().toISOString())}`, margin, nextY + 14);

  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(150);
    doc.text(
      `SisPro Mobile · ${site.codigo || "—"} · pág. ${i}/${pages}`,
      margin,
      doc.internal.pageSize.getHeight() - 20
    );
  }

  const filename = `${safeName(site.codigo)}_rodada_${safeName(rodada.id).slice(0, 8)}.pdf`;
  return savePdfBlob(doc, filename);
}
