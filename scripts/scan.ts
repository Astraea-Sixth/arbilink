import { ethers } from "ethers";
import { getNetwork } from "../config/loadConfig.js";

// ── ABI ─────────────────────────────────────────────────────────────────────

const ERC20_ABI = [
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
];

// ── Arg parsing ─────────────────────────────────────────────────────────────

function parseArgs(): { token: string; network: string } {
  const args = process.argv.slice(2);
  let token = "";
  let network = "one";

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--network" && args[i + 1]) {
      network = args[++i]!;
    } else if (!arg.startsWith("--")) {
      token = arg;
    }
  }

  if (!token) {
    console.error("Usage: npx tsx scripts/scan.ts 0xTOKEN_ADDRESS [--network one|sepolia]");
    process.exit(1);
  }

  if (!ethers.isAddress(token)) {
    console.error(`Invalid token address: ${token}`);
    process.exit(1);
  }

  return { token, network };
}

// ── Risk scoring ────────────────────────────────────────────────────────────

interface RiskDetail {
  score: number;
  passed: string[];
  warnings: string[];
  goplusRaw: Record<string, unknown> | null;
  dexLiquidity: number;
  dexVolume24h: number;
  dexPrice: number | null;
}

async function runFullScan(tokenAddress: string): Promise<RiskDetail> {
  const passed: string[] = [];
  const warnings: string[] = [];
  let score = 0;
  let goplusRaw: Record<string, unknown> | null = null;
  let dexLiquidity = 0;
  let dexVolume24h = 0;
  let dexPrice: number | null = null;

  // GoPlus Security API (chain 42161 = Arbitrum One)
  try {
    const res = await fetch(
      `https://api.gopluslabs.io/api/v1/token_security/42161?contract_addresses=${tokenAddress}`
    );
    const json = (await res.json()) as {
      result?: Record<string, Record<string, unknown>>;
    };
    goplusRaw = json.result?.[tokenAddress.toLowerCase()] ?? null;
  } catch {
    warnings.push("Could not fetch GoPlus security data");
  }

  // DEXScreener
  try {
    const res = await fetch(
      `https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`
    );
    const json = (await res.json()) as {
      pairs?: Array<{
        liquidity?: { usd?: number };
        volume?: { h24?: number };
        priceUsd?: string;
      }>;
    };
    if (json.pairs && json.pairs.length > 0) {
      for (const pair of json.pairs) {
        const liq = pair.liquidity?.usd ?? 0;
        if (liq > dexLiquidity) {
          dexLiquidity = liq;
          dexVolume24h = pair.volume?.h24 ?? 0;
          if (pair.priceUsd) dexPrice = parseFloat(pair.priceUsd);
        }
      }
    }
  } catch {
    warnings.push("Could not fetch DEXScreener data");
  }

  if (goplusRaw) {
    // Honeypot
    if (goplusRaw.is_honeypot !== "1") {
      score += 2;
      passed.push("Not a honeypot");
    } else {
      warnings.push("HONEYPOT — cannot sell after buying");
    }

    // Buy tax
    const buyTax = parseFloat(String(goplusRaw.buy_tax ?? "0"));
    if (!isNaN(buyTax) && buyTax < 0.05) {
      score += 1;
      passed.push(`Buy tax: ${(buyTax * 100).toFixed(1)}%`);
    } else {
      warnings.push(`High buy tax: ${(buyTax * 100).toFixed(1)}%`);
    }

    // Sell tax
    const sellTax = parseFloat(String(goplusRaw.sell_tax ?? "0"));
    if (!isNaN(sellTax) && sellTax < 0.05) {
      score += 1;
      passed.push(`Sell tax: ${(sellTax * 100).toFixed(1)}%`);
    } else {
      warnings.push(`High sell tax: ${(sellTax * 100).toFixed(1)}%`);
    }

    // Open source
    if (goplusRaw.is_open_source === "1") {
      score += 1;
      passed.push("Contract is verified / open source");
    } else {
      warnings.push("Contract is NOT verified");
    }

    // LP locked
    const lpHolders = goplusRaw.lp_holders as
      | Array<{ is_locked?: number }>
      | undefined;
    if (lpHolders && lpHolders.some((h) => h.is_locked === 1)) {
      score += 1;
      passed.push("LP is locked");
    } else {
      warnings.push("LP not locked — dev can drain anytime");
    }

    // Creator percent
    const creatorPercent = parseFloat(
      String(goplusRaw.creator_percent ?? "0")
    );
    if (!isNaN(creatorPercent) && creatorPercent < 0.05) {
      score += 1;
      passed.push(`Creator holds ${(creatorPercent * 100).toFixed(1)}%`);
    } else {
      warnings.push(
        `Creator holds ${(creatorPercent * 100).toFixed(1)}% of supply`
      );
    }

    // Other risks
    if (
      !goplusRaw.other_potential_risks ||
      String(goplusRaw.other_potential_risks) === ""
    ) {
      score += 1;
      passed.push("No other potential risks flagged");
    } else {
      warnings.push(`Other risks: ${String(goplusRaw.other_potential_risks)}`);
    }

    // Holder count
    const holderCount = parseInt(
      String(goplusRaw.holder_count ?? "0"),
      10
    );
    if (!isNaN(holderCount) && holderCount > 1000) {
      score += 1;
      passed.push(`Holder count: ${holderCount.toLocaleString()}`);
    } else {
      warnings.push(`Low holder count: ${holderCount.toLocaleString()}`);
    }
  }

  // DEXScreener liquidity
  if (dexLiquidity > 50000) {
    score += 1;
    passed.push(`DEX liquidity: $${dexLiquidity.toLocaleString()}`);
  } else {
    warnings.push(`Low DEX liquidity: $${dexLiquidity.toLocaleString()}`);
  }

  return { score, passed, warnings, goplusRaw, dexLiquidity, dexVolume24h, dexPrice };
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const { token, network } = parseArgs();
  const net = getNetwork(network);
  const provider = new ethers.JsonRpcProvider(net.rpc);

  // Fetch on-chain token info
  let tokenName = "Unknown";
  let tokenSymbol = "???";
  let tokenDecimals = 18;
  let totalSupply = "N/A";

  try {
    const contract = new ethers.Contract(token, ERC20_ABI, provider);
    const [name, symbol, decimals, supply] = await Promise.all([
      contract.name() as Promise<string>,
      contract.symbol() as Promise<string>,
      contract.decimals() as Promise<bigint>,
      contract.totalSupply() as Promise<bigint>,
    ]);
    tokenName = name;
    tokenSymbol = symbol;
    tokenDecimals = Number(decimals);
    totalSupply = parseFloat(
      ethers.formatUnits(supply, tokenDecimals)
    ).toLocaleString("en-US", { maximumFractionDigits: 0 });
  } catch {
    console.warn("Could not read token contract — may not be a standard ERC20.");
  }

  // Run risk scan
  const result = await runFullScan(token);

  // Verdict
  let verdict: string;
  let verdictEmoji: string;
  let explanation: string;
  if (result.score >= 8) {
    verdict = "SAFE";
    verdictEmoji = "✅";
    explanation = "Token passes most security checks. Standard risk profile.";
  } else if (result.score >= 5) {
    verdict = "CAUTION";
    verdictEmoji = "⚠️";
    explanation = "Some risk factors detected. Review warnings before investing.";
  } else {
    verdict = "DANGER";
    verdictEmoji = "🔴";
    explanation = "High-risk token. Multiple red flags detected. Proceed with extreme caution.";
  }

  // Print report
  console.log("");
  console.log("━".repeat(56));
  console.log(` TOKEN SCAN — ${tokenSymbol}`);
  console.log("━".repeat(56));
  console.log(` Name:         ${tokenName} (${tokenSymbol})`);
  console.log(` Address:      ${token}`);
  console.log(` Network:      ${net.name}`);
  console.log(` Total supply: ${totalSupply}`);
  if (result.dexPrice !== null) {
    console.log(` Price:        $${result.dexPrice.toFixed(6)}`);
  }
  if (result.dexLiquidity > 0) {
    console.log(` Liquidity:    $${result.dexLiquidity.toLocaleString()}`);
  }
  if (result.dexVolume24h > 0) {
    console.log(` 24h volume:   $${result.dexVolume24h.toLocaleString()}`);
  }
  console.log("");
  console.log(` Risk Score:   ${result.score}/10  ${verdictEmoji} ${verdict}`);
  console.log("");

  if (result.passed.length > 0) {
    console.log(" Passed:");
    for (const s of result.passed) console.log(`   ✅ ${s}`);
  }
  if (result.warnings.length > 0) {
    console.log(" Warnings:");
    for (const w of result.warnings) console.log(`   ❌ ${w}`);
  }

  console.log("");
  console.log(` Verdict:      ${verdictEmoji} ${verdict} — ${explanation}`);
  console.log(` Explorer:     ${net.explorer}/token/${token}`);
  console.log("━".repeat(56));
}

main().catch((err: unknown) => {
  console.error("Error:", err instanceof Error ? err.message : err);
  process.exit(1);
});
