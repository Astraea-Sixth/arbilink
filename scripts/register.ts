import "dotenv/config";
import { ethers } from "ethers";
import {
  IDENTITY_REGISTRY_ABI,
  encodeErc8004JsonDataUri,
} from "agent0-sdk";
import { appendFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { getNetwork, getDefaultWallet } from "../config/loadConfig.js";

// ── Transaction logging ────────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOG_PATH = join(__dirname, "..", "logs", "transactions.jsonl");

function logTransaction(entry: Record<string, unknown>): void {
  mkdirSync(dirname(LOG_PATH), { recursive: true });
  appendFileSync(LOG_PATH, JSON.stringify({ timestamp: new Date().toISOString(), ...entry }) + "\n");
}

// ── Config ──────────────────────────────────────────────────────────────────

const PRIVATE_KEY = process.env.PRIVATE_KEY || "";

// ── Arg parsing ─────────────────────────────────────────────────────────────

interface RegisterArgs {
  name: string;
  description: string;
  check: boolean;
}

function parseArgs(): RegisterArgs {
  const args = process.argv.slice(2);
  let name = "Astraea";
  let description =
    "OpenClaw AI agent — orchestrator of the Arbitrum agent skill";
  let check = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--name" && args[i + 1]) {
      name = args[++i]!;
    } else if (arg === "--description" && args[i + 1]) {
      description = args[++i]!;
    } else if (arg === "--check") {
      check = true;
    }
  }

  return { name, description, check };
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const { name, description, check } = parseArgs();
  const net = getNetwork("sepolia");
  const provider = new ethers.JsonRpcProvider(net.rpc);
  const REGISTRY_ADDRESS = net.registry;

  // Check registration status (read-only — no private key needed)
  // The registry is ERC-721 based. We use ownerOf(tokenId) to probe,
  // or try to detect if the wallet owns any agent token.
  if (check) {
    const address = PRIVATE_KEY
      ? new ethers.Wallet(PRIVATE_KEY).address
      : getDefaultWallet();
    console.log(
      `Checking registration for ${address} on Arbitrum Sepolia...`
    );
    const contract = new ethers.Contract(
      REGISTRY_ADDRESS,
      IDENTITY_REGISTRY_ABI,
      provider
    );

    // Probe low token IDs to see if this wallet owns one
    let found = false;
    for (let tokenId = 1; tokenId <= 20; tokenId++) {
      try {
        const owner: string = await contract.ownerOf(tokenId);
        if (owner.toLowerCase() === address.toLowerCase()) {
          console.log(`Address: ${address}`);
          console.log(`Registered: true (token #${tokenId})`);
          try {
            const uri: string = await contract.tokenURI(tokenId);
            console.log(`Agent URI: ${uri}`);
          } catch {
            // tokenURI may not be set
          }
          found = true;
          break;
        }
      } catch {
        // ownerOf reverts for non-existent tokens — we've passed the last minted ID
        break;
      }
    }

    if (!found) {
      console.log(`Address: ${address}`);
      console.log(`Registered: false`);
    }
    return;
  }

  // Signing required from here — validate private key
  if (!PRIVATE_KEY) {
    console.error(
      "PRIVATE_KEY not set. Add it to .env or export it as an environment variable."
    );
    process.exit(1);
  }
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
  const contract = new ethers.Contract(
    REGISTRY_ADDRESS,
    IDENTITY_REGISTRY_ABI,
    wallet
  );

  // Build ERC-8004 agent URI
  const agentURI = encodeErc8004JsonDataUri({
    name,
    description,
    version: "1.0.0",
  });

  console.log(`Registering agent on Arbitrum Sepolia...`);
  console.log(`Wallet: ${wallet.address}`);
  console.log(`Name: ${name}`);
  console.log(`Description: ${description}`);
  console.log(`Agent URI: ${agentURI}`);
  console.log(`Registry: ${REGISTRY_ADDRESS}`);

  try {
    // Use register(string agentURI) overload
    const tx = await contract["register(string)"](agentURI);
    console.log(`\nTx submitted: ${tx.hash}`);
    const receipt = await tx.wait();
    console.log(`\n--- Registration Complete ---`);
    console.log(`Tx hash: ${receipt.hash}`);
    console.log(`Gas used: ${receipt.gasUsed.toString()}`);
    console.log(`Block: ${receipt.blockNumber}`);

    logTransaction({
      type: "register",
      name,
      agentURI,
      txHash: receipt.hash,
      gasEth: ethers.formatEther(receipt.gasUsed * receipt.gasPrice),
      status: "success",
      network: "arbitrum-sepolia",
    });

    // Try to extract agentId from receipt logs
    for (const log of receipt.logs) {
      try {
        const parsed = contract.interface.parseLog({
          topics: [...log.topics],
          data: log.data,
        });
        if (parsed && parsed.name === "Transfer") {
          console.log(`Agent ID (token): ${parsed.args[2].toString()}`);
        }
      } catch {
        // Not a matching log
      }
    }
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    logTransaction({
      type: "register",
      name,
      agentURI,
      txHash: null,
      gasEth: null,
      status: "failed",
      network: "arbitrum-sepolia",
      error: errMsg.slice(0, 500),
    });

    if (err instanceof Error) {
      console.error(`\nRegistration failed: ${err.message.slice(0, 300)}`);
      if (
        err.message.includes("AlreadyRegistered") ||
        err.message.includes("already registered")
      ) {
        console.error(
          "Hint: This wallet is already registered. Use --check to see details."
        );
      } else if (err.message.includes("insufficient funds")) {
        console.error(
          "Hint: Make sure you have ETH on Arbitrum Sepolia for gas."
        );
      }
    } else {
      console.error("Registration failed:", err);
    }
    process.exit(1);
  }
}

main().catch((err: unknown) => {
  console.error("Error:", err instanceof Error ? err.message : err);
  process.exit(1);
});
