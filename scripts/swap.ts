import "dotenv/config";
import { ethers } from "ethers";

// ── Config ──────────────────────────────────────────────────────────────────

const RPC_URL = "https://sepolia-rollup.arbitrum.io/rpc";
const PRIVATE_KEY = process.env.PRIVATE_KEY || "";

const TOKENS: Record<string, { address: string; decimals: number }> = {
  WETH: { address: "0x980B62Da83eFf3D4576C647993b0c1D7faf17c73", decimals: 18 },
  USDC: { address: "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d", decimals: 6 },
};

const SWAP_ROUTER = "0x101F443B4d1b059569D643917553c771E1b9663E";
const FEE_TIER = 500;

const SWAP_ROUTER_ABI = [
  "function exactInputSingle(tuple(address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountOutMinimum, uint256 amountIn, uint160 sqrtPriceLimitX96)) payable returns (uint256 amountOut)",
];

// Quoter on Sepolia — used for estimating output before swap
const QUOTER_V2 = "0x61fFE014bA17989E743c5F6cB21bF9697530B21e";
const QUOTER_V2_RPC = "https://arb1.arbitrum.io/rpc";
const MAINNET_TOKENS: Record<string, { address: string; decimals: number }> = {
  WETH: { address: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1", decimals: 18 },
  USDC: { address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", decimals: 6 },
};

const QUOTER_V2_ABI = [
  "function quoteExactInputSingle(tuple(address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96)) returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)",
];

// ── Arg parsing ─────────────────────────────────────────────────────────────

interface SwapArgs {
  amount: string;
  tokenIn: string;
  tokenOut: string;
  slippage: number;
  dryRun: boolean;
}

function parseArgs(): SwapArgs {
  const args = process.argv.slice(2);
  let amount = "";
  let tokenIn = "WETH";
  let tokenOut = "USDC";
  let slippage = 1;
  let dryRun = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--amount" && args[i + 1]) {
      amount = args[++i]!;
    } else if (arg === "--tokenIn" && args[i + 1]) {
      tokenIn = args[++i]!.toUpperCase();
    } else if (arg === "--tokenOut" && args[i + 1]) {
      tokenOut = args[++i]!.toUpperCase();
    } else if (arg === "--slippage" && args[i + 1]) {
      slippage = parseFloat(args[++i]!);
    } else if (arg === "--dry-run") {
      dryRun = true;
    }
  }

  if (!amount) {
    console.error("Usage: npx tsx scripts/swap.ts --amount 0.001 [--tokenIn WETH] [--tokenOut USDC] [--slippage 1] [--dry-run]");
    process.exit(1);
  }

  return { amount, tokenIn, tokenOut, slippage, dryRun };
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const { amount, tokenIn, tokenOut, slippage, dryRun } = parseArgs();

  const tokenInInfo = TOKENS[tokenIn];
  const tokenOutInfo = TOKENS[tokenOut];
  if (!tokenInInfo || !tokenOutInfo) {
    console.error(`Unknown token. Supported: ${Object.keys(TOKENS).join(", ")}`);
    process.exit(1);
  }

  const amountIn = ethers.parseUnits(amount, tokenInInfo.decimals);

  // Get a price estimate from mainnet quoter (Sepolia may lack liquidity for quoting)
  const mainnetIn = MAINNET_TOKENS[tokenIn];
  const mainnetOut = MAINNET_TOKENS[tokenOut];
  let estimatedOut = 0n;

  if (mainnetIn && mainnetOut) {
    try {
      const mainnetProvider = new ethers.JsonRpcProvider(QUOTER_V2_RPC);
      const quoter = new ethers.Contract(QUOTER_V2, QUOTER_V2_ABI, mainnetProvider);
      const result = await quoter.quoteExactInputSingle.staticCall({
        tokenIn: mainnetIn.address,
        tokenOut: mainnetOut.address,
        amountIn,
        fee: FEE_TIER,
        sqrtPriceLimitX96: 0n,
      });
      estimatedOut = result[0] as bigint;
      console.log(
        `Estimated output (mainnet price): ${ethers.formatUnits(estimatedOut, tokenOutInfo.decimals)} ${tokenOut}`
      );
    } catch {
      console.warn("Could not get mainnet quote for estimation. Proceeding without minimum output protection.");
    }
  }

  // Calculate amountOutMinimum with slippage
  const slippageBps = BigInt(Math.floor(slippage * 100));
  const amountOutMinimum = estimatedOut > 0n
    ? estimatedOut - (estimatedOut * slippageBps) / 10000n
    : 0n;

  if (dryRun) {
    console.log("\n--- DRY RUN ---");
    console.log(`Swap: ${amount} ${tokenIn} -> ${tokenOut}`);
    console.log(`Network: Arbitrum Sepolia`);
    console.log(`Router: ${SWAP_ROUTER}`);
    console.log(`Amount in: ${ethers.formatUnits(amountIn, tokenInInfo.decimals)} ${tokenIn}`);
    console.log(`Min output: ${ethers.formatUnits(amountOutMinimum, tokenOutInfo.decimals)} ${tokenOut}`);
    console.log(`Slippage: ${slippage}%`);
    console.log(`Fee tier: ${(FEE_TIER / 10000).toFixed(2)}%`);
    return;
  }

  // Execute swap
  if (!PRIVATE_KEY) {
    console.error("PRIVATE_KEY not set. Add it to .env or export it as an environment variable.");
    process.exit(1);
  }
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
  const router = new ethers.Contract(SWAP_ROUTER, SWAP_ROUTER_ABI, wallet);

  const isETHIn = tokenIn === "WETH";

  const swapParams = {
    tokenIn: tokenInInfo.address,
    tokenOut: tokenOutInfo.address,
    fee: FEE_TIER,
    recipient: wallet.address,
    amountOutMinimum,
    amountIn,
    sqrtPriceLimitX96: 0n,
  };

  console.log(`\nSwapping ${amount} ${tokenIn} -> ${tokenOut} on Arbitrum Sepolia...`);

  try {
    const tx = await router.exactInputSingle(swapParams, {
      value: isETHIn ? amountIn : 0n,
    });

    console.log(`Tx submitted: ${tx.hash}`);
    const receipt = await tx.wait();

    console.log(`\n--- Swap Complete ---`);
    console.log(`Tx hash: ${receipt.hash}`);
    console.log(`Amount in: ${amount} ${tokenIn}`);
    console.log(`Min output: ${ethers.formatUnits(amountOutMinimum, tokenOutInfo.decimals)} ${tokenOut}`);
    console.log(`Gas used: ${receipt.gasUsed.toString()}`);
    console.log(`Block: ${receipt.blockNumber}`);
  } catch (err: unknown) {
    if (err instanceof Error) {
      console.error(`\nSwap failed: ${err.message}`);
      if (err.message.includes("insufficient funds")) {
        console.error("Hint: Make sure you have enough ETH on Arbitrum Sepolia for gas + swap amount.");
      }
    } else {
      console.error("Swap failed:", err);
    }
    process.exit(1);
  }
}

main().catch((err: unknown) => {
  console.error("Error:", err instanceof Error ? err.message : err);
  process.exit(1);
});
