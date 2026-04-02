# ArbiLink — Testing Log & Known Issues

## Live Transaction Proof

### Agent Registration (Arbitrum Sepolia)
- **TX:** `0xacca222f9748479b7e05fb1491f542b1ffe20d12805f3f6cc5be09e4bf08e17e`
- **Explorer:** https://sepolia.arbiscan.io/tx/0xacca222f9748479b7e05fb1491f542b1ffe20d12805f3f6cc5be09e4bf08e17e
- **Block:** 255910945
- **Gas:** 338,830
- **Agent wallet:** `0xa6b18B26717bBd10A3Ae828052C8CA35Ef5EcB8b`
- **Registry:** `0x8004A818BFB912233c491871b3d84c89A494BD9e`

### WETH → USDC Swap (Arbitrum One Mainnet)
- **TX:** `0xc971bcc6cf32117e83d756939088bd4d93c89a1fd16c716d706122c8e2a2b02a`
- **Explorer:** https://arbiscan.io/tx/0xc971bcc6cf32117e83d756939088bd4d93c89a1fd16c716d706122c8e2a2b02a
- **Block:** 448216194
- **Gas:** 144,435
- **Pair:** WETH → USDC, 0.001 WETH in, 0.05% fee tier
- **Router:** SwapRouter v1 `0xE592427A0AEce92De3Edee1F18E0157C05861564`

### ETH Wrap (Arbitrum One — prerequisite for swap)
- **TX:** `0xae6309a84010382aed7ded519bd892cd8d861ebdbf648382f6f3dd4e77a97bd9`
- **Explorer:** https://arbiscan.io/tx/0xae6309a84010382aed7ded519bd892cd8d861ebdbf648382f6f3dd4e77a97bd9

---

## Test Results Summary

| Script | Network | Result | Notes |
|---|---|---|---|
| `balance.ts` | Arbitrum Sepolia | ✅ Pass | Shows ETH + ERC20 balances |
| `balance.ts` | Arbitrum One | ✅ Pass | Same command, `--network one` |
| `price.ts` | Arbitrum One | ✅ Pass | Live $2,044–$2,054 WETH/USDC |
| `price.ts` | Any pair | ✅ Pass | Auto fee tier detection |
| `register.ts --check` | Arbitrum Sepolia | ✅ Pass | No PRIVATE_KEY needed |
| `register.ts` | Arbitrum Sepolia | ✅ Pass | Agent registered on-chain |
| `swap.ts --dry-run` | Arbitrum One | ✅ Pass | Correct quote + slippage |
| `swap.ts` | Arbitrum One | ✅ Pass | Live swap executed |
| `dashboard.ts` | localhost:3099 | ✅ Pass | UI renders, auto-refresh works |
| `swap.ts` | Arbitrum Sepolia | ⚠️ Broken pool | See Known Issues #1 |

---

## Known Issues

### #1 — Arbitrum Sepolia Uniswap V3 Pools Have Broken Prices
**Status:** Known testnet limitation — not a code bug.

**What happens:** Attempting a swap on Arbitrum Sepolia fails with `"AS"` (arithmetic overflow in price bounds check) or `"STF"` (safe transfer from failed).

**Root cause:** The Sepolia WETH/USDC pools have corrupted or near-zero price data (pool showed 4.3 × 10²¹ USDC/WETH). Uniswap V3 on testnet is effectively non-functional for swaps.

**Workaround:** Use `--network one` for swap testing on Arbitrum One mainnet where real liquidity exists.

**Impact:** None on mainnet. Sepolia is testnet only.

---

### #2 — WETH Wrap Required Before First Mainnet Swap
**Status:** Known — by design.

**What happens:** Swapping ETH→USDC fails because the wallet holds native ETH, not WETH. The script swaps ERC20→ERC20 via Uniswap V3 (which requires WETH, not native ETH).

**Workaround:** Wrap ETH first:
```bash
# Wrap ETH manually (or add a --wrap flag in a future version)
cast send 0x82aF49447D8a07e3bd95BD0d56f35241523fBab1 "deposit()" \
  --value 0.001ether \
  --private-key $PRIVATE_KEY \
  --rpc-url https://arb1.arbitrum.io/rpc
```

**Future fix:** Add `--wrap` flag to auto-wrap ETH → WETH before swap when `tokenIn = WETH` and native ETH balance > WETH balance.

---

### #3 — GoPlus API Rate Limiting on Rapid Calls
**Status:** Minor — cosmetic only.

**What happens:** GoPlus free API returns a 429 if called more than ~5 times/minute. Risk check gracefully handles this (defaults to score 5 = caution).

**Workaround:** None needed for normal use. Heavy testing may hit limits.

---

## What Was NOT Tested

- Multi-hop swaps (e.g. ARB → USDC → WETH) — out of scope
- Very large swap amounts (> 0.01 ETH equivalent)
- Token pairs with no Uniswap V3 pool (handled gracefully with error message)
- ERC20 → ERC20 swap (only WETH → USDC was tested)

---

## Security Notes

- Private key never hardcoded in source — loaded from `.env` only
- All network config externalized to `config/networks.json`
- Destination address locked to sender wallet — tokens always return to sender
- Risk scorecard blocks swaps scoring < 5/10 without `--force`
