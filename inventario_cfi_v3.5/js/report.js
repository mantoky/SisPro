/* ==========================================================================
   CFI Serviços — Inventário Inteligente de Sites Telecom
   report.js — Geração de relatório (texto, PDF, Excel) e backup/restore
   ==========================================================================
   NOVO (não existia no protótipo original):
   - gerarPDF(): documento real via jsPDF + jspdf-autotable (texto
     selecionável/pesquisável, paginação automática de tabelas).
   - exportExcel(): planilha .xlsx via SheetJS com abas Itens, Atributos,
     Dependências e Checklist.
   - importJSON(): restaura um backup exportado anteriormente.
   ========================================================================== */

/* ── Relatório textual na tela (mantido do protótipo, sem mudanças de lógica) ── */

function gerarRelatorio() {
  const site = activeSite();
  const metrics = calcularMetricasSite(site);
  const pend = activeItems()
    .map((item) => ({ item, resumo: resumirInspecaoItem(item) }))
    .filter(({ resumo }) => !["Conforme", "Não aplicável"].includes(resumo.status))
    .map(({ item, resumo }) => `${item.nome} [${resumo.status}]: ${resumo.pendencia}`);
  const linhas = [
    "PRONTUÁRIO / INVENTÁRIO TÉCNICO DO SITE",
    "Empresa desenvolvedora: CFI Serviços",
    "Projeto: Inventário Inteligente de Sites Telecom",
    "",
    `Site: ${site.nome}`,
    `Código: ${site.codigo}`,
    `Local de Instalação: ${site.localInstalacao || "Não informado"}`,
    `Centro de Trabalho: ${site.centroTrabalho || "Não informado"}`,
    `Status operacional: ${site.statusOperacional || "Operacional"}`,
    `Criticidade: ${site.criticidade}`,
    `Coordenadas: ${site.latitude}, ${site.longitude}`,
    "",
    "RESUMO:",
    site.resumo,
    "",
    `Total de itens cadastrados: ${metrics.itens}`,
    `Pendências de inspeção: ${metrics.pendencias}`,
    `Conformidade: ${metrics.conformidade}%`,
    "",
    "PRINCIPAIS PENDÊNCIAS:",
    ...(pend.length ? pend.map((p) => "- " + p) : ["- Nenhuma pendência não conforme registrada."]),
    "",
    "OBSERVAÇÃO:",
    "Relatório gerado pelo Inventário Inteligente de Sites Telecom — CFI Serviços.",
  ];
  reportPreview.value = linhas.join("\n");
  toast("Relatório técnico montado na tela.");
  showView("relatorios");
}

/* ── PDF real (texto selecionável, tabelas paginadas) ────────────────────── */

