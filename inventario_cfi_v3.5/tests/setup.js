/* F0.5 — Setup do Vitest.
 *
 * O app é feito de scripts clássicos (globals, sem ES modules). Para testar a
 * lógica pura SEM migrar a arquitetura (isso é Fase 1), carregamos js/state.js
 * no contexto global via vm e expomos as funções puras + um setter para o
 * `state` lexical (que é um `let` no topo de state.js, não uma propriedade de
 * globalThis, daí o setter). */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import vm from "node:vm";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const code =
  readFileSync(path.resolve(__dirname, "..", "js", "state.js"), "utf8") +
  // Ponte: expõe funções puras e um par get/set para o `state` lexical.
  "\n;globalThis.__cfi = {\n" +
  "  criaDependenciaCiclo, validarCircuito, normalizarTrechos, findItemById,\n" +
  "  activeItems, activeSite, calcularMetricasSite, validarIntegridadeSite,\n" +
  "  addDependencyDirect, moveItemParent\n" +
  "};\n" +
  ";globalThis.__cfi.set = (s) => { state = s; };\n" +
  ";globalThis.__cfi.get = () => state;\n";

vm.runInThisContext(code, { filename: "state.js" });

/* Helper de teste: monta um state mínimo in-place (muta o `state` lexical que
 * as funções de state.js enxergam). Retorna o site ativo. */
globalThis.__cfi.montar = function (items, extra = {}) {
  const site = {
    id: "s1",
    nome: "Site Teste",
    codigo: "TESTE",
    items,
    circuitos: extra.circuitos || [],
    selectedItemId: null,
    focusItemId: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
  globalThis.__cfi.set({
    activeSiteId: "s1",
    sites: [site],
    meta: { auditLog: [], changesSinceBackup: 0 },
  });
  return site;
};
