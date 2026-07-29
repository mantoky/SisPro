import { describe, expect, it, vi } from "vitest";

vi.mock("@capacitor/network", () => ({
  Network: { getStatus: async () => ({ connected: true }) },
}));

vi.mock("@capacitor/preferences", () => ({
  Preferences: {
    get: async () => ({ value: null }),
    set: async () => {},
    remove: async () => {},
  },
}));

import {
  ROOT_CATEGORIA,
  ROOT_TIPO,
  withSitePrefix,
  withoutSitePrefix,
  normalizeRootShape,
  PILOT_ORG_ID,
} from "./site-contract.js";
import { toDesktopSitePayload } from "./sync.js";
import { mapFirestoreError } from "./firebase-bridge.js";

describe("site-contract", () => {
  it("withSitePrefix / withoutSitePrefix mantêm nome canônico", () => {
    expect(withSitePrefix("Alpha")).toBe("SITE Alpha");
    expect(withSitePrefix("SITE Alpha")).toBe("SITE Alpha");
    expect(withSitePrefix("site Alpha")).toBe("SITE Alpha");
    expect(withoutSitePrefix("SITE Alpha")).toBe("Alpha");
    expect(withoutSitePrefix("Alpha")).toBe("Alpha");
  });

  it("normalizeRootShape corrige legado Site/Raiz", () => {
    const root = { parentId: null, nome: "Torre X", categoria: "Site", tipo: "Raiz" };
    normalizeRootShape(root);
    expect(root.categoria).toBe(ROOT_CATEGORIA);
    expect(root.tipo).toBe(ROOT_TIPO);
    expect(root.nome).toBe("SITE Torre X");
  });

  it("ORG piloto está fixa", () => {
    expect(PILOT_ORG_ID).toBe("cfiservicos");
  });
});

describe("toDesktopSitePayload", () => {
  it("cria raiz no contrato desktop quando items vazios", () => {
    const payload = toDesktopSitePayload(
      {
        id: "s1",
        nome: "Campo Norte",
        codigo: "CN-01",
        localInstalacao: "Patio",
        centroTrabalho: "CT1",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      { uid: "u1", email: "tec@cfi.com" }
    );
    const root = payload.items.find((i) => i.parentId === null);
    expect(root).toBeTruthy();
    expect(root.categoria).toBe("Raiz");
    expect(root.tipo).toBe("Site Telecom");
    expect(root.nome).toBe("SITE Campo Norte");
    expect(payload.nome).toBe("Campo Norte");
    expect(root.atributos.tecnico).toBe("tec@cfi.com");
  });

  it("normaliza raiz legada no payload", () => {
    const payload = toDesktopSitePayload(
      {
        id: "s2",
        nome: "Beta",
        codigo: "B-2",
        rootItemId: "r1",
        items: [
          {
            id: "r1",
            parentId: null,
            nome: "Beta",
            categoria: "Site",
            tipo: "Raiz",
            atributos: {},
          },
        ],
      },
      { email: "a@b.c" }
    );
    const root = payload.items[0];
    expect(root.categoria).toBe("Raiz");
    expect(root.tipo).toBe("Site Telecom");
    expect(root.nome).toBe("SITE Beta");
  });
});

describe("mapFirestoreError", () => {
  it("explica sync parcial", () => {
    const err = Object.assign(new Error("boom"), { partialOk: ["a", "b"] });
    const msg = mapFirestoreError(err);
    expect(msg).toMatch(/parcial|já gravado/i);
    expect(msg).toMatch(/2/);
  });
});
