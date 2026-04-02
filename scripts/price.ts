import { ethers } from "ethers";

// ── Network config ─────────────────────────────────────────────────────────

const NETWORKS = {
  one: { rpc: "https://arb1.arbitrum.io/rpc", factory: "0x1F98431c8aD98523631AE4a59f267346ea31F984", quoter: "0x61fFE014bA17989E743c5F6cB21bF9697530B21e" },
  sepolia: { rpc: "https://sepolia-rollup.arbitrum.io/rpc", factory: "0x1F98431c8aD98523631AE4a59f267346ea31F984", quoter: "0x61fFE014bA17989E743c5F6cB21bF9697530B21e" },
} as const;

const NETWORK_LABELS: Record<string, string> = {
  one: "Arbitrum One",
  sepolia: "Arbitrum Sepolia",
};

const FEE_TIERS = [500, 3000, 10000] as const;

const ERC20_ABI = [
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
];

const FACTORY_ABI = [
  "function getPool(address tokenA, address tokenB, uint24 fee) view returns (address)",
];

const QUOTER_V2_ABI = [
  "function quoteExactInputSingle(tuple(address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96)) returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)",
];

// ── Arg parsing ─────────────────────────────────────────────────────────────

interface PriceArgs {
  tokenIn: string;
  tokenOut: string;
  fee: number | null;
  amount: string;
  network: keyof typeof NETWORKS;
}

function parseArgs(): PriceArgs {
  const args = process.argv.slice(2);
  let tokenIn = "";
  let tokenOut = "";
  let fee: number | null = null;
  let amount = "1";
  let network: keyof typeof NETWORKS = "one";

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--tokenIn" && args[i + 1]) {
      tokenIn = args[++i]!;
    } else if (arg === "--tokenOut" && args[i + 1]) {
      tokenOut = args[++i]!;
    } else if (arg === "--fee" && args[i + 1]) {
      fee = parseInt(args[++i]!, 10);
    } else if (arg === "--amount" && args[i + 1]) {
      amount = args[++i]!;
    } else if (arg === "--network" && args[i + 1]) {
      const val = args[++i]!;
      if (val !== "one" && val !== "sepolia") {
        console.error(`Invalid network: ${val}. Use "one" or "sepolia".`);
        process.exit(1);
      }
      network = val;
    }
  }

  if (!tokenIn || !tokenOut) {
    console.error("Usage: npx tsx scripts/price.ts --tokenIn 0x... --tokenOut 0x... [--fee 500] [--amount 1] [--network one|sepolia]");
    process.exit(1);
  }

  if (!ethers.isAddress(tokenIn)) {
    console.error(`Invalid tokenIn address: ${tokenIn}`);
    process.exit(1);
  }
  if (!ethers.isAddress(tokenOut)) {
    console.error(`Invalid tokenOut address: ${tokenOut}`);
    process.exit(1);
  }

  return { tokenIn, tokenOut, fee, amount, network };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

async function fetchTokenInfo(address: string, provider: ethers.JsonRpcProvider): Promise<{ decimals: number; symbol: string }> {
  const token = new ethers.Contract(address, ERC20_ABI, provider);
  const [decimals, symbol] = await Promise.all([
    token.decimals() as Promise<bigint>,
    token.symbol() as Promise<string>,
  ]);
  return { decimals: Number(decimals), symbol };
}

async function autoDetectFee(
  factory: ethers.Contract,
  tokenIn: string,
  tokenOut: string,
): Promise<number> {
  for (const tier of FEE_TIERS) {
    const pool: string = await factory.getPool(tokenIn, tokenOut, tier);
    if (pool !== ethers.ZeroAddress) {
      return tier;
    }
  }
  console.error(`No pool found for this pair at fee tiers ${FEE_TIERS.join(", ")}`);
  process.exit(1);
}

function formatFee(fee: number): string {
  return (fee / 10000).toFixed(2) + "%";
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const { tokenIn, tokenOut, fee: feeArg, amount, network } = parseArgs();
  const net = NETWORKS[network];
  const provider = new ethers.JsonRpcProvider(net.rpc);

  // Fetch token info
  const [tokenInInfo, tokenOutInfo] = await Promise.all([
    fetchTokenInfo(tokenIn, provider),
    fetchTokenInfo(tokenOut, provider),
  ]);

  // Resolve fee tier
  const factory = new ethers.Contract(net.factory, FACTORY_ABI, provider);
  const fee = feeArg ?? await autoDetectFee(factory, tokenIn, tokenOut);

  // Verify pool exists
  const poolAddress: string = await factory.getPool(tokenIn, tokenOut, fee);
  if (poolAddress === ethers.ZeroAddress) {
    console.error(`No pool found for ${tokenInInfo.symbol}/${tokenOutInfo.symbol} at fee tier ${formatFee(fee)}`);
    process.exit(1);
  }

  const quoter = new ethers.Contract(net.quoter, QUOTER_V2_ABI, provider);
  const parsedAmount = parseFloat(amount);

  if (isNaN(parsedAmount) || parsedAmount <= 0) {
    console.error(`Invalid amount: ${amount}. Must be a positive number.`);
    process.exit(1);
  }

  // Get base price (1 unit)
  const oneUnit = ethers.parseUnits("1", tokenInInfo.decimals);
  const baseResult = await quoter.quoteExactInputSingle.staticCall({
    tokenIn,
    tokenOut,
    amountIn: oneUnit,
    fee,
    sqrtPriceLimitX96: 0n,
  });
  const baseAmountOut = baseResult[0] as bigint;
  const basePrice = parseFloat(ethers.formatUnits(baseAmountOut, tokenOutInfo.decimals));

  // Output header
  const networkLabel = NETWORK_LABELS[network] ?? network;
  console.log(`${tokenInInfo.symbol}/${tokenOutInfo.symbol} on ${networkLabel}`);
  console.log(`  Pool: ${poolAddress}`);
  console.log(`  Fee tier: ${formatFee(fee)}`);
  console.log(`  Price: 1 ${tokenInInfo.symbol} = ${basePrice.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 6 })} ${tokenOutInfo.symbol}`);

  // If amount > 1, show trade details and price impact
  if (parsedAmount > 1) {
    const tradeAmountIn = ethers.parseUnits(amount, tokenInInfo.decimals);
    const tradeResult = await quoter.quoteExactInputSingle.staticCall({
      tokenIn,
      tokenOut,
      amountIn: tradeAmountIn,
      fee,
      sqrtPriceLimitX96: 0n,
    });
    const tradeAmountOut = tradeResult[0] as bigint;
    const tradeOutput = parseFloat(ethers.formatUnits(tradeAmountOut, tokenOutInfo.decimals));
    const effectivePrice = tradeOutput / parsedAmount;
    const priceImpact = ((basePrice - effectivePrice) / basePrice) * 100;

    console.log(`  Your trade: ${parsedAmount} ${tokenInInfo.symbol} = ${tradeOutput.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 6 })} ${tokenOutInfo.symbol}`);
    console.log(`  Price impact: ${priceImpact.toFixed(2)}%`);
  }
}

main().catch((err: unknown) => {
  console.error("Error:", err instanceof Error ? err.message : err);
  process.exit(1);
});
