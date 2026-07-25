/**
 * SisPro Connector — ingest de telemetria no Postgres (fonte do Grafana)
 */

import pg from "pg";

const { Pool } = pg;

export function createPool() {
  return new Pool({
    connectionString:
      process.env.DATABASE_URL ||
      "postgresql://sispro:sispro_piloto@localhost:5432/sispro",
  });
}

function depthOf(items, itemId, cache = new Map()) {
  if (cache.has(itemId)) return cache.get(itemId);
  const item = items.find((i) => i.id === itemId);
  if (!item || item.parentId == null) {
    cache.set(itemId, 0);
    return 0;
  }
  const d = 1 + depthOf(items, item.parentId, cache);
  cache.set(itemId, d);
  return d;
}

function normalizeEnvelope(body) {
  // Formatos aceitos:
  // 1) site-telemetry.v1 { schemaVersion, orgId, regionId, site, assets }
  // 2) batch { orgId, regionId, sites: [ {site, assets} | siteComItems ] }
  // 3) backup SisPro { sites: [...], meta }
  if (!body || typeof body !== "object") throw new Error("JSON inválido.");

  const orgId = body.orgId || body.org_id || "cfiservicos";
  const regionId = body.regionId || body.region_id || "local";
  const regionNome = body.regionNome || body.region_nome || "Ambiente local";
  const regionCodigo = body.regionCodigo || body.region_codigo || "LOCAL";

  let entries = [];

  if (body.site && (body.assets || body.site.items)) {
    entries.push({
      site: body.site,
      assets: body.assets || body.site.items || [],
    });
  } else if (Array.isArray(body.sites)) {
    for (const s of body.sites) {
      if (s.site) {
        entries.push({ site: s.site, assets: s.assets || s.site.items || [] });
      } else {
        entries.push({ site: s, assets: s.items || s.assets || [] });
      }
    }
  } else {
    throw new Error("Payload sem site(s). Use telemetria v1 ou backup SisPro.");
  }

  return { orgId, regionId, regionNome, regionCodigo, entries };
}

export async function ingestPayload(pool, body) {
  const { orgId, regionId, regionNome, regionCodigo, entries } = normalizeEnvelope(body);
  const client = await pool.connect();
  const result = { orgId, regionId, sites: 0, assets: 0 };

  try {
    await client.query("BEGIN");

    await client.query(
      `INSERT INTO orgs (org_id, nome) VALUES ($1, $2)
       ON CONFLICT (org_id) DO UPDATE SET nome = EXCLUDED.nome`,
      [orgId, orgId === "cfiservicos" ? "CFI Serviços" : orgId]
    );

    await client.query(
      `INSERT INTO regions (region_id, org_id, nome, codigo)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (org_id, region_id) DO UPDATE
         SET nome = EXCLUDED.nome, codigo = EXCLUDED.codigo`,
      [regionId, orgId, regionNome, regionCodigo]
    );

    for (const entry of entries) {
      const s = entry.site;
      const siteId = s.id || s.site_id;
      const codigo = s.codigo;
      const nome = s.nome;
      if (!siteId || !codigo || !nome) {
        throw new Error("Site sem id/codigo/nome.");
      }

      const items = Array.isArray(entry.assets) ? entry.assets : [];
      const itensCount = items.length || Number(s.itensCount || s.itens_count || 0) || 0;

      // Se outro site_id já usa o mesmo codigo na org, remove o antigo (cópia/reimport)
      await client.query(
        `DELETE FROM sites WHERE org_id = $1 AND codigo = $2 AND site_id <> $3`,
        [orgId, codigo, siteId]
      );

      await client.query(
        `INSERT INTO sites (
           site_id, org_id, region_id, codigo, nome, criticidade,
           status_operacional, prontuario_status, local_instalacao, centro_trabalho,
           latitude, longitude, itens_count, updated_at
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13, now()
         )
         ON CONFLICT (site_id) DO UPDATE SET
           org_id = EXCLUDED.org_id,
           region_id = EXCLUDED.region_id,
           codigo = EXCLUDED.codigo,
           nome = EXCLUDED.nome,
           criticidade = EXCLUDED.criticidade,
           status_operacional = EXCLUDED.status_operacional,
           prontuario_status = EXCLUDED.prontuario_status,
           local_instalacao = EXCLUDED.local_instalacao,
           centro_trabalho = EXCLUDED.centro_trabalho,
           latitude = EXCLUDED.latitude,
           longitude = EXCLUDED.longitude,
           itens_count = EXCLUDED.itens_count,
           updated_at = now()`,
        [
          siteId,
          orgId,
          regionId,
          codigo,
          nome,
          s.criticidade || null,
          s.statusOperacional || s.status_operacional || null,
          s.prontuarioStatus || s.prontuario_status || "rascunho",
          s.localInstalacao || s.local_instalacao || null,
          s.centroTrabalho || s.centro_trabalho || null,
          s.latitude || null,
          s.longitude || null,
          itensCount,
        ]
      );
      result.sites += 1;

      await client.query(`DELETE FROM assets WHERE site_id = $1`, [siteId]);

      const depthCache = new Map();
      for (const a of items) {
        const assetId = a.id || a.asset_id;
        if (!assetId || !a.nome) continue;
        const depth =
          typeof a.depth === "number" ? a.depth : depthOf(items, assetId, depthCache);
        await client.query(
          `INSERT INTO assets (
             asset_id, site_id, org_id, region_id, parent_id,
             nome, categoria, tipo, criticidade, depth, updated_at
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, now())
           ON CONFLICT (asset_id) DO UPDATE SET
             site_id = EXCLUDED.site_id,
             org_id = EXCLUDED.org_id,
             region_id = EXCLUDED.region_id,
             parent_id = EXCLUDED.parent_id,
             nome = EXCLUDED.nome,
             categoria = EXCLUDED.categoria,
             tipo = EXCLUDED.tipo,
             criticidade = EXCLUDED.criticidade,
             depth = EXCLUDED.depth,
             updated_at = now()`,
          [
            assetId,
            siteId,
            orgId,
            regionId,
            a.parentId === undefined ? a.parent_id ?? null : a.parentId,
            a.nome,
            a.categoria || null,
            a.tipo || null,
            a.criticidade || null,
            depth,
          ]
        );
        result.assets += 1;
      }
    }

    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
