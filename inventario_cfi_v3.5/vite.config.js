/// <reference types="vitest" />
import { defineConfig } from "vite";

/* F0.1b — Vite como dev server + build estático reproduzível para deploy na VPS.
 *
 * O app ainda usa scripts clássicos (js/*.js carregados por index.html), então
 * a MINIFICAÇÃO real exige a migração para ES modules (Fase 1, achado #5 da
 * auditoria). Por enquanto o `vite build` copia o site estático para dist/ —
 * já útil como artefato de deploy reproduzível (e o `vite` dev server dá HMR
 * de CSS/HTML durante o desenvolvimento).
 *
 * `base: "./"` usa caminhos relativos, para o build funcionar seja servido na
 * raiz da VPS ou num subpath. */
export default defineConfig({
  root: ".",
  base: "./",
  server: { port: 5173, open: true },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setup.js"],
    globals: true,
  },
});
