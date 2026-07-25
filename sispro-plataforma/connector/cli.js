/**
 * CLI: node cli.js caminho/arquivo.json
 */

import fs from "fs";
import { createPool, ingestPayload } from "./db.js";

const file = process.argv[2];
if (!file) {
  console.error("Uso: node cli.js <arquivo.json>");
  process.exit(1);
}

const body = JSON.parse(fs.readFileSync(file, "utf8"));
const pool = createPool();

try {
  const result = await ingestPayload(pool, body);
  console.log(JSON.stringify({ ok: true, ...result }, null, 2));
  process.exit(0);
} catch (e) {
  console.error(e.message || e);
  process.exit(1);
} finally {
  await pool.end();
}
