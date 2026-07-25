/* F0.5 — Testes da lógica pura do state.js (Vitest + jsdom).
 * Cobertura: criaDependenciaCiclo, calcularMetricasSite, validarIntegridadeSite,
 * validarCircuito, normalizarTrechos. Sem depender de DOM/toast. */
import { describe, it, expect } from "vitest";

const C = globalThis.__cfi;

function item(id, parentId = null, extra = {}) {
  return {
    id,
    parentId,
    nome: extra.nome ?? id.toUpperCase(),
    categoria: extra.categoria ?? "Cat",
    tipo: extra.tipo ?? "Tipo",
    criticidade: extra.criticidade ?? "Média",
    descricao: extra.descricao ?? "",
    atributos: extra.atributos ?? {},
    dependencias: extra.dependencias ?? [],
    fotos: extra.fotos ?? [],
    checklist: extra.checklist ?? [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("calcularMetricasSite", () => {
  it("conta pendências e conformidade do checklist", () => {
    const site = {
      items: [
        item("root", null, { checklist: [] }), // sem checklist → 1 pendência
        item("a", "root", { checklist: [{ texto: "ok", status: "Conforme" }] }),
        item("b", "root", { checklist: [{ texto: "x", status: "Não conforme" }, { texto: "y", status: "Não aplicável" }] }),
      ],
    };
    const m = C.calcularMetricasSite(site);
    expect(m.itens).toBe(3);
    // root: base+1, pend+1 | a: base+1, conf+1 | b: base+1 (N/A não conta), pend+1
    expect(m.base).toBe(3);
    expect(m.conformes).toBe(1);
    expect(m.pendencias).toBe(2);
    expect(m.conformidade).toBe(33);
  });

  it("retorna conformidade 0 quando não há base", () => {
    const m = C.calcularMetricasSite({ items: [] });
    expect(m.conformidade).toBe(0);
    expect(m.itens).toBe(0);
  });
});

describe("criaDependenciaCiclo", () => {
  it("detecta ciclo ao adicionar aresta que fecha o loop", () => {
    // a → root (a depende de root)
    C.montar([
      item("root", null),
      item("a", "root", { dependencias: [{ tipo: "depende_de", itemId: "root" }] }),
    ]);
    // adicionar root → a fecharia o ciclo (a já aponta p/ root)
    expect(C.criaDependenciaCiclo("root", "a")).toBe(true);
    // adicionar a → root não cria ciclo (root não depende de ninguém)
    expect(C.criaDependenciaCiclo("a", "root")).toBe(false);
  });

  it("auto-relação é ciclo", () => {
    C.montar([item("root", null), item("a", "root")]);
    expect(C.criaDependenciaCiclo("a", "a")).toBe(true);
  });
});

describe("validarIntegridadeSite", () => {
  const validItems = () => [
    item("root", null, { nome: "Site", categoria: "Site" }),
    item("a", "root", { dependencias: [{ tipo: "depende_de", itemId: "root" }] }),
  ];
  const validSite = () => ({ codigo: "TESTE", items: validItems() });

  it("aceita um site válido sem lançar", () => {
    expect(() => C.validarIntegridadeSite(validSite())).not.toThrow();
  });

  it("rejeita mais de uma raiz", () => {
    const s = validSite();
    s.items[1].parentId = null;
    expect(() => C.validarIntegridadeSite(s)).toThrow(/raiz/i);
  });

  it("rejeita item órfão (parentId inexistente)", () => {
    const s = validSite();
    s.items.push(item("z", "inexistente"));
    expect(() => C.validarIntegridadeSite(s)).toThrow(/órfão/i);
  });

  it("rejeita status de checklist inválido", () => {
    const s = validSite();
    s.items[1].checklist = [{ texto: "ok", status: "Talvez" }];
    expect(() => C.validarIntegridadeSite(s)).toThrow(/checklist/i);
  });

  it("rejeita exceder o teto de itens", () => {
    const s = validSite();
    s.items = new Array(5001).fill(0).map((_, i) => item(`i${i}`, "root"));
    s.items.unshift(item("root", null));
    expect(() => C.validarIntegridadeSite(s)).toThrow(/teto/i);
  });
});

describe("Circuitos — validarCircuito e normalizarTrechos", () => {
  it("normalizarTrechos descarta trechos com itemId inexistente", () => {
    C.montar([item("root", null), item("q", "root", { nome: "Quadro" }), item("at", "root", { nome: "Ativo" })]);
    const out = C.normalizarTrechos([
      { itemId: "q", papel: "quadro", posicao: "QD-01" },
      { itemId: "inexistente", papel: "cabo" },
      { itemId: "at", papel: "ativo" },
    ]);
    expect(out).toHaveLength(2);
    expect(out[0].itemId).toBe("q");
    expect(out[1].itemId).toBe("at");
  });

  it("validarCircuito exige ao menos 2 trechos", () => {
    C.montar([item("root", null), item("q", "root"), item("at", "root")]);
    const um = { nome: "C", tipo: "alimentacao", trechos: [{ itemId: "q", papel: "quadro" }] };
    expect(C.validarCircuito(um).ok).toBe(false);
  });

  it("validarCircuito rejeita nome vazio e nó repetido", () => {
    C.montar([item("root", null), item("q", "root"), item("at", "root")]);
    expect(C.validarCircuito({ nome: "", trechos: [{ itemId: "q" }, { itemId: "at" }] }).ok).toBe(false);
    expect(C.validarCircuito({ nome: "C", trechos: [{ itemId: "q" }, { itemId: "q" }] }).ok).toBe(false);
  });

  it("validarCircuito aceita caminho simples válido", () => {
    C.montar([item("root", null), item("q", "root"), item("dj", "root"), item("at", "root")]);
    const c = { nome: "Alim BBU-01", tipo: "alimentacao", trechos: [
      { itemId: "q", papel: "quadro" }, { itemId: "dj", papel: "dj" }, { itemId: "at", papel: "ativo" },
    ] };
    expect(C.validarCircuito(c).ok).toBe(true);
  });
});
