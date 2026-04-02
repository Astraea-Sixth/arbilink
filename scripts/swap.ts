import "dotenv/config";
import { ethers } from "ethers";
import { appendFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { getNetwork, getSafeAddresses, getWethAddresses, getSepoliaToMainnetMap, type NetworkConfig } from "../config/loadConfig.js";

// ── Transaction logging ────────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOG_PATH = join(__dirname, "..", "logs", "transactions.jsonl");

function logTransaction(entry: Record<string, unknown>): void {
  mkdirSync(dirname(LOG_PATH), { recursive: true });
  appendFileSync(LOG_PATH, JSON.stringify({ timestamp: new Date().toISOString(), ...entry }) + "\n");
}

// ── Config ──────────────────────────────────────────────────────────────────

const PRIVATE_KEY = process.env.PRIVATE_KEY || "";
const FEE_TIER = 500;

// SwapRouter v1 (Arbitrum One) — struct includes `deadline`
const SWAP_ROUTER_V1_ABI = [
  "function exactInputSingle(tuple(address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) payable returns (uint256 amountOut)",
];

// SwapRouter02 (Arbitrum Sepolia) — struct does NOT include `deadline`
const SWAP_ROUTER_V2_ABI = [
  "function exactInputSingle(tuple(address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountOutMinimum, uint256 amountIn, uint160 sqrtPriceLimitX96)) payable returns (uint256 amountOut)",
];

const QUOTER_V2_ABI = [
  "function quoteExactInputSingle(tuple(address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96)) returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)",
];

const ERC20_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
];

// Derived from config — no hardcoded addresses
const SAFE_ADDRESSES = getSafeAddresses();
const WETH_ADDRESSES = getWethAddresses();

interface TokenInfo {
  address: string;
  decimals: number;
  symbol: string;
}

