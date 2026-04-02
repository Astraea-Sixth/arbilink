import { ethers } from "ethers";

// ── Config ──────────────────────────────────────────────────────────────────

const RPC_URL = "https://arb1.arbitrum.io/rpc";

const TOKENS: Record<string, { address: string; decimals: number }> = {
  WETH: { address: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1", decimals: 18 },
  USDC: { address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", decimals: 6 },
};

const UNISWAP_V3_FACTORY = "0x1F98431c8aD98523631AE4a59f267346ea31F984";
const UNISWAP_V3_QUOTER_V2 = "0x61fFE014bA17989E743c5F6cB21bF9697530B21e";

const FACTORY_ABI = [
  "function getPool(address tokenA, address tokenB, uint24 fee) view returns (address)",
];

const QUOTER_V2_ABI = [
  "function quoteExactInputSingle(tuple(address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96)) returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)",
];

// ── Arg parsing ─────────────────────────────────────────────────────────────

function parseArgs(): { tokenIn: string; tokenOut: string; fee: number } {
  const args = process.argv.slice(2);
  let tokenIn = "WETH";
  let tokenOut = "USDC";
  let fee = 500;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--pair" && args[i + 1]) {
      const pair = args[++i]!;
      const parts = pair.split("/");
      if (parts.length !== 2) {
        console.error(`Invalid pair format: ${pair}. Use TOKEN_A/TOKEN_B.`);
        process.exit(1);
      }
      tokenIn = parts[0]!.toUpperCase();
      tokenOut = parts[1]!.toUpperCase();
    } else if (arg === "--fee" && args[i + 1]) {
      fee = parseInt(args[++i]!, 10);
    }
  }

  return { tokenIn, tokenOut, fee };
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const { tokenIn, tokenOut, fee } = parseArgs();

  const tokenInInfo = TOKENS[tokenIn];
  const tokenOutInfo = TOKENS[tokenOut];
  if (!tokenInInfo || !tokenOutInfo) {
    console.error(
      `Unknown token. Supported: ${Object.keys(TOKENS).join(", ")}`
    );
    process.exit(1);
  }

  const provider = new ethers.JsonRpcProvider(RPC_URL);

  // Resolve pool address
  const factory = new ethers.Contract(UNISWAP_V3_FACTORY, FACTORY_ABI, provider);
  const poolAddress: string = await factory.getPool(
    tokenInInfo.address,
    tokenOutInfo.address,
    fee
  );
  if (poolAddress === ethers.ZeroAddress) {
    console.error(`No pool found for ${tokenIn}/${tokenOut} at fee tier ${fee}`);
    process.exit(1);
  }

  // Get quote
  const quoter = new ethers.Contract(UNISWAP_V3_QUOTER_V2, QUOTER_V2_ABI, provider);
  const amountIn = ethers.parseUnits("1", tokenInInfo.decimals);

  const result = await quoter.quoteExactInputSingle.staticCall({
    tokenIn: tokenInInfo.address,
    tokenOut: tokenOutInfo.address,
    amountIn,
    fee,
    sqrtPriceLimitX96: 0n,
  });

  const amountOut = result[0] as bigint;
  const price = parseFloat(ethers.formatUnits(amountOut, tokenOutInfo.decimals));
  const feePercent = (fee / 10000).toFixed(2);

  console.log(
    `${tokenIn}/${tokenOut} on Arbitrum One | Price: $${price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} | Fee tier: ${feePercent}% | Pool: ${poolAddress}`
  );
}

main().catch((err: unknown) => {
  console.error("Error:", err instanceof Error ? err.message : err);
  process.exit(1);
});
