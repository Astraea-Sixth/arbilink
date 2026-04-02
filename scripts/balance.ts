import { ethers } from "ethers";

// ── Config ──────────────────────────────────────────────────────────────────

const NETWORKS = {
  sepolia: {
    name: "Arbitrum Sepolia",
    rpc: "https://sepolia-rollup.arbitrum.io/rpc",
  },
  one: {
    name: "Arbitrum One",
    rpc: "https://arb1.arbitrum.io/rpc",
  },
} as const;

const DEFAULT_ADDRESS = "0xa6b18B26717bBd10A3Ae828052C8CA35Ef5EcB8b";

const ERC20_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
];

// ── Arg parsing ─────────────────────────────────────────────────────────────

function parseArgs(): {
  address: string;
  token: string | null;
  network: keyof typeof NETWORKS;
} {
  const args = process.argv.slice(2);
  let address = DEFAULT_ADDRESS;
  let token: string | null = null;
  let network: keyof typeof NETWORKS = "sepolia";

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--token" && args[i + 1]) {
      token = args[++i]!;
    } else if (arg === "--network" && args[i + 1]) {
      const val = args[++i]!;
      if (val !== "sepolia" && val !== "one") {
        console.error(`Invalid network: ${val}. Use "sepolia" or "one".`);
        process.exit(1);
      }
      network = val;
    } else if (!arg.startsWith("--")) {
      address = arg;
    }
  }

  return { address, token, network };
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const { address, token, network } = parseArgs();
  const net = NETWORKS[network];
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
