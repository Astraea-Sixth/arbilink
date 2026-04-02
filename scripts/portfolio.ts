import { ethers } from "ethers";
import { getNetwork, getDefaultWallet, getAllTokens, type TokenEntry } from "../config/loadConfig.js";

const QUOTER_V2_ABI = [
  "function quoteExactInputSingle(tuple(address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96)) returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)",
];

const ERC20_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
];

const FACTORY_ABI = [
  "function getPool(address tokenA, address tokenB, uint24 fee) view returns (address)",
];

const FEE_TIERS = [500, 3000, 10000] as const;

// ── Arg parsing ─────────────────────────────────────────────────────────────

function parseArgs(): { address: string; network: string } {
  const args = process.argv.slice(2);
  let address = "";
  let network = "one";

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--address" && args[i + 1]) {
      address = args[++i]!;
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

  return { address, network };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

async function autoDetectFee(
  factory: ethers.Contract,
  tokenIn: string,
  tokenOut: string,
): Promise<number | null> {
  for (const tier of FEE_TIERS) {
    try {
      const pool: string = await factory.getPool(tokenIn, tokenOut, tier);
      if (pool !== ethers.ZeroAddress) return tier;
    } catch {
      // skip
    }
  }
  return null;
}

async function getUsdPrice(
  tokenAddress: string,
  tokenDecimals: number,
  usdcAddress: string,
  wethAddress: string,
  quoter: ethers.Contract,
  factory: ethers.Contract,
): Promise<number | null> {
  // Stablecoins
  if (tokenAddress.toLowerCase() === usdcAddress.toLowerCase()) return 1.0;

  // Try direct quote vs USDC
  const fee = await autoDetectFee(factory, tokenAddress, usdcAddress);
  if (fee !== null) {
    try {
      const oneUnit = ethers.parseUnits("1", tokenDecimals);
      const result = await quoter.quoteExactInputSingle.staticCall({
        tokenIn: tokenAddress,
        tokenOut: usdcAddress,
        amountIn: oneUnit,
        fee,
        sqrtPriceLimitX96: 0n,
      });
      return parseFloat(ethers.formatUnits(result[0] as bigint, 6));
    } catch {
      // fall through
    }
  }

  // Try via WETH: token -> WETH -> USDC
  if (tokenAddress.toLowerCase() !== wethAddress.toLowerCase()) {
    const feeToWeth = await autoDetectFee(factory, tokenAddress, wethAddress);
    const feeWethUsdc = await autoDetectFee(factory, wethAddress, usdcAddress);
    if (feeToWeth !== null && feeWethUsdc !== null) {
      try {
        const oneUnit = ethers.parseUnits("1", tokenDecimals);
        const r1 = await quoter.quoteExactInputSingle.staticCall({
          tokenIn: tokenAddress,
          tokenOut: wethAddress,
          amountIn: oneUnit,
          fee: feeToWeth,
          sqrtPriceLimitX96: 0n,
        });
        const wethAmount = r1[0] as bigint;
        const r2 = await quoter.quoteExactInputSingle.staticCall({
          tokenIn: wethAddress,
          tokenOut: usdcAddress,
          amountIn: wethAmount,
          fee: feeWethUsdc,
          sqrtPriceLimitX96: 0n,
        });
        return parseFloat(ethers.formatUnits(r2[0] as bigint, 6));
      } catch {
        // fall through
      }
    }
  }

  return null;
}

function truncAddr(addr: string): string {
  return addr.slice(0, 6) + "..." + addr.slice(-4);
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const { address, network } = parseArgs();
  const net = getNetwork(network);
  const provider = new ethers.JsonRpcProvider(net.rpc);
  const allTokens = getAllTokens(network);

  const usdcAddress = net.tokens["USDC"]?.address ?? "";
  const wethAddress = net.tokens["WETH"]?.address ?? "";

  const quoter = new ethers.Contract(net.quoter, QUOTER_V2_ABI, provider);
  const factory = new ethers.Contract(net.factory, FACTORY_ABI, provider);

  console.log(`\nPortfolio for ${truncAddr(address)} on ${net.name}`);
  console.log("━".repeat(60));

  // ETH balance
  const ethBalance = await provider.getBalance(address);
  let totalUsd = 0;

  const rows: Array<{ symbol: string; balance: string; price: string; value: string }> = [];

  if (ethBalance > 0n) {
    const ethBal = parseFloat(ethers.formatEther(ethBalance));
    const ethPrice = wethAddress
      ? await getUsdPrice(wethAddress, 18, usdcAddress, wethAddress, quoter, factory)
      : null;
    const ethValue = ethPrice !== null ? ethBal * ethPrice : null;
    if (ethValue !== null) totalUsd += ethValue;
    rows.push({
      symbol: "ETH",
      balance: ethBal.toFixed(6),
      price: ethPrice !== null ? `$${ethPrice.toFixed(2)}` : "N/A",
      value: ethValue !== null ? `$${ethValue.toFixed(2)}` : "N/A",
    });
  }

  // Token balances
  const entries = Object.entries(allTokens) as Array<[string, TokenEntry]>;
  for (const [symbol, token] of entries) {
    try {
      const contract = new ethers.Contract(token.address, ERC20_ABI, provider);
      const balance = await contract.balanceOf(address) as bigint;
      if (balance === 0n) continue;

      const bal = parseFloat(ethers.formatUnits(balance, token.decimals));
      const price = await getUsdPrice(token.address, token.decimals, usdcAddress, wethAddress, quoter, factory);
      const value = price !== null ? bal * price : null;
      if (value !== null) totalUsd += value;

      rows.push({
        symbol,
        balance: bal.toFixed(token.decimals <= 6 ? 2 : 6),
        price: price !== null ? `$${price.toFixed(token.decimals <= 6 ? 4 : 2)}` : "N/A",
        value: value !== null ? `$${value.toFixed(2)}` : "N/A",
      });
    } catch {
      // skip tokens that fail
    }
  }

  if (rows.length === 0) {
    console.log("  No balances found.");
  } else {
    // Print table
    const colW = { symbol: 8, balance: 18, price: 14, value: 14 };
    console.log(
      `  ${"Token".padEnd(colW.symbol)}${"Balance".padStart(colW.balance)}${"Price".padStart(colW.price)}${"Value".padStart(colW.value)}`
    );
    console.log("  " + "─".repeat(colW.symbol + colW.balance + colW.price + colW.value));
    for (const row of rows) {
      console.log(
        `  ${row.symbol.padEnd(colW.symbol)}${row.balance.padStart(colW.balance)}${row.price.padStart(colW.price)}${row.value.padStart(colW.value)}`
      );
    }
    console.log("  " + "─".repeat(colW.symbol + colW.balance + colW.price + colW.value));
    console.log(`  ${"TOTAL".padEnd(colW.symbol)}${"".padStart(colW.balance)}${"".padStart(colW.price)}${("$" + totalUsd.toFixed(2)).padStart(colW.value)}`);
  }

  console.log("━".repeat(60));
}

main().catch((err: unknown) => {
  console.error("Error:", err instanceof Error ? err.message : err);
  process.exit(1);
});