function gerarPDF() {
  if (typeof window.jspdf === "undefined") {
    toast("Biblioteca de PDF não carregada. Verifique sua conexão.", "error");
    return;
  }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const margin = 40;
  let y = margin;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text("Prontuário / Inventário Técnico do Site", margin, y);
  y += 18;
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(100);
  doc.text("CFI Serviços — Inventário Inteligente de Sites Telecom", margin, y);
  doc.setTextColor(0);
  y += 26;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text("Dados do site", margin, y);
  y += 16;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  const infoLinhas = [
    `Nome: ${activeSite().nome}`,
    `Código: ${activeSite().codigo}`,
    `Local de Instalação: ${activeSite().localInstalacao || "Não informado"}`,
    `Centro de Trabalho: ${activeSite().centroTrabalho || "Não informado"}`,
    `Status operacional: ${activeSite().statusOperacional || "Operacional"}`,
    `Criticidade: ${activeSite().criticidade}`,
    `Coordenadas: ${activeSite().latitude}, ${activeSite().longitude}`,
  ];
  infoLinhas.forEach((l) => { doc.text(l, margin, y); y += 14; });
  y += 6;
  const resumoQuebrado = doc.splitTextToSize(activeSite().resumo, 515);
  doc.text(resumoQuebrado, margin, y);
  y += resumoQuebrado.length * 12 + 16;

  // Tabela de inventário completo
  const head = [["Item", "Categoria", "Criticidade", "Status inspeção", "Pendência"]];
  const body = activeItems().map((item) => {
    const resumo = resumirInspecaoItem(item);
    return [item.nome, item.categoria, item.criticidade, resumo.status, resumo.pendencia];
  });

  doc.autoTable({
    head, body,
    startY: y,
    margin: { left: margin, right: margin },
    styles: { fontSize: 8, cellPadding: 4 },
    headStyles: { fillColor: [0, 122, 83], textColor: 255 },
    didDrawPage: (data) => {
      doc.setFontSize(8);
      doc.setTextColor(150);
      doc.text(
        `Página ${doc.internal.getNumberOfPages()}`,
        doc.internal.pageSize.getWidth() - margin - 40,
        doc.internal.pageSize.getHeight() - 20
      );
    },
  });

  let nextY = doc.lastAutoTable.finalY + 20;
  const atributos = [];
  activeItems().forEach((item) => Object.entries(item.atributos || {}).forEach(([key, value]) => atributos.push([item.nome, key, value])));
  nextY = appendProntuarioTable(doc, "Atributos técnicos", ["Item", "Atributo", "Valor"], atributos, nextY, margin);
  const dependencias = [];
  activeItems().forEach((item) => (item.dependencias || []).forEach((dep) => dependencias.push([item.nome, dep.tipo, depItemNome(dep)])));
  nextY = appendProntuarioTable(doc, "Relações e dependências", ["Item", "Relação", "Item relacionado"], dependencias, nextY, margin);
  const circuitos = [];
  siteCircuitos().forEach((c) => {
    (c.trechos || []).forEach((t, idx) => {
      const it = findItemById(t.itemId);
      circuitos.push([
        c.nome, c.tipo, String(idx + 1),
        `${it ? it.nome : "—"} (${t.papel})`,
        t.posicao || "—", t.disjuntor || "—",
        [t.bitola, t.fase, t.comprimento].filter(Boolean).join(" · ") || "—",
      ]);
    });
  });
  nextY = appendProntuarioTable(doc, "Circuitos físicos (endereçamento)", ["Circuito", "Tipo", "#", "Item (papel)", "Posição", "Disjuntor", "Bitola/Fase/Comp."], circuitos, nextY, margin);
  const checklist = [];
  activeItems().forEach((item) => {
    if (!(item.checklist || []).length) checklist.push([item.nome, "Checklist não configurado", "Pendente"]);
    else item.checklist.forEach((check) => checklist.push([item.nome, check.texto, check.status]));
  });
  appendProntuarioTable(doc, "Checklist de inspeção", ["Item", "Ponto de inspeção", "Status"], checklist, nextY, margin);

  const pdfName = `${safeExportName(activeSite().codigo)}_prontuario_cfi.pdf`;
  doc.save(pdfName);
  try {
    const pdfBlob = doc.output("blob");
    vaultWriteExportBlob(activeSite(), "03_laudos", pdfName, pdfBlob).then((ok) => {
      if (ok) toast("PDF também gravado no cofre (03_laudos).");
    });
  } catch { /* ignore */ }
  recordAudit("EXPORT", "report", activeSite().id, "Prontuário PDF completo gerado.");
  scheduleAutosave();
  toast("PDF gerado com sucesso.");
}

function appendProntuarioTable(doc, title, headers, rows, startY, margin) {
  let y = startY;
  if (y > doc.internal.pageSize.getHeight() - 110) {
    doc.addPage();
    y = 42;
  }
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(0);
  doc.text(title, margin, y);
  doc.autoTable({
    startY: y + 8,
    margin: { left: margin, right: margin, bottom: 32 },
    head: [headers],
    body: rows.length ? rows : [["Nenhum registro"]],
    styles: { fontSize: 7.5, cellPadding: 3.5, overflow: "linebreak" },
    headStyles: { fillColor: [0, 122, 83], textColor: 255 },
    alternateRowStyles: { fillColor: [242, 248, 245] },
  });
  return doc.lastAutoTable.finalY + 18;
}

