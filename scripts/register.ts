import "dotenv/config";
import { ethers } from "ethers";

// ── Config ──────────────────────────────────────────────────────────────────

const RPC_URL = "https://sepolia-rollup.arbitrum.io/rpc";
const PRIVATE_KEY = process.env.PRIVATE_KEY || "";
const REGISTRY_ADDRESS = "0x8004A818BFB912233c491871b3d84c89A494BD9e";

const REGISTER_ABI = [
  "function register(string name, string metadata)",
];

const REGISTER_AGENT_ABI = [
  "function registerAgent(string name, string metadata)",
];

const CHECK_ABI = [
  "function isRegistered(address agent) view returns (bool)",
];

// ── Arg parsing ─────────────────────────────────────────────────────────────

interface RegisterArgs {
  name: string;
  metadata: string;
  check: boolean;
}

function parseArgs(): RegisterArgs {
  const args = process.argv.slice(2);
  let name = "ArbiLink Agent";
  let metadata = "OpenClaw Arbitrum Skill";
  let check = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--name" && args[i + 1]) {
      name = args[++i]!;
    } else if (arg === "--metadata" && args[i + 1]) {
      metadata = args[++i]!;
    } else if (arg === "--check") {
      check = true;
    }
  }

  return { name, metadata, check };
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const { name, metadata, check } = parseArgs();
  if (!PRIVATE_KEY) {
    console.error("PRIVATE_KEY not set. Add it to .env or export it as an environment variable.");
    process.exit(1);
  }
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

  // Check registration status
  if (check) {
    console.log(`Checking registration for ${wallet.address} on Arbitrum Sepolia...`);
    const contract = new ethers.Contract(REGISTRY_ADDRESS, CHECK_ABI, provider);
    try {
      const registered: boolean = await contract.isRegistered(wallet.address);
      console.log(`Address: ${wallet.address}`);
      console.log(`Registered: ${registered}`);
    } catch (err: unknown) {
      console.error(
        "Could not check registration — isRegistered(address) may not exist on this contract."
      );
      console.error(
        "Error:",
        err instanceof Error ? err.message : err
      );

      // Try to get contract code to see if it's deployed
      const code = await provider.getCode(REGISTRY_ADDRESS);
      if (code === "0x") {
        console.error(`No contract deployed at ${REGISTRY_ADDRESS}`);
      } else {
        console.log(
          `Contract exists at ${REGISTRY_ADDRESS} (${code.length / 2 - 1} bytes) but ABI may not match.`
        );
      }
    }
    return;
  }

  // Attempt registration
  console.log(`Registering agent on Arbitrum Sepolia...`);
  console.log(`Name: ${name}`);
  console.log(`Metadata: ${metadata}`);
  console.log(`Registry: ${REGISTRY_ADDRESS}`);

  // Try register(string, string) first
  try {
    const contract = new ethers.Contract(REGISTRY_ADDRESS, REGISTER_ABI, wallet);
    const tx = await contract.register(name, metadata);
    console.log(`\nTx submitted: ${tx.hash}`);
    const receipt = await tx.wait();
    console.log(`\n--- Registration Complete ---`);
    console.log(`Tx hash: ${receipt.hash}`);
    console.log(`Gas used: ${receipt.gasUsed.toString()}`);
    console.log(`Block: ${receipt.blockNumber}`);
    return;
  } catch (err: unknown) {
    console.warn(
      "register(string, string) failed — trying registerAgent(string, string)..."
    );
    if (err instanceof Error) {
      console.warn(`Reason: ${err.message.slice(0, 200)}`);
    }
  }

  // Fallback: try registerAgent(string, string)
  try {
    const contract = new ethers.Contract(REGISTRY_ADDRESS, REGISTER_AGENT_ABI, wallet);
    const tx = await contract.registerAgent(name, metadata);
    console.log(`\nTx submitted: ${tx.hash}`);
    const receipt = await tx.wait();
    console.log(`\n--- Registration Complete ---`);
    console.log(`Tx hash: ${receipt.hash}`);
    console.log(`Gas used: ${receipt.gasUsed.toString()}`);
    console.log(`Block: ${receipt.blockNumber}`);
    return;
  } catch (err: unknown) {
    console.error("\nBoth register methods failed.");
    if (err instanceof Error) {
      console.error(`Last error: ${err.message.slice(0, 300)}`);
    }
  }

  // Check if contract exists at all
  const code = await provider.getCode(REGISTRY_ADDRESS);
  if (code === "0x") {
    console.error(`\nNo contract deployed at ${REGISTRY_ADDRESS}.`);
  } else {
    console.error(
      `\nContract exists at ${REGISTRY_ADDRESS} (${code.length / 2 - 1} bytes).`
    );
    console.error(
      "The ABI does not match — inspect the contract on Arbiscan to find the correct function signatures."
    );
    console.error(
      `Explorer: https://sepolia.arbiscan.io/address/${REGISTRY_ADDRESS}`
    );
  }

  process.exit(1);
}

main().catch((err: unknown) => {
  console.error("Error:", err instanceof Error ? err.message : err);
  process.exit(1);
});
