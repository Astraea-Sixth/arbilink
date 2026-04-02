import "dotenv/config";
import { ethers } from "ethers";
import { appendFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// ── Transaction logging ────────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOG_PATH = join(__dirname, "..", "logs", "transactions.jsonl");

function logTransaction(entry: Record<string, unknown>): void {
  mkdirSync(dirname(LOG_PATH), { recursive: true });
  appendFileSync(LOG_PATH, JSON.stringify({ timestamp: new Date().toISOString(), ...entry }) + "\n");
}

// ── Config ──────────────────────────────────────────────────────────────────

const RPC_URL = "https://sepolia-rollup.arbitrum.io/rpc";
const PRIVATE_KEY = process.env.PRIVATE_KEY || "";

const TOKENS: Record<string, { address: string; decimals: number }> = {
  WETH: { address: "0x980B62Da83eFf3D4576C647993b0c1D7faf17c73", decimals: 18 },
  USDC: { address: "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d", decimals: 6 },
};

const SWAP_ROUTER = "0x101F443B4d1b059569D643917553c771E1b9663E";
const FEE_TIER = 500;

// SwapRouter02 does not include deadline in the struct — deadline is handled
// via multicall or checked externally. We keep the ABI as-is.
const SWAP_ROUTER_ABI = [
  "function exactInputSingle(tuple(address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountOutMinimum, uint256 amountIn, uint160 sqrtPriceLimitX96)) payable returns (uint256 amountOut)",
];

// Quoter on mainnet — used for estimating output before swap
const QUOTER_V2 = "0x61fFE014bA17989E743c5F6cB21bF9697530B21e";
const QUOTER_V2_RPC = "https://arb1.arbitrum.io/rpc";
const QUOTER_V2_ABI = [
  "function quoteExactInputSingle(tuple(address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96)) returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)",
];

const ERC20_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
];

// Well-known safe addresses (skip risk check) — lowercase for comparison
const SAFE_ADDRESSES = new Set([
  "0x980b62da83eff3d4576c647993b0c1d7faf17c73", // WETH Sepolia
  "0x75faf114eafb1bdbe2f0316df893fd58ce46aa4d", // USDC Sepolia
  "0x82af49447d8a07e3bd95bd0d56f35241523fbab1", // WETH One
  "0xaf88d065e77c8cc2239327c5edb3a432268e5831", // USDC One
]);

// Mainnet equivalents for known Sepolia tokens (for mainnet price quote)
const SEPOLIA_TO_MAINNET: Record<string, string> = {
  "0x980b62da83eff3d4576c647993b0c1d7faf17c73": "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1", // WETH
  "0x75faf114eafb1bdbe2f0316df893fd58ce46aa4d": "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", // USDC
};

// Known WETH addresses — lowercase
const WETH_ADDRESSES = new Set([
  "0x980b62da83eff3d4576c647993b0c1d7faf17c73", // Sepolia
  "0x82af49447d8a07e3bd95bd0d56f35241523fbab1", // One
]);

interface TokenInfo {
  address: string;
  decimals: number;
  symbol: string;
}

async function resolveToken(input: string, provider: ethers.JsonRpcProvider): Promise<TokenInfo> {
  // Raw address
  if (input.startsWith("0x")) {
    if (!ethers.isAddress(input)) {
      console.error(`Invalid token address: ${input}`);
      process.exit(1);
    }
    const contract = new ethers.Contract(input, ERC20_ABI, provider);
    try {
      const [decimals, symbol] = await Promise.all([
        contract.decimals() as Promise<bigint>,
        contract.symbol() as Promise<string>,
      ]);
      return { address: input, decimals: Number(decimals), symbol };
    } catch {
      console.error(`Could not read token contract at ${input}. Is it a valid ERC20?`);
      process.exit(1);
    }
  }

  // Symbol lookup
  const upper = input.toUpperCase();
  const info = TOKENS[upper];
  if (!info) {
    console.error(`Unknown token symbol: ${input}. Use a 0x address or one of: ${Object.keys(TOKENS).join(", ")}`);
    process.exit(1);
  }
  return { address: info.address, decimals: info.decimals, symbol: upper };
}

// ── Arg parsing ─────────────────────────────────────────────────────────────

