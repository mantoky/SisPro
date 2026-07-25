/**
 * HTTP ingest — SisPro / scripts → Postgres
 * POST /ingest  JSON telemetria ou backup
 * GET  /health
 */

import http from "http";
import { createPool, ingestPayload } from "./db.js";

const PORT = Number(process.env.PORT || 3080);
const TOKEN = process.env.INGEST_TOKEN || ""; // opcional no piloto
const pool = createPool();

function send(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Ingest-Token",
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8") || "{}";
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

function authorized(req) {
  if (!TOKEN) return true;
  const h = req.headers["x-ingest-token"] || req.headers.authorization || "";
  return h === TOKEN || h === `Bearer ${TOKEN}`;
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    send(res, 204, {});
    return;
  }

  if (req.method === "GET" && (req.url === "/health" || req.url === "/")) {
    try {
      await pool.query("SELECT 1");
      send(res, 200, { ok: true, service: "sispro-connector", db: true });
    } catch (e) {
      send(res, 503, { ok: false, db: false, error: e.message });
    }
    return;
  }

  if (req.method === "POST" && req.url === "/ingest") {
    if (!authorized(req)) {
      send(res, 401, { ok: false, error: "Token inválido." });
      return;
    }
    try {
      const body = await readBody(req);
      const result = await ingestPayload(pool, body);
      send(res, 200, { ok: true, ...result, message: "Sincronizado com Postgres/Grafana." });
    } catch (e) {
      send(res, 400, { ok: false, error: e.message || String(e) });
    }
    return;
  }

  send(res, 404, { ok: false, error: "Not found" });
});

server.listen(PORT, () => {
  console.log(`[sispro-connector] listening on :${PORT}`);
});
