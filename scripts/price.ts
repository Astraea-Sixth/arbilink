import { ethers } from "ethers";
import { getNetwork, getAllTokens } from "../config/loadConfig.js";

// ── Config ────────────────────────────────────────────────────────────────

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
  network: string;
  tokens: string | null;
}

function parseArgs(): PriceArgs {
  const args = process.argv.slice(2);
  let tokenIn = "";
  let tokenOut = "";
  let fee: number | null = null;
  let amount = "1";
  let network = "one";
  let tokens: string | null = null;

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
      network = args[++i]!;
    } else if (arg === "--tokens" && args[i + 1]) {
      tokens = args[++i]!;
    }
  }

  if (!tokens && (!tokenIn || !tokenOut)) {
    console.error("Usage: npx tsx scripts/price.ts --tokenIn 0x... --tokenOut 0x... [--fee 500] [--amount 1] [--network one|sepolia]");
    console.error("   or: npx tsx scripts/price.ts --tokens WETH,ARB,GMX [--network one|sepolia]");
    process.exit(1);
  }

  if (!tokens) {
    if (!ethers.isAddress(tokenIn)) {
      console.error(`Invalid tokenIn address: ${tokenIn}`);
      process.exit(1);
    }
    if (!ethers.isAddress(tokenOut)) {
      console.error(`Invalid tokenOut address: ${tokenOut}`);
      process.exit(1);
    }
  }

  return { tokenIn, tokenOut, fee, amount, network, tokens };
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

async function multiTokenPrice(network: string, tokenList: string): Promise<void> {
  const net = getNetwork(network);
  const provider = new ethers.JsonRpcProvider(net.rpc);
  const allTokens = getAllTokens(network);
  const usdcAddress = net.tokens["USDC"]?.address;

  if (!usdcAddress) {
    console.error("USDC not configured for this network");
    process.exit(1);
  }

  const factory = new ethers.Contract(net.factory, FACTORY_ABI, provider);
  const quoter = new ethers.Contract(net.quoter, QUOTER_V2_ABI, provider);

  const symbols = tokenList.split(",").map(s => s.trim().toUpperCase());

  console.log(`\nToken Prices on ${net.name} (vs USDC)`);
  console.log("━".repeat(50));

  const colW = { token: 10, price: 20, fee: 12 };
  console.log(
    `  ${"Token".padEnd(colW.token)}${"Price (USD)".padStart(colW.price)}${"Fee".padStart(colW.fee)}`
  );
  console.log("  " + "─".repeat(colW.token + colW.price + colW.fee));

  for (const sym of symbols) {
    // Resolve token: by symbol or address
    let tokenAddress: string;
    let decimals: number;
    let displaySymbol = sym;

    if (sym.startsWith("0X") && ethers.isAddress(sym)) {
      tokenAddress = sym;
      const info = await fetchTokenInfo(tokenAddress, provider);
      decimals = info.decimals;
      displaySymbol = info.symbol;
    } else {
      const entry = allTokens[sym];
      if (!entry) {
        console.log(`  ${sym.padEnd(colW.token)}${"not found".padStart(colW.price)}${"".padStart(colW.fee)}`);
        continue;
      }
      tokenAddress = entry.address;
      decimals = entry.decimals;
    }

    // Stablecoin shortcut
    if (tokenAddress.toLowerCase() === usdcAddress.toLowerCase()) {
      console.log(
        `  ${displaySymbol.padEnd(colW.token)}${"$1.0000".padStart(colW.price)}${"—".padStart(colW.fee)}`
      );
      continue;
    }

    // Auto-detect fee
    const fee = await autoDetectFee(factory, tokenAddress, usdcAddress);

    try {
      const oneUnit = ethers.parseUnits("1", decimals);
      const result = await quoter.quoteExactInputSingle.staticCall({
        tokenIn: tokenAddress,
        tokenOut: usdcAddress,
        amountIn: oneUnit,
        fee,
        sqrtPriceLimitX96: 0n,
      });
      const price = parseFloat(ethers.formatUnits(result[0] as bigint, 6));
      const priceStr = `$${price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
      const feeStr = formatFee(fee);

      console.log(
        `  ${displaySymbol.padEnd(colW.token)}${priceStr.padStart(colW.price)}${feeStr.padStart(colW.fee)}`
      );
    } catch {
      console.log(
        `  ${displaySymbol.padEnd(colW.token)}${"error".padStart(colW.price)}${"".padStart(colW.fee)}`
      );
    }
  }

  console.log("━".repeat(50));
}

async function main(): Promise<void> {
  const { tokenIn, tokenOut, fee: feeArg, amount, network, tokens } = parseArgs();

  // Multi-token mode
  if (tokens) {
    await multiTokenPrice(network, tokens);
    return;
  }

  const net = getNetwork(network);
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
  console.log(`${tokenInInfo.symbol}/${tokenOutInfo.symbol} on ${net.name}`);
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