/* ── Laudo Técnico (v3.4) ──────────────────────────────────────────────────
   Diferente do Prontuário (gerarPDF): este é um documento de PARECER,
   focado no resultado da inspeção (checklist), não no inventário inteiro.
   Inclui resumo quantitativo, não conformidades com recomendação por
   criticidade, parecer conclusivo automático e bloco de assinatura. */

function gerarLaudoTecnico() {
  if (typeof window.jspdf === "undefined") {
    toast("Biblioteca de PDF não carregada. Verifique sua conexão.", "error");
    return;
  }
  const itens = activeItems();
  const checks = itens.flatMap((i) => (i.checklist || []).map((c) => ({ ...c, item: i })));
  const conformes = checks.filter((c) => c.status === "Conforme");
  const naoConformes = checks.filter((c) => c.status === "Não conforme");
  const naoAplicaveis = checks.filter((c) => c.status === "Não aplicável");
  const naoInspecionados = checks.filter((c) => c.status === "Não inspecionado");
  const semChecklist = itens.filter((i) => !(i.checklist || []).length);
  const metrics = calcularMetricasSite(activeSite());
  const pctConformidade = metrics.conformidade;
  const temCriticaNaoConforme = naoConformes.some((c) => c.item.criticidade === "Crítica");

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const margin = 40;
  const largura = doc.internal.pageSize.getWidth() - margin * 2;
  let y;

  doc.setFillColor(0, 122, 83);
  doc.rect(0, 0, doc.internal.pageSize.getWidth(), 64, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(17);
  doc.text("LAUDO TÉCNICO DE INSPEÇÃO", margin, 32);
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.text("CFI Serviços — Inventário Inteligente de Sites Telecom", margin, 50);
  doc.setTextColor(0);
  y = 64 + 26;

  function titulo(texto) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.text(texto, margin, y);
    y += 16;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
  }
  function paragrafo(texto) {
    const linhas = doc.splitTextToSize(texto, largura);
    doc.text(linhas, margin, y);
    y += linhas.length * 13 + 10;
  }
  function garantirEspaco(altura) {
    if (y + altura > doc.internal.pageSize.getHeight() - 50) {
      doc.addPage();
      y = margin;
    }
  }
  function rodape() {
    doc.setFontSize(8);
    doc.setTextColor(150);
    doc.text(`Página ${doc.internal.getNumberOfPages()}`, doc.internal.pageSize.getWidth() - margin - 40, doc.internal.pageSize.getHeight() - 20);
    doc.setTextColor(0);
  }

  titulo("Identificação do site");
  [
    `Nome: ${activeSite().nome}`,
    `Código: ${activeSite().codigo}`,
    `Local de Instalação: ${activeSite().localInstalacao || "Não informado"}`,
    `Centro de Trabalho: ${activeSite().centroTrabalho || "Não informado"}`,
    `Status operacional: ${activeSite().statusOperacional || "Operacional"}`,
    `Criticidade declarada: ${activeSite().criticidade}`,
    `Coordenadas: ${activeSite().latitude}, ${activeSite().longitude}`,
    `Data da emissão: ${new Date().toLocaleDateString("pt-BR")}`,
  ].forEach((l) => { doc.text(l, margin, y); y += 14; });
  y += 10;

  titulo("1. Objetivo");
  paragrafo("Este laudo apresenta o resultado da inspeção técnica realizada sobre o inventário hierárquico do site, com base nos pontos de checklist cadastrados em cada item (Infrawork, Infraelétrica, Equipamentos e RF), visando subsidiar a tomada de decisão quanto à conformidade operacional da instalação.");

  titulo("2. Metodologia");
  paragrafo("A inspeção considera cada item cadastrado na árvore hierárquica do site e seus respectivos pontos de checklist, classificados como Conforme, Não conforme, Não aplicável ou Não inspecionado. O percentual de conformidade apresentado neste laudo desconsidera os pontos marcados como Não aplicável.");

  garantirEspaco(120);
  titulo("3. Resumo quantitativo");
  doc.autoTable({
    startY: y,
    margin: { left: margin, right: margin },
    head: [["Indicador", "Valor"]],
    body: [
      ["Itens inventariados", String(itens.length)],
      ["Pontos de checklist cadastrados", String(checks.length)],
      ["Conformes", String(conformes.length)],
      ["Não conformes", String(naoConformes.length)],
      ["Não aplicáveis", String(naoAplicaveis.length)],
      ["Não inspecionados", String(naoInspecionados.length)],
      ["Itens sem checklist", String(semChecklist.length)],
      ["Pendências totais", String(metrics.pendencias)],
      ["Conformidade (excl. Não aplicável)", pctConformidade + "%"],
    ],
    styles: { fontSize: 9, cellPadding: 4 },
    headStyles: { fillColor: [0, 122, 83], textColor: 255 },
    didDrawPage: rodape,
  });
  y = doc.lastAutoTable.finalY + 22;

  garantirEspaco(60);
  titulo("4. Não conformidades identificadas");
  if (!naoConformes.length) {
    paragrafo("Nenhuma não conformidade registrada na data desta emissão.");
  } else {
    doc.autoTable({
      startY: y,
      margin: { left: margin, right: margin },
      head: [["Item", "Categoria", "Criticidade", "Ponto de inspeção", "Recomendação"]],
      body: naoConformes.map((c) => [
        c.item.nome, c.item.categoria, c.item.criticidade, c.texto,
        c.item.criticidade === "Crítica" || c.item.criticidade === "Alta"
          ? "Ação corretiva imediata"
          : c.item.criticidade === "Média"
          ? "Ação corretiva programada"
          : "Monitoramento",
      ]),
      styles: { fontSize: 8, cellPadding: 4 },
      headStyles: { fillColor: [220, 38, 38], textColor: 255 },
      didDrawPage: rodape,
    });
    y = doc.lastAutoTable.finalY + 22;
  }

  garantirEspaco(90);
  titulo("5. Parecer técnico conclusivo");
  let parecer;
  if (!naoConformes.length && metrics.pendencias === 0) {
    parecer = "Com base nos pontos de checklist inspecionados, o site não apresenta não conformidades registradas na data desta emissão.";
  } else if (!naoConformes.length) {
    parecer = `Não há não conformidades registradas, porém restam ${metrics.pendencias} pendência(s) de inspeção, incluindo pontos não inspecionados ou itens sem checklist. O parecer conclusivo depende da conclusão dessas verificações.`;
  } else if (temCriticaNaoConforme) {
    parecer = `O site apresenta ${naoConformes.length} não conformidade(s), incluindo item(ns) de criticidade CRÍTICA. Recomenda-se intervenção prioritária antes da próxima janela de manutenção.`;
  } else {
    parecer = `O site apresenta ${naoConformes.length} não conformidade(s) de criticidade não crítica. Recomenda-se correção conforme cronograma de manutenção.`;
  }
  paragrafo(parecer);

  garantirEspaco(70);
  y += 16;
  doc.setDrawColor(180);
  doc.line(margin, y, margin + 220, y);
  doc.line(margin + 280, y, margin + 420, y);
  doc.setFontSize(9);
  doc.text("Responsável técnico", margin, y + 14);
  doc.text("Data", margin + 280, y + 14);

  doc.save(`${safeExportName(activeSite().codigo)}_laudo_tecnico_cfi.pdf`);
  recordAudit("EXPORT", "report", activeSite().id, "Laudo técnico de inspeção gerado.");
  scheduleAutosave();
  toast("Laudo técnico gerado com sucesso.");
}