interface SwapArgs {
  amount: string;
  tokenIn: string;
  tokenOut: string;
  slippage: number;
  dryRun: boolean;
  force: boolean;
  maxAmount: number;
  confirmLarge: boolean;
}

function parseArgs(): SwapArgs {
  const args = process.argv.slice(2);
  let amount = "";
  let tokenIn = "WETH";
  let tokenOut = "USDC";
  let slippage = 1;
  let dryRun = false;
  let force = false;
  let maxAmount = 1.0;
  let confirmLarge = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--amount" && args[i + 1]) {
      amount = args[++i]!;
    } else if (arg === "--tokenIn" && args[i + 1]) {
      tokenIn = args[++i]!;
    } else if (arg === "--tokenOut" && args[i + 1]) {
      tokenOut = args[++i]!;
    } else if (arg === "--slippage" && args[i + 1]) {
      slippage = parseFloat(args[++i]!);
    } else if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--force") {
      force = true;
    } else if (arg === "--max-amount" && args[i + 1]) {
      maxAmount = parseFloat(args[++i]!);
    } else if (arg === "--confirm-large") {
      confirmLarge = true;
    }
  }

  if (!amount) {
    console.error("Usage: npx tsx scripts/swap.ts --amount 0.001 [--tokenIn WETH] [--tokenOut USDC] [--slippage 1] [--dry-run] [--force] [--max-amount 1.0] [--confirm-large]");
    process.exit(1);
  }

  return { amount, tokenIn, tokenOut, slippage, dryRun, force, maxAmount, confirmLarge };
}

// ── Risk scorecard ──────────────────────────────────────────────────────────

interface RiskResult {
  score: number;
  warnings: string[];
  safe: string[];
}

