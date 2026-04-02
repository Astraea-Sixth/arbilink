import express from "express";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOG_PATH = join(__dirname, "..", "logs", "transactions.jsonl");
const PORT = 3099;

const app = express();

app.get("/api/transactions", (_req, res) => {
  if (!existsSync(LOG_PATH)) {
    res.json([]);
    return;
  }
  const lines = readFileSync(LOG_PATH, "utf-8").trim().split("\n").filter(Boolean);
  const txs = lines.map(line => {
    try { return JSON.parse(line) as Record<string, unknown>; }
    catch { return null; }
  }).filter(Boolean).reverse(); // newest first
  res.json(txs);
});

const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>ArbiLink Dashboard</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { background: #0a0a0a; color: #e0e0e0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, monospace; }
  .container { max-width: 1200px; margin: 0 auto; padding: 24px; }
  h1 { font-size: 24px; font-weight: 700; margin-bottom: 4px; }
  .subtitle { color: #888; font-size: 14px; margin-bottom: 24px; }
  .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin-bottom: 24px; }
  .card { background: #151515; border: 1px solid #222; border-radius: 8px; padding: 16px; }
  .card-label { font-size: 12px; color: #888; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 4px; }
  .card-value { font-size: 24px; font-weight: 700; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; font-size: 12px; color: #888; text-transform: uppercase; letter-spacing: 1px; padding: 8px 12px; border-bottom: 1px solid #222; }
  td { padding: 10px 12px; border-bottom: 1px solid #1a1a1a; font-size: 13px; }
  tr:hover { background: #151515; }
  .status-success { color: #22c55e; }
  .status-failed { color: #ef4444; }
  .status-blocked { color: #eab308; }
  a { color: #60a5fa; text-decoration: none; }
  a:hover { text-decoration: underline; }
  .empty { text-align: center; color: #555; padding: 48px; }
  .refresh-note { color: #555; font-size: 12px; margin-top: 16px; text-align: right; }
</style>
</head>
<body>
<div class="container">
  <h1>ArbiLink Dashboard</h1>
  <p class="subtitle">Arbitrum Agent Transaction History</p>
  <div class="cards">
    <div class="card"><div class="card-label">Total Transactions</div><div class="card-value" id="total">0</div></div>
    <div class="card"><div class="card-label">Success Rate</div><div class="card-value" id="rate">-</div></div>
    <div class="card"><div class="card-label">Total Gas (ETH)</div><div class="card-value" id="gas">0</div></div>
    <div class="card"><div class="card-label">Total Volume</div><div class="card-value" id="volume">0</div></div>
  </div>
  <table>
    <thead>
      <tr><th>Time</th><th>Type</th><th>Pair</th><th>Amount In</th><th>Amount Out</th><th>Gas (ETH)</th><th>Risk</th><th>Status</th><th>Tx</th></tr>
    </thead>
    <tbody id="tbody"></tbody>
  </table>
  <div class="empty" id="empty" style="display:none">No transactions yet. Execute a swap or register to see data here.</div>
  <p class="refresh-note">Auto-refreshes every 10 seconds</p>
</div>
<script>
function truncate(hash) {
  if (!hash) return "-";
  return hash.slice(0, 6) + "..." + hash.slice(-4);
}
function formatTime(ts) {
  if (!ts) return "-";
  var d = new Date(ts);
  return d.toLocaleString();
}
function statusHtml(s) {
  if (s === "success") return '<span class="status-success">\\u2705</span>';
  if (s === "failed") return '<span class="status-failed">\\u274C</span>';
  return '<span class="status-blocked">\\u26A0\\uFE0F</span>';
}
function render(txs) {
  var tbody = document.getElementById("tbody");
  var empty = document.getElementById("empty");
  if (!txs.length) { tbody.innerHTML = ""; empty.style.display = "block"; return; }
  empty.style.display = "none";

  var totalGas = 0, totalVol = 0, successes = 0;
  txs.forEach(function(t) {
    if (t.status === "success") successes++;
    if (t.gasEth) totalGas += parseFloat(t.gasEth) || 0;
    if (t.amountIn && t.type === "swap") totalVol += parseFloat(t.amountIn) || 0;
  });

  document.getElementById("total").textContent = txs.length;
  document.getElementById("rate").textContent = (txs.length > 0 ? ((successes / txs.length) * 100).toFixed(0) + "%" : "-");
  document.getElementById("gas").textContent = totalGas.toFixed(6);
  document.getElementById("volume").textContent = totalVol.toFixed(4);

  var html = "";
  txs.forEach(function(t) {
    var pair = (t.tokenIn && t.tokenOut) ? t.tokenIn + "/" + t.tokenOut : "-";
    var txLink = t.txHash ? '<a href="https://sepolia.arbiscan.io/tx/' + t.txHash + '" target="_blank">' + truncate(t.txHash) + '</a>' : "-";
    var risk = (t.riskScore !== null && t.riskScore !== undefined) ? t.riskScore + "/10" : "-";
    html += "<tr>"
      + "<td>" + formatTime(t.timestamp) + "</td>"
      + "<td>" + (t.type || "-") + "</td>"
      + "<td>" + pair + "</td>"
      + "<td>" + (t.amountIn || "-") + "</td>"
      + "<td>" + (t.amountOut || "-") + "</td>"
      + "<td>" + (t.gasEth || "-") + "</td>"
      + "<td>" + risk + "</td>"
      + "<td>" + statusHtml(t.status) + "</td>"
      + "<td>" + txLink + "</td>"
      + "</tr>";
  });
  tbody.innerHTML = html;
}
function load() {
  fetch("/api/transactions").then(function(r) { return r.json(); }).then(render).catch(function() {});
}
load();
setInterval(load, 10000);
</script>
</body>
</html>`;

app.get("/", (_req, res) => {
  res.send(DASHBOARD_HTML);
});

app.listen(PORT, () => {
  console.log(`ArbiLink Dashboard running at http://localhost:${PORT}`);
});