/* ── Excel (.xlsx) com múltiplas abas ──────────────────────────────────── */

function exportExcel() {
  if (typeof XLSX === "undefined") {
    toast("Biblioteca de planilha não carregada. Verifique sua conexão.", "error");
    return;
  }

  const wb = XLSX.utils.book_new();

  // Aba 0 — "Leia-me (modelo)": documenta o CONTRATO da planilha, pra que
  // uma futura importação de arquivos com a mesma estrutura não tenha
  // ambiguidade nenhuma sobre o que cada coluna/valor significa.
  const leiaMe = [
    ["MODELO PADRÃO — Inventário CFI Serviços"],
    ["Esta planilha representa a estrutura completa e rastreável de um site, em 7 abas."],
    [],
    ["Aba", "Conteúdo", "Coluna-chave"],
    ["Dados do Site", "Identificação e situação operacional do site", "Código"],
    ["Itens", "Um item por linha, com referência ao seu pai (hierarquia)", "ID / Item pai (ID)"],
    ["Atributos", "Atributos livres de cada item (chave/valor)", "Item (nome)"],
    ["Dependências", "Relações entre itens (grafo de dependências)", "Item / Item relacionado"],
    ["Checklist", "Pontos de inspeção cadastrados em cada item", "Item"],
    ["Auditoria", "Histórico local das alterações realizadas", "Data/hora / Entidade"],
    [],
    ["REGRAS DESTE MODELO (compatibilidade com importação futura):"],
    ["- O ID de cada item deve ser um texto único dentro da aba Itens."],
    ["- 'Item pai (ID)' deve apontar para um ID existente na mesma aba, ou ficar em branco apenas na raiz do site."],
    ["- Criticidade aceita: Baixa, Média, Alta, Crítica."],
    ["- Status do Checklist aceita: Conforme, Não conforme, Não aplicável, Não inspecionado."],
    ["- Tipo de relação (Dependências) aceita: depende_de, alimenta, protege, suporta, monitora, impacta, conecta_com, refrigera, aterra."],
    ["- Nas abas Atributos/Dependências/Checklist, a coluna 'Item' referencia o item pelo NOME (deve ser único na aba Itens)."],
    [],
    [`Exportado de: ${activeSite().nome} (${activeSite().codigo}) em ${new Date().toLocaleString("pt-BR")}`],
  ];
  const wsLeiaMe = XLSX.utils.aoa_to_sheet(leiaMe);
  wsLeiaMe["!cols"] = [{ wch: 70 }];
  XLSX.utils.book_append_sheet(wb, wsLeiaMe, "Leia-me (modelo)");

  const dadosSite = [{
    Nome: activeSite().nome,
    Código: activeSite().codigo,
    "Local de Instalação": activeSite().localInstalacao || "",
    "Centro de Trabalho": activeSite().centroTrabalho || "",
    "Status operacional": activeSite().statusOperacional || "Operacional",
    Criticidade: activeSite().criticidade,
    Latitude: activeSite().latitude,
    Longitude: activeSite().longitude,
    Resumo: activeSite().resumo,
    "Atualizado em": activeSite().updatedAt || "",
  }];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(dadosSite), "Dados do Site");

  const itensRows = activeItems().map((i) => ({
    ID: i.id,
    "Item pai (ID)": i.parentId || "",
    Nome: i.nome,
    Categoria: i.categoria,
    Tipo: i.tipo,
    Criticidade: i.criticidade,
    Descrição: i.descricao,
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(itensRows), "Itens");

  const atribRows = [];
  activeItems().forEach((i) => {
    Object.entries(i.atributos || {}).forEach(([k, v]) => {
      atribRows.push({ Item: i.nome, Atributo: k, Valor: v });
    });
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(atribRows), "Atributos");

  const depRows = [];
  activeItems().forEach((i) => {
    (i.dependencias || []).forEach((d) => {
      depRows.push({ Item: i.nome, Relação: d.tipo, "Item relacionado": depItemNome(d), Quebrada: depIsBroken(d) ? "Sim" : "Não" });
    });
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(depRows), "Dependências");

  const circRows = [];
  siteCircuitos().forEach((c) => {
    (c.trechos || []).forEach((t, idx) => {
      const it = findItemById(t.itemId);
      circRows.push({
        Circuito: c.nome, Tipo: c.tipo, Ordem: idx + 1,
        Item: it ? it.nome : "—", Papel: t.papel,
        Posição: t.posicao, Disjuntor: t.disjuntor,
        Bitola: t.bitola, Fase: t.fase, Comprimento: t.comprimento,
        Observação: t.observacao,
      });
    });
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(circRows), "Circuitos");

  const checkRows = [];
  activeItems().forEach((i) => {
    (i.checklist || []).forEach((c) => {
      checkRows.push({ Item: i.nome, "Ponto de inspeção": c.texto, Status: c.status });
    });
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(checkRows), "Checklist");

  const auditRows = (state.meta?.auditLog || []).map((event) => ({
    "Data/hora": event.timestamp,
    Usuário: event.userName,
    Perfil: event.profile,
    Ação: event.action,
    Entidade: event.entityType,
    "ID da entidade": event.entityId,
    Detalhe: event.detail,
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(auditRows), "Auditoria");

  XLSX.writeFile(wb, `${safeExportName(activeSite().codigo)}_inventario_cfi.xlsx`);
  recordAudit("EXPORT", "report", activeSite().id, "Planilha Excel completa gerada.");
  scheduleAutosave();
  toast("Planilha Excel exportada (modelo padrão).");
}

/* ── Backup / restauração JSON ─────────────────────────────────────────── */

function exportJSON() {
  recordAudit("EXPORT", "backup", activeSite().id, "Backup JSON completo gerado.");
  state.meta.changesSinceBackup = 0;
  const fileName = `${safeExportName(activeSite().codigo)}_backup_inventario_cfi.json`;
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(a.href);
  saveToLocalStorage();
  vaultWriteExportBlob(activeSite(), "04_exports", fileName, blob).catch(() => {});
  vaultProvisionSite(activeSite()).catch(() => {});
  toast("Backup JSON exportado.");
}

function triggerImportJSON() {
  importJsonInput.click();
}

function importJSON(fileInput) {
  const file = fileInput.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      const parsed = JSON.parse(e.target.result);

      const novoEstado = prepararEstadoImportado(parsed);

      const ok = await confirmarDialog(
        `Backup validado: ${novoEstado.sites.length} site(s). A importação substituirá todos os dados atuais. Continuar?`,
        { titulo: "Importar backup", confirmText: "Importar", danger: true }
      );
      if (!ok) {
        fileInput.value = "";
        return;
      }

      state = novoEstado;
      setSelectedId(null);
      const raiz = activeItems().find((i) => i.parentId === null);
      root = raiz ? raiz.id : null;
      recordAudit("IMPORT", "backup", activeSite().id, `Backup restaurado com ${state.sites.length} site(s).`);
      saveToLocalStorage();
      itemDetails.classList.add("hidden");
      itemEmpty.classList.remove("hidden");
      toast("Backup importado com sucesso.");
      renderAll();
      sincronizarCamposSite();
    } catch (err) {
      toast(`Backup rejeitado: ${err.message || "arquivo inválido ou corrompido"}.`, "error");
    } finally {
      fileInput.value = "";
    }
  };
  reader.readAsText(file);
}

function safeExportName(value) {
  const safe = String(value || "site")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^[_\-.]+|[_\-.]+$/g, "")
    .slice(0, 80);
  return safe || "site";
}
