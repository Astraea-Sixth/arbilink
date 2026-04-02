import { ethers } from "ethers";
import { getNetwork } from "../config/loadConfig.js";

const QUOTER_V2_ABI = [
  "function quoteExactInputSingle(tuple(address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96)) returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)",
];

// ── Arg parsing ─────────────────────────────────────────────────────────────

function parseArgs(): { network: string } {
  const args = process.argv.slice(2);
  let network = "one";

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--network" && args[i + 1]) {
      network = args[++i]!;
    }
  }

  return { network };
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const { network } = parseArgs();
  const net = getNetwork(network);
  const provider = new ethers.JsonRpcProvider(net.rpc);

  console.log(`\nGas Report — ${net.name}`);
  console.log("━".repeat(40));

  // Get fee data
  const feeData = await provider.getFeeData();
  const gasPrice = feeData.gasPrice ?? 0n;
  const gasPriceGwei = parseFloat(ethers.formatUnits(gasPrice, "gwei"));

  console.log(`  Gas price:    ${gasPriceGwei.toFixed(4)} gwei`);

  // Typical swap gas estimate
  const SWAP_GAS = 150000n;
  const swapCostWei = gasPrice * SWAP_GAS;
  const swapCostEth = parseFloat(ethers.formatEther(swapCostWei));

  console.log(`  Swap cost:    ${swapCostEth.toFixed(6)} ETH (est. ${SWAP_GAS.toString()} gas)`);

  // Get ETH price via QuoterV2 (WETH -> USDC)
  const wethAddress = net.tokens["WETH"]?.address;
  const usdcAddress = net.tokens["USDC"]?.address;

  if (wethAddress && usdcAddress) {
    try {
      const quoter = new ethers.Contract(net.quoter, QUOTER_V2_ABI, provider);
      const oneEth = ethers.parseUnits("1", 18);
      const result = await quoter.quoteExactInputSingle.staticCall({
        tokenIn: wethAddress,
        tokenOut: usdcAddress,
        amountIn: oneEth,
        fee: 500,
        sqrtPriceLimitX96: 0n,
      });
      const ethPriceUsd = parseFloat(ethers.formatUnits(result[0] as bigint, 6));
      const swapCostUsd = swapCostEth * ethPriceUsd;

      console.log(`  ETH price:    $${ethPriceUsd.toFixed(2)}`);
      console.log(`  Swap cost:    $${swapCostUsd.toFixed(4)} USD`);
    } catch {
      console.log("  ETH price:    N/A (quote failed)");
    }
  }

  // Recommendation
  let recommendation: string;
  if (gasPriceGwei < 0.1) {
    recommendation = "LOW — great time to swap";
  } else if (gasPriceGwei <= 1.0) {
    recommendation = "MEDIUM — reasonable";
  } else {
    recommendation = "HIGH — consider waiting";
  }

  console.log(`\n  Recommendation: ${recommendation}`);
  console.log("━".repeat(40));
}

main().catch((err: unknown) => {
  console.error("Error:", err instanceof Error ? err.message : err);
  process.exit(1);
});
