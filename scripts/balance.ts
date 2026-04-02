import { ethers } from "ethers";
import { getNetwork, getDefaultWallet } from "../config/loadConfig.js";

// ── Config ──────────────────────────────────────────────────────────────────

const ERC20_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
];

// ── Arg parsing ─────────────────────────────────────────────────────────────

function parseArgs(): {
  address: string;
  token: string | null;
  network: string;
} {
  const args = process.argv.slice(2);
  let address = getDefaultWallet();
  let token: string | null = null;
  let network = "sepolia";

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--token" && args[i + 1]) {
      token = args[++i]!;
    } else if (arg === "--network" && args[i + 1]) {
      network = args[++i]!;
    } else if (!arg.startsWith("--")) {
      address = arg;
    }
  }

  return { address, token, network };
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const { address, token, network } = parseArgs();

  if (!ethers.isAddress(address)) {
    console.error(`Invalid address: ${address}`);
    process.exit(1);
  }

  if (token && !ethers.isAddress(token)) {
    console.error(`Invalid token address: ${token}`);
    process.exit(1);
  }

  const net = getNetwork(network);
  const provider = new ethers.JsonRpcProvider(net.rpc);

  if (token) {
    const contract = new ethers.Contract(token, ERC20_ABI, provider);
    const [rawBalance, decimals, symbol] = await Promise.all([
      contract.balanceOf(address) as Promise<bigint>,
      contract.decimals() as Promise<bigint>,
      contract.symbol() as Promise<string>,
    ]);
    const balance = ethers.formatUnits(rawBalance, decimals);
    console.log(
      `Address: ${address} | Network: ${net.name} | Token: ${symbol} | Balance: ${balance}`
    );
  } else {
    const rawBalance = await provider.getBalance(address);
    const balance = ethers.formatEther(rawBalance);
    console.log(
      `Address: ${address} | Network: ${net.name} | ETH: ${balance}`
    );
  }
}

main().catch((err: unknown) => {
  console.error("Error:", err instanceof Error ? err.message : err);
  process.exit(1);
});