async function runRiskCheck(tokenAddress: string): Promise<RiskResult> {
  const warnings: string[] = [];
  const safe: string[] = [];
  let score = 0;

  // Fetch GoPlus data
  let goplusData: Record<string, unknown> | null = null;
  try {
    const gpRes = await fetch(`https://api.gopluslabs.io/api/v1/token_security/42161?contract_addresses=${tokenAddress}`);
    const gpJson = await gpRes.json() as { result?: Record<string, Record<string, unknown>> };
    const key = tokenAddress.toLowerCase();
    goplusData = gpJson.result?.[key] ?? null;
  } catch {
    warnings.push("Could not fetch GoPlus security data");
  }

  // Fetch DEXScreener data
  let dexLiquidity = 0;
  try {
    const dexRes = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`);
    const dexJson = await dexRes.json() as { pairs?: Array<{ liquidity?: { usd?: number } }> };
    if (dexJson.pairs && dexJson.pairs.length > 0) {
      for (const pair of dexJson.pairs) {
        const liq = pair.liquidity?.usd ?? 0;
        if (liq > dexLiquidity) dexLiquidity = liq;
      }
    }
  } catch {
    warnings.push("Could not fetch DEXScreener data");
  }

  if (goplusData) {
    // Honeypot check
    if (goplusData.is_honeypot !== "1") {
      score += 2;
      safe.push("Not a honeypot");
    } else {
      warnings.push("HONEYPOT detected");
    }

    // Buy tax
    const buyTax = parseFloat(String(goplusData.buy_tax ?? "0"));
    if (!isNaN(buyTax) && buyTax < 0.05) {
      score += 1;
      safe.push(`Buy tax: ${(buyTax * 100).toFixed(1)}%`);
    } else {
      warnings.push(`High buy tax: ${(buyTax * 100).toFixed(1)}%`);
    }

    // Sell tax
    const sellTax = parseFloat(String(goplusData.sell_tax ?? "0"));
    if (!isNaN(sellTax) && sellTax < 0.05) {
      score += 1;
      safe.push(`Sell tax: ${(sellTax * 100).toFixed(1)}%`);
    } else {
      warnings.push(`High sell tax: ${(sellTax * 100).toFixed(1)}%`);
    }

    // Open source
    if (goplusData.is_open_source === "1") {
      score += 1;
      safe.push("Contract is open source");
    } else {
      warnings.push("Contract is not open source");
    }

    // LP locked
    const lpHolders = goplusData.lp_holders as Array<{ is_locked?: number }> | undefined;
    if (lpHolders && lpHolders.some(h => h.is_locked === 1)) {
      score += 1;
      safe.push("LP is locked");
    } else {
      warnings.push("LP not locked");
    }

    // Creator percent
    const creatorPercent = parseFloat(String(goplusData.creator_percent ?? "0"));
    if (!isNaN(creatorPercent) && creatorPercent < 0.05) {
      score += 1;
      safe.push(`Creator holds ${(creatorPercent * 100).toFixed(1)}%`);
    } else {
      warnings.push(`Creator holds ${(creatorPercent * 100).toFixed(1)}%`);
    }

    // No previous honeypots (is_honeypot already covered — check other_potential_risks)
    if (!goplusData.other_potential_risks || String(goplusData.other_potential_risks) === "") {
      score += 1;
      safe.push("No other potential risks flagged");
    } else {
      warnings.push(`Other risks: ${String(goplusData.other_potential_risks)}`);
    }

    // Holder count
    const holderCount = parseInt(String(goplusData.holder_count ?? "0"), 10);
    if (!isNaN(holderCount) && holderCount > 1000) {
      score += 1;
      safe.push(`Holder count: ${holderCount.toLocaleString()}`);
    } else {
      warnings.push(`Low holder count: ${holderCount}`);
    }
  }

  // DEXScreener liquidity
  if (dexLiquidity > 50000) {
    score += 1;
    safe.push(`DEX liquidity: $${dexLiquidity.toLocaleString()}`);
  } else {
    warnings.push(`Low DEX liquidity: $${dexLiquidity.toLocaleString()}`);
  }

  return { score, warnings, safe };
}

function printRiskScorecard(result: RiskResult, tokenSymbol: string): void {
  let label: string;
  if (result.score >= 8) {
    label = "✅ SAFE";
  } else if (result.score >= 5) {
    label = "⚠️  CAUTION";
  } else {
    label = "🔴 DANGER";
  }

  console.log(`\n--- Risk Scorecard: ${tokenSymbol} ---`);
  console.log(`Score: ${result.score}/10 ${label}`);

  if (result.safe.length > 0) {
    console.log("\nPassed:");
    for (const s of result.safe) console.log(`  ✅ ${s}`);
  }
  if (result.warnings.length > 0) {
    console.log("\nWarnings:");
    for (const w of result.warnings) console.log(`  ⚠️  ${w}`);
  }
  console.log("");
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const { amount, tokenIn, tokenOut, slippage, dryRun, force, maxAmount, confirmLarge } = parseArgs();

  if (isNaN(Number(amount)) || Number(amount) <= 0) {
    console.error(`Invalid amount: ${amount}. Must be a positive number.`);
    process.exit(1);
  }

  // Resolve tokens — supports both symbols (WETH) and raw addresses (0x...)
  const sepoliaProvider = new ethers.JsonRpcProvider(RPC_URL);
  const tokenInInfo = await resolveToken(tokenIn, sepoliaProvider);
  const tokenOutInfo = await resolveToken(tokenOut, sepoliaProvider);

  const amountIn = ethers.parseUnits(amount, tokenInInfo.decimals);

  // ── Security checks ────────────────────────────────────────────────────

  // 1. Max slippage cap
  if (slippage > 50) {
    console.error(`Slippage ${slippage}% exceeds maximum allowed (50%). Refusing to execute.`);
    process.exit(1);
  }

  // 2. Amount cap
  const maxAmountWei = ethers.parseUnits(String(maxAmount), tokenInInfo.decimals);
  if (amountIn > maxAmountWei && !confirmLarge) {
    console.error(`Amount ${amount} ${tokenInInfo.symbol} exceeds max-amount ${maxAmount}. Use --confirm-large to override.`);
    process.exit(1);
  }

  // 3. Risk scorecard on tokenOut (skip well-known safe addresses)
  let riskResult: RiskResult | null = null;
  const tokenOutLower = tokenOutInfo.address.toLowerCase();
  if (!SAFE_ADDRESSES.has(tokenOutLower)) {
    console.log(`Running risk check on ${tokenOutInfo.symbol} (${tokenOutInfo.address})...`);
    riskResult = await runRiskCheck(tokenOutInfo.address);
    printRiskScorecard(riskResult, tokenOutInfo.symbol);

    if (riskResult.score < 5 && !force) {
      console.error(`Risk score too low (${riskResult.score}/10). Use --force to override.`);
      logTransaction({
        type: "swap",
        tokenIn: tokenInInfo.symbol,
        tokenOut: tokenOutInfo.symbol,
        tokenInAddress: tokenInInfo.address,
        tokenOutAddress: tokenOutInfo.address,
        amountIn: amount,
        amountOut: null,
        gasEth: null,
        txHash: null,
        status: "blocked-risk",
        network: "arbitrum-sepolia",
        riskScore: riskResult.score,
      });
      process.exit(1);
    }
    if (riskResult.score >= 5 && riskResult.score < 8 && !force) {
      console.warn(`Caution: risk score is ${riskResult.score}/10. Proceeding anyway (use --force to skip warnings).`);
    }
  }

  // Get a price estimate from mainnet quoter (Sepolia may lack liquidity for quoting)
  const mainnetInAddr = SEPOLIA_TO_MAINNET[tokenInInfo.address.toLowerCase()];
  const mainnetOutAddr = SEPOLIA_TO_MAINNET[tokenOutInfo.address.toLowerCase()];
  let estimatedOut = 0n;

  if (mainnetInAddr && mainnetOutAddr) {
    try {
      const mainnetProvider = new ethers.JsonRpcProvider(QUOTER_V2_RPC);
      const quoter = new ethers.Contract(QUOTER_V2, QUOTER_V2_ABI, mainnetProvider);
      const result = await quoter.quoteExactInputSingle.staticCall({
        tokenIn: mainnetInAddr,
        tokenOut: mainnetOutAddr,
        amountIn,
        fee: FEE_TIER,
        sqrtPriceLimitX96: 0n,
      });
      estimatedOut = result[0] as bigint;
      console.log(
        `Estimated output (mainnet price): ${ethers.formatUnits(estimatedOut, tokenOutInfo.decimals)} ${tokenOutInfo.symbol}`
      );
    } catch {
      console.warn("Could not get mainnet quote for estimation. Proceeding without minimum output protection.");
    }
  } else {
    console.warn("No mainnet equivalent found for this token pair. Skipping price estimation.");
  }

  // Calculate amountOutMinimum with slippage
  const slippageBps = BigInt(Math.floor(slippage * 100));
  const amountOutMinimum = estimatedOut > 0n
    ? estimatedOut - (estimatedOut * slippageBps) / 10000n
    : 0n;

  if (dryRun) {
    console.log("\n--- DRY RUN ---");
    console.log(`Swap: ${amount} ${tokenInInfo.symbol} -> ${tokenOutInfo.symbol}`);
    console.log(`Network: Arbitrum Sepolia`);
    console.log(`Router: ${SWAP_ROUTER}`);
    console.log(`Token in: ${tokenInInfo.address} (${tokenInInfo.symbol})`);
    console.log(`Token out: ${tokenOutInfo.address} (${tokenOutInfo.symbol})`);
    console.log(`Amount in: ${ethers.formatUnits(amountIn, tokenInInfo.decimals)} ${tokenInInfo.symbol}`);
    console.log(`Min output: ${ethers.formatUnits(amountOutMinimum, tokenOutInfo.decimals)} ${tokenOutInfo.symbol}`);
    console.log(`Slippage: ${slippage}%`);
    console.log(`Fee tier: ${(FEE_TIER / 10000).toFixed(2)}%`);
    if (riskResult) console.log(`Risk score: ${riskResult.score}/10`);
    return;
  }

  // Signing required — validate private key
  if (!PRIVATE_KEY) {
    console.error("PRIVATE_KEY not set. Add it to .env or export it as an environment variable.");
    process.exit(1);
  }
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
  const router = new ethers.Contract(SWAP_ROUTER, SWAP_ROUTER_ABI, wallet);

  const isETHIn = WETH_ADDRESSES.has(tokenInInfo.address.toLowerCase());

  // 4. Balance check
  if (isETHIn) {
    const balance = await provider.getBalance(wallet.address);
    // Rough gas estimate: 300k gas at 0.1 gwei
    const estimatedGas = ethers.parseUnits("0.0003", 18);
    const needed = amountIn + estimatedGas;
    if (balance < needed) {
      console.error(
        `Insufficient balance. Need ${ethers.formatEther(needed)} ETH (${ethers.formatEther(amountIn)} swap + ${ethers.formatEther(estimatedGas)} gas), you have ${ethers.formatEther(balance)} ETH`
      );
      process.exit(1);
    }
  }

  const swapParams = {
    tokenIn: tokenInInfo.address,
    tokenOut: tokenOutInfo.address,
    fee: FEE_TIER,
    recipient: wallet.address,
    amountOutMinimum,
    amountIn,
    sqrtPriceLimitX96: 0n,
  };

  // 5. Gas estimation
  try {
    const gasEstimate = await router.exactInputSingle.estimateGas(swapParams, {
      value: isETHIn ? amountIn : 0n,
    });
    const feeData = await provider.getFeeData();
    const gasPrice = feeData.gasPrice ?? 100000000n; // fallback 0.1 gwei
    const gasCostWei = gasEstimate * gasPrice;
    const gasCostEth = parseFloat(ethers.formatEther(gasCostWei));
    const swapValueEth = isETHIn ? parseFloat(amount) : 0;
    if (swapValueEth > 0 && gasCostEth > swapValueEth * 0.1) {
      console.warn(`Warning: Gas cost (${gasCostEth.toFixed(6)} ETH) is >${10}% of swap value (${swapValueEth} ETH)`);
    }
  } catch (err: unknown) {
    console.warn("Gas estimation failed:", err instanceof Error ? err.message : err);
  }

  // 6. Deadline check — verify we're within a reasonable time window
  // SwapRouter02 does not include deadline in the struct, so we just verify
  // we're executing promptly. If this script has been running > 5 min, abort.
  const startTime = Math.floor(Date.now() / 1000);
  const deadline = startTime + 300;

  console.log(`\nSwapping ${amount} ${tokenInInfo.symbol} -> ${tokenOutInfo.symbol} on Arbitrum Sepolia...`);

  try {
    // Final deadline sanity check
    if (Math.floor(Date.now() / 1000) > deadline) {
      throw new Error("Transaction deadline exceeded (5 min). Please retry.");
    }

    const tx = await router.exactInputSingle(swapParams, {
      value: isETHIn ? amountIn : 0n,
    });

    console.log(`Tx submitted: ${tx.hash}`);
    const receipt = await tx.wait();

    const gasEth = ethers.formatEther(receipt.gasUsed * receipt.gasPrice);

    console.log(`\n--- Swap Complete ---`);
    console.log(`Tx hash: ${receipt.hash}`);
    console.log(`Amount in: ${amount} ${tokenInInfo.symbol}`);
    console.log(`Min output: ${ethers.formatUnits(amountOutMinimum, tokenOutInfo.decimals)} ${tokenOutInfo.symbol}`);
    console.log(`Gas used: ${receipt.gasUsed.toString()} (${gasEth} ETH)`);
    console.log(`Block: ${receipt.blockNumber}`);

    logTransaction({
      type: "swap",
      tokenIn: tokenInInfo.symbol,
      tokenOut: tokenOutInfo.symbol,
      tokenInAddress: tokenInInfo.address,
      tokenOutAddress: tokenOutInfo.address,
      amountIn: amount,
      amountOut: ethers.formatUnits(amountOutMinimum, tokenOutInfo.decimals),
      gasEth,
      txHash: receipt.hash,
      status: "success",
      network: "arbitrum-sepolia",
      riskScore: riskResult?.score ?? null,
    });
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    logTransaction({
      type: "swap",
      tokenIn: tokenInInfo.symbol,
      tokenOut: tokenOutInfo.symbol,
      tokenInAddress: tokenInInfo.address,
      tokenOutAddress: tokenOutInfo.address,
      amountIn: amount,
      amountOut: null,
      gasEth: null,
      txHash: null,
      status: "failed",
      network: "arbitrum-sepolia",
      riskScore: riskResult?.score ?? null,
      error: errMsg.slice(0, 500),
    });

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
