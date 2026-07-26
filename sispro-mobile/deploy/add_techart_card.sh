#!/usr/bin/env bash
# Insere o card SLOT 09 (SisPro Mobile PWA) no index do apex.
# Idempotente. Rodar na VPS como root.
set -euo pipefail

INDEX="${INDEX:-/var/www/techartsolucoes.com.br/html/index.html}"
[ -f "$INDEX" ] || { echo "ERRO: $INDEX nao encontrado"; exit 1; }

python3 - <<'PYEOF'
# -*- coding: utf-8 -*-
import io, time

INDEX = "/var/www/techartsolucoes.com.br/html/index.html"

with io.open(INDEX, "r", encoding="utf-8") as f:
    html = f.read()

if "sispro-app.techartsolucoes.com.br" in html or "SLOT 09" in html:
    print("Card SisPro / SLOT 09 ja existe - nada a fazer.")
    raise SystemExit(0)

bak = INDEX + ".bak." + str(int(time.time()))
with io.open(bak, "w", encoding="utf-8") as f:
    f.write(html)
print("Backup: " + bak)

card = u'''          <article class="app-card loadout-card reveal">
            <div class="loadout-hud-top">
              <span class="loadout-slot">SLOT 09</span>
              <span class="loadout-status loadout-status--active">ACTIVE</span>
            </div>
            <div class="app-card-top">
              <div class="app-icon app-icon--green">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 21V8l9-5 9 5v13"/><path d="M9 21V12h6v9"/><path d="M3 11h18"/></svg>
              </div>
              <div class="app-tags"><span class="tag">PWA</span><span class="tag">CFI</span><span class="tag">Firebase</span></div>
            </div>
            <h3>SisPro Mobile</h3>
            <p>Prontuário de sites em campo: hierarquia de ativos, rodadas PDF e sync Firestore com a plataforma SisPro — instalável no celular como app.</p>
            <div class="loadout-stats">
              <div class="loadout-stat">
                <span class="loadout-stat-label">SYNC</span>
                <div class="loadout-bar"><div class="loadout-bar-fill loadout-bar-fill--ok" style="--fill:100%"></div></div>
                <span class="loadout-stat-val">ON</span>
              </div>
              <div class="loadout-stat">
                <span class="loadout-stat-label">OFFLINE</span>
                <div class="loadout-bar"><div class="loadout-bar-fill loadout-bar-fill--ai" style="--fill:100%"></div></div>
                <span class="loadout-stat-val">OK</span>
              </div>
            </div>
            <footer class="app-card-foot">
              <span class="badge badge--on">Ativo</span>
              <a class="app-link" href="https://sispro-app.techartsolucoes.com.br/" target="_blank" rel="noopener noreferrer">DEPLOY <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 12h14M13 6l6 6-6 6"/></svg></a>
            </footer>
          </article>
'''

# Preferir inserir após Circuit Mapper (08); senão após Vale RF-Analyzer (07)
anchor = "Circuit Mapper" if "Circuit Mapper" in html else "Vale RF-Analyzer"
i = html.find(anchor)
if i == -1:
    print("ERRO: ancora de card nao encontrada")
    raise SystemExit(1)
j = html.find("</article>", i)
if j == -1:
    print("ERRO: </article> nao encontrado")
    raise SystemExit(1)
end = j + len("</article>")

new_html = html[:end] + "\n" + card + html[end:]
with io.open(INDEX, "w", encoding="utf-8") as f:
    f.write(new_html)

print("Card SLOT 09 SisPro Mobile inserido.")
PYEOF

grep -n "sispro-app.techartsolucoes.com.br" "$INDEX" | head -3
echo "OK — arquivo estatico do apex atualizado (sem reload nginx)."
