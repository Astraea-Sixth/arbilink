import { ethers } from "ethers";
import { appendFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOG_PATH = join(__dirname, "..", "logs", "transactions.jsonl");

function logTransaction(entry: Record<string, unknown>): void {
  mkdirSync(dirname(LOG_PATH), { recursive: true });
  appendFileSync(LOG_PATH, JSON.stringify({ timestamp: new Date().toISOString(), ...entry }) + "\n");
}

// ── Arg parsing ─────────────────────────────────────────────────────────────

function parseArgs(): { token: string; interval: number; threshold: number } {
  const args = process.argv.slice(2);
  let token = "";
  let interval = 60;
  let threshold = 5;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--token" && args[i + 1]) {
      token = args[++i]!;
    } else if (arg === "--interval" && args[i + 1]) {
      interval = parseInt(args[++i]!, 10);
    } else if (arg === "--threshold" && args[i + 1]) {
      threshold = parseInt(args[++i]!, 10);
    }
  }

  if (!token) {
    console.error("Usage: npx tsx scripts/watch.ts --token 0x... [--interval 60] [--threshold 5]");
    process.exit(1);
  }

  if (!ethers.isAddress(token)) {
    console.error(`Invalid token address: ${token}`);
    process.exit(1);
  }

  return { token, interval, threshold };
}

// ── Risk check (same as swap.ts) ────────────────────────────────────────────

interface RiskResult {
  score: number;
  checks: Record<string, string>;
}

async function runRiskCheck(tokenAddress: string): Promise<RiskResult> {
  const checks: Record<string, string> = {};
  let score = 0;

  let goplusData: Record<string, unknown> | null = null;
  try {
    const gpRes = await fetch(`https://api.gopluslabs.io/api/v1/token_security/42161?contract_addresses=${tokenAddress}`);
    const gpJson = await gpRes.json() as { result?: Record<string, Record<string, unknown>> };
    const key = tokenAddress.toLowerCase();
    goplusData = gpJson.result?.[key] ?? null;
  } catch {
    checks["api"] = "fetch-failed";
    return { score: 0, checks };
  }

  if (!goplusData) {
    checks["api"] = "no-data";
    return { score: 0, checks };
  }

  // Honeypot
  const isHoneypot = String(goplusData.is_honeypot ?? "0");
  checks["is_honeypot"] = isHoneypot;
  if (isHoneypot !== "1") score += 2;

  // Buy tax
  const buyTax = String(goplusData.buy_tax ?? "0");
  checks["buy_tax"] = buyTax;
  if (parseFloat(buyTax) < 0.05) score += 1;

  // Sell tax
  const sellTax = String(goplusData.sell_tax ?? "0");
  checks["sell_tax"] = sellTax;
  if (parseFloat(sellTax) < 0.05) score += 1;

  // Open source
  const isOpenSource = String(goplusData.is_open_source ?? "0");
  checks["is_open_source"] = isOpenSource;
  if (isOpenSource === "1") score += 1;

  // LP locked
  const lpHolders = goplusData.lp_holders as Array<{ is_locked?: number }> | undefined;
  const lpLocked = lpHolders?.some(h => h.is_locked === 1) ? "1" : "0";
  checks["lp_locked"] = lpLocked;
  if (lpLocked === "1") score += 1;

  // Creator percent
  const creatorPercent = String(goplusData.creator_percent ?? "0");
  checks["creator_percent"] = creatorPercent;
  if (parseFloat(creatorPercent) < 0.05) score += 1;

  // Other risks
  const otherRisks = String(goplusData.other_potential_risks ?? "");
  checks["other_potential_risks"] = otherRisks;
  if (!otherRisks) score += 1;

  // Holder count
  const holderCount = String(goplusData.holder_count ?? "0");
  checks["holder_count"] = holderCount;
  if (parseInt(holderCount, 10) > 1000) score += 1;

  return { score, checks };
}

function statusLabel(score: number): string {
  if (score >= 8) return "SAFE";
  if (score >= 5) return "CAUTION";
  return "DANGER";
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const { token, interval, threshold } = parseArgs();
  const shortAddr = token.slice(0, 6) + "..." + token.slice(-4);

  console.log(`Watching ${shortAddr} every ${interval}s (threshold: ${threshold}/10)`);
  console.log("Press Ctrl+C to stop.\n");

  let prevResult: RiskResult | null = null;

  const poll = async (): Promise<void> => {
    try {
      const result = await runRiskCheck(token);
      const time = new Date().toLocaleTimeString("en-US", { hour12: false });
      const label = statusLabel(result.score);

      console.log(`[${time}] ${shortAddr} — Score: ${result.score}/10 ${label}`);

      // Check threshold
      if (result.score < threshold) {
        const msg = `ALERT: Score ${result.score}/10 below threshold ${threshold}`;
        console.log(`  ⚠️  ${msg}`);
        logTransaction({
          type: "watch-alert",
          token,
          score: result.score,
          threshold,
          reason: "below-threshold",
          checks: result.checks,
        });
      }

      // Check individual changes
      if (prevResult) {
        for (const [key, val] of Object.entries(result.checks)) {
          const prev = prevResult.checks[key];
          if (prev !== undefined && prev !== val) {
            const msg = `${key} changed: ${prev} → ${val}`;
            console.log(`  🔄 ${msg}`);
            logTransaction({
              type: "watch-alert",
              token,
              score: result.score,
              reason: "check-changed",
              field: key,
              oldValue: prev,
              newValue: val,
            });
          }
        }
      }

      prevResult = result;
    } catch (err: unknown) {
      const time = new Date().toLocaleTimeString("en-US", { hour12: false });
      console.error(`[${time}] Error polling: ${err instanceof Error ? err.message : err}`);
    }
  };

  // Initial poll
  await poll();

  // Schedule recurring polls
  setInterval(() => {
    poll().catch(() => {});
  }, interval * 1000);
}

main().catch((err: unknown) => {
  console.error("Error:", err instanceof Error ? err.message : err);
  process.exit(1);
});