async function resolveToken(input: string, provider: ethers.JsonRpcProvider, networkTokens: Record<string, { address: string; decimals: number }>): Promise<TokenInfo> {
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

  // Symbol lookup from network-specific tokens
  const upper = input.toUpperCase();
  const info = networkTokens[upper];
  if (!info) {
    console.error(`Unknown token symbol: ${input}. Use a 0x address or one of: ${Object.keys(networkTokens).join(", ")}`);
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
  testnet: boolean;
  fee: number;
  network: string;
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
  let testnet = false;
  let fee = FEE_TIER;
  let network = "sepolia";

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
    } else if (arg === "--testnet") {
      testnet = true;
    } else if (arg === "--fee" && args[i + 1]) {
      fee = parseInt(args[++i]!, 10);
    } else if (arg === "--network" && args[i + 1]) {
      network = args[++i]!;
    }
  }

  if (!amount) {
    console.error("Usage: npx tsx scripts/swap.ts --amount 0.001 [--network sepolia|one] [--tokenIn WETH] [--tokenOut USDC] [--fee 500] [--slippage 1] [--dry-run] [--force] [--max-amount 1.0] [--confirm-large] [--testnet]");
    process.exit(1);
  }

  return { amount, tokenIn, tokenOut, slippage, dryRun, force, maxAmount, confirmLarge, testnet, fee, network };
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
  const { amount, tokenIn, tokenOut, slippage, dryRun, force, maxAmount, confirmLarge, testnet, fee, network } = parseArgs();

  const net = getNetwork(network);
  const hasDeadline = net.routerVersion === "v1";
  const routerAbi = hasDeadline ? SWAP_ROUTER_V1_ABI : SWAP_ROUTER_V2_ABI;

  if (isNaN(Number(amount)) || Number(amount) <= 0) {
    console.error(`Invalid amount: ${amount}. Must be a positive number.`);
    process.exit(1);
  }

  // Resolve tokens — supports both symbols (WETH) and raw addresses (0x...)
  const networkProvider = new ethers.JsonRpcProvider(net.rpc);
  const tokenInInfo = await resolveToken(tokenIn, networkProvider, net.tokens);
  const tokenOutInfo = await resolveToken(tokenOut, networkProvider, net.tokens);

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
        network: network === "one" ? "arbitrum-one" : "arbitrum-sepolia",
        riskScore: riskResult.score,
      });
      process.exit(1);
    }
    if (riskResult.score >= 5 && riskResult.score < 8 && !force) {
      console.warn(`Caution: risk score is ${riskResult.score}/10. Proceeding anyway (use --force to skip warnings).`);
    }
  }

  // Get a price estimate via QuoterV2
  let estimatedOut = 0n;

  if (network === "one") {
    // On mainnet: quote directly using the same network's quoter
    try {
      const quoter = new ethers.Contract(net.quoter, QUOTER_V2_ABI, networkProvider);
      const result = await quoter.quoteExactInputSingle.staticCall({
        tokenIn: tokenInInfo.address,
        tokenOut: tokenOutInfo.address,
        amountIn,
        fee,
        sqrtPriceLimitX96: 0n,
      });
      estimatedOut = result[0] as bigint;
      console.log(
        `Estimated output: ${ethers.formatUnits(estimatedOut, tokenOutInfo.decimals)} ${tokenOutInfo.symbol}`
      );
    } catch {
      console.warn("Could not get price quote. Proceeding without minimum output protection.");
    }
  } else {
    // On Sepolia: cross-reference to mainnet quoter for price estimate
    const sepoliaToMainnet = getSepoliaToMainnetMap();
    const mainnetInAddr = sepoliaToMainnet[tokenInInfo.address.toLowerCase()];
    const mainnetOutAddr = sepoliaToMainnet[tokenOutInfo.address.toLowerCase()];
    if (mainnetInAddr && mainnetOutAddr) {
      try {
        const mainnetNet = getNetwork("one");
        const mainnetProvider = new ethers.JsonRpcProvider(mainnetNet.rpc);
        const quoter = new ethers.Contract(mainnetNet.quoter, QUOTER_V2_ABI, mainnetProvider);
        const result = await quoter.quoteExactInputSingle.staticCall({
          tokenIn: mainnetInAddr,
          tokenOut: mainnetOutAddr,
          amountIn,
          fee,
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
  }

  // Calculate amountOutMinimum with slippage
  const slippageBps = BigInt(Math.floor(slippage * 100));
  const amountOutMinimum = estimatedOut > 0n
    ? estimatedOut - (estimatedOut * slippageBps) / 10000n
    : 0n;

  if (amountOutMinimum === 0n && !force && !testnet) {
    console.error(
      "🔴 WARNING: No price quote available — amountOutMinimum set to 0. Vulnerable to sandwich attacks.\n" +
      "   Use --force to proceed anyway, or --testnet for testnet execution."
    );
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
      status: "blocked-no-quote",
      network: network === "one" ? "arbitrum-one" : "arbitrum-sepolia",
      riskScore: riskResult?.score ?? null,
    });
    process.exit(1);
  }
  if (amountOutMinimum === 0n && force) {
    console.warn("🔴 WARNING: No price quote — amountOutMinimum is 0. Proceeding because --force was set.");
  }

  // Testnet mode: override slippage protection for low-liquidity testnet pools
  const finalAmountOutMinimum = testnet ? 0n : amountOutMinimum;
  if (testnet) {
    console.warn("⚠️  TESTNET MODE: amountOutMinimum set to 0 — no slippage protection");
  }

  if (dryRun) {
    console.log("\n--- DRY RUN ---");
    console.log(`Swap: ${amount} ${tokenInInfo.symbol} -> ${tokenOutInfo.symbol}`);
    console.log(`Network: ${net.name}`);
    console.log(`Router: ${net.router}`);
    console.log(`Token in: ${tokenInInfo.address} (${tokenInInfo.symbol})`);
    console.log(`Token out: ${tokenOutInfo.address} (${tokenOutInfo.symbol})`);
    console.log(`Amount in: ${ethers.formatUnits(amountIn, tokenInInfo.decimals)} ${tokenInInfo.symbol}`);
    console.log(`Min output: ${ethers.formatUnits(finalAmountOutMinimum, tokenOutInfo.decimals)} ${tokenOutInfo.symbol}`);
    console.log(`Slippage: ${slippage}%`);
    console.log(`Fee tier: ${(fee / 10000).toFixed(2)}%`);
    if (testnet) console.log(`Mode: TESTNET (no slippage protection)`);
    if (riskResult) console.log(`Risk score: ${riskResult.score}/10`);
    return;
  }

  // Signing required — validate private key
  if (!PRIVATE_KEY) {
    console.error("PRIVATE_KEY not set. Add it to .env or export it as an environment variable.");
    process.exit(1);
  }
  const provider = new ethers.JsonRpcProvider(net.rpc);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
  const router = new ethers.Contract(net.router, routerAbi, wallet);

  const isETHIn = WETH_ADDRESSES.has(tokenInInfo.address.toLowerCase());

  // 4. Balance check
  const ethBalance = await provider.getBalance(wallet.address);
  const estimatedGasEth = ethers.parseUnits("0.0003", 18); // ~300k gas at 0.1 gwei

  if (isETHIn) {
    const needed = amountIn + estimatedGasEth;
    if (ethBalance < needed) {
      console.error(
        `Insufficient balance. Need ${ethers.formatEther(needed)} ETH (${ethers.formatEther(amountIn)} swap + ${ethers.formatEther(estimatedGasEth)} gas), you have ${ethers.formatEther(ethBalance)} ETH`
      );
      process.exit(1);
    }
  } else {
    // ERC20 input — check token balance + ETH for gas
    if (ethBalance < estimatedGasEth) {
      console.error(
        `Insufficient ETH for gas. Need ~${ethers.formatEther(estimatedGasEth)} ETH, you have ${ethers.formatEther(ethBalance)} ETH`
      );
      process.exit(1);
    }
    const tokenContract = new ethers.Contract(tokenInInfo.address, ERC20_ABI, provider);
    const tokenBalance = await tokenContract.balanceOf(wallet.address) as bigint;
    if (tokenBalance < amountIn) {
      console.error(
        `Insufficient ${tokenInInfo.symbol} balance. Need ${ethers.formatUnits(amountIn, tokenInInfo.decimals)}, you have ${ethers.formatUnits(tokenBalance, tokenInInfo.decimals)}`
      );
      process.exit(1);
    }
  }

  const deadline = Math.floor(Date.now() / 1000) + 300;

  const swapParams = hasDeadline
    ? {
        tokenIn: tokenInInfo.address,
        tokenOut: tokenOutInfo.address,
        fee,
        recipient: wallet.address,
        deadline,
        amountIn,
        amountOutMinimum: finalAmountOutMinimum,
        sqrtPriceLimitX96: 0n,
      }
    : {
        tokenIn: tokenInInfo.address,
        tokenOut: tokenOutInfo.address,
        fee,
        recipient: wallet.address,
        amountOutMinimum: finalAmountOutMinimum,
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

  console.log(`\nSwapping ${amount} ${tokenInInfo.symbol} -> ${tokenOutInfo.symbol} on ${net.name}...`);
  if (hasDeadline) {
    console.log(`Deadline: ${new Date(deadline * 1000).toISOString()} (5 min)`);
  }

  try {
    const tx = await router.exactInputSingle(swapParams, {
      value: isETHIn ? amountIn : 0n,
    });

    console.log(`Tx submitted: ${tx.hash}`);
    const receipt = await tx.wait();

    const gasEth = ethers.formatEther(receipt.gasUsed * receipt.gasPrice);

    // Decode actual amountOut from Swap event in receipt logs
    // Uniswap V3 Pool emits: Swap(address sender, address recipient, int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick)
    const SWAP_EVENT_ABI = [
      "event Swap(address indexed sender, address indexed recipient, int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick)",
    ];
    const swapIface = new ethers.Interface(SWAP_EVENT_ABI);
    let actualAmountOut: string | null = null;

    for (const log of receipt.logs) {
      try {
        const parsed = swapIface.parseLog({ topics: [...log.topics], data: log.data });
        if (parsed && parsed.name === "Swap") {
          const amount0 = parsed.args[2] as bigint;
          const amount1 = parsed.args[3] as bigint;
          // The output token will have a positive value (received), input will be negative (sent)
          const rawOut = amount0 < 0n ? -amount0 : amount1 < 0n ? -amount1 : (amount0 > amount1 ? amount0 : amount1);
          actualAmountOut = ethers.formatUnits(rawOut > 0n ? rawOut : -rawOut, tokenOutInfo.decimals);
          break;
        }
      } catch {
        // Not a matching log — continue
      }
    }

    const displayOut = actualAmountOut ?? ethers.formatUnits(finalAmountOutMinimum, tokenOutInfo.decimals);

    console.log(`\n--- Swap Complete ---`);
    console.log(`Tx hash: ${receipt.hash}`);
    console.log(`Amount in: ${amount} ${tokenInInfo.symbol}`);
    console.log(`Amount out: ${displayOut} ${tokenOutInfo.symbol}${actualAmountOut ? "" : " (min estimate)"}`);
    console.log(`Gas used: ${receipt.gasUsed.toString()} (${gasEth} ETH)`);
    console.log(`Block: ${receipt.blockNumber}`);

    logTransaction({
      type: "swap",
      tokenIn: tokenInInfo.symbol,
      tokenOut: tokenOutInfo.symbol,
      tokenInAddress: tokenInInfo.address,
      tokenOutAddress: tokenOutInfo.address,
      amountIn: amount,
      amountOut: displayOut,
      amountOutActual: actualAmountOut !== null,
      gasEth,
      txHash: receipt.hash,
      status: "success",
      network: network === "one" ? "arbitrum-one" : "arbitrum-sepolia",
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
      network: network === "one" ? "arbitrum-one" : "arbitrum-sepolia",
      riskScore: riskResult?.score ?? null,
      error: errMsg.slice(0, 500),
    });

    if (err instanceof Error) {
      console.error(`\nSwap failed: ${err.message}`);
      if (err.message.includes("insufficient funds")) {
        console.error(`Hint: Make sure you have enough ETH on ${net.name} for gas + swap amount.`);
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
