import { ethers } from "ethers";
import { getNetwork, getDefaultWallet } from "../config/loadConfig.js";

// ── Arg parsing ─────────────────────────────────────────────────────────────

function parseArgs(): { address: string; limit: number; network: string } {
  const args = process.argv.slice(2);
  let address = "";
  let limit = 10;
  let network = "one";

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--address" && args[i + 1]) {
      address = args[++i]!;
    } else if (arg === "--limit" && args[i + 1]) {
      limit = parseInt(args[++i]!, 10);
    } else if (arg === "--network" && args[i + 1]) {
      network = args[++i]!;
    }
  }

  if (!address) {
    address = getDefaultWallet();
  }

  if (!ethers.isAddress(address)) {
    console.error(`Invalid address: ${address}`);
    process.exit(1);
  }

  return { address, limit, network };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function truncAddr(addr: string): string {
  return addr.slice(0, 6) + "..." + addr.slice(-4);
}

function formatTimestamp(ts: string): string {
  const date = new Date(parseInt(ts, 10) * 1000);
  return date.toISOString().replace("T", " ").slice(0, 19);
}

// ── Main ────────────────────────────────────────────────────────────────────

interface ArbiscanTx {
  timeStamp: string;
  from: string;
  to: string;
  value: string;
  isError: string;
  hash: string;
}

async function main(): Promise<void> {
  const { address, limit, network } = parseArgs();
  const net = getNetwork(network);

  // Etherscan V2 unified API (requires API key; Arbiscan V1 is deprecated)
  const chainId = network === "one" ? "42161" : "421614";
  const apiKey = process.env.ARBISCAN_API_KEY || "";

  if (!apiKey) {
    console.error("ARBISCAN_API_KEY not set. The Arbiscan V1 API is deprecated; V2 requires an API key.");
    console.error("Get a free key at https://arbiscan.io/myapikey and add ARBISCAN_API_KEY to .env");
    process.exit(1);
  }

  const url = `https://api.etherscan.io/v2/api?chainid=${chainId}&module=account&action=txlist&address=${address}&startblock=0&endblock=99999999&page=1&offset=${limit}&sort=desc&apikey=${apiKey}`;

  console.log(`\nTransaction history for ${truncAddr(address)} on ${net.name}`);
  console.log("━".repeat(90));

  const res = await fetch(url);
  const json = await res.json() as { status: string; message: string; result: ArbiscanTx[] | string };

  if (json.status !== "1" || !Array.isArray(json.result)) {
    console.error(`Arbiscan API error: ${json.message}`);
    if (typeof json.result === "string") console.error(json.result);
    process.exit(1);
  }

  const txs = json.result;

  if (txs.length === 0) {
    console.log("  No transactions found.");
    console.log("━".repeat(90));
    return;
  }

  // Print table header
  const colW = { time: 21, from: 14, to: 14, value: 18, status: 6 };
  console.log(
    `  ${"Timestamp".padEnd(colW.time)}${"From".padEnd(colW.from)}${"To".padEnd(colW.to)}${"Value (ETH)".padStart(colW.value)}${"Status".padStart(colW.status)}`
  );
  console.log("  " + "─".repeat(colW.time + colW.from + colW.to + colW.value + colW.status));

  for (const tx of txs) {
    const time = formatTimestamp(tx.timeStamp);
    const from = truncAddr(tx.from);
    const to = tx.to ? truncAddr(tx.to) : "Contract Create";
    const value = parseFloat(ethers.formatEther(tx.value)).toFixed(6);
    const status = tx.isError === "0" ? "✅" : "❌";

    console.log(
      `  ${time.padEnd(colW.time)}${from.padEnd(colW.from)}${to.padEnd(colW.to)}${value.padStart(colW.value)}${status.padStart(colW.status)}`
    );
  }

  console.log("━".repeat(90));
}

main().catch((err: unknown) => {
  console.error("Error:", err instanceof Error ? err.message : err);
  process.exit(1);
});
