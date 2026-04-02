# PRD v2.0 — ArbiLink: Arbitrum Agent Skill for OpenClaw
**Status:** APPROVED
**Date:** 2026-04-02
**Author:** Astraea
**Supersedes:** PRD v1.0

---

## What We're Adding in v2.0

### 1. Any-Pair Price (remove all hardcoding)
`price.ts` currently defaults to WETH/USDC. Must accept any token pair by address.

```bash
# Examples
npx tsx scripts/price.ts --tokenIn 0xWETH --tokenOut 0xUSDC
npx tsx scripts/price.ts --tokenIn 0xARB --tokenOut 0xUSDC --fee 3000
npx tsx scripts/price.ts --tokenIn 0xGMX --tokenOut 0xWETH --network one
```

- Auto-detect fee tier if not specified (try 500, 3000, 10000 — use whichest has liquidity)
- Show price impact of a given amount
- No hardcoded addresses anywhere

---

### 2. Pre-Swap Risk Scorecard
Before ANY swap executes, run a full risk assessment and present a scorecard to the user.
User must confirm before execution proceeds.

**Risk Score: 1-10** (1 = extreme danger, 10 = safe)

**Data sources:**
- GoPlus Security API (free, no key): `https://api.gopluslabs.io/api/v1/token_security/42161`
- DEXScreener API (free, no key): `https://api.dexscreener.com/latest/dex/tokens/{address}`
- On-chain: price impact simulation via QuoterV2

**Scorecard output:**
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 RISK SCORECARD — 0xSCAM...TOKEN
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 Overall Score:     2/10  🔴 DANGER

 ❌ HONEYPOT — cannot sell after buying
 ❌ Sell tax: 99%
 ❌ Unverified contract
 ⚠️  Creator holds 45% of supply
 ⚠️  LP unlocked — dev can drain anytime
 ⚠️  Creator made 3 previous honeypots
 ✅ Listed on DEX
 ✅ Has liquidity: $8,400

 Recommendation: DO NOT SWAP

 Proceed anyway? (yes/no):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**Scoring breakdown:**
| Check | Points |
|---|---|
| Not honeypot | +2 |
| Buy tax < 5% | +1 |
| Sell tax < 5% | +1 |
| Source verified | +1 |
| LP locked | +1 |
| Creator holds < 5% | +1 |
| No previous honeypots by creator | +1 |
| Liquidity > $50k | +1 |
| Holder count > 1000 | +1 |

**Risk thresholds:**
- 8-10: ✅ SAFE — proceed
- 5-7: ⚠️ CAUTION — confirm before proceeding
- 1-4: 🔴 DANGER — strong warning, require explicit `--force` to override

---

### 3. Security Hardening (swap.ts)

**Slippage enforcement:**
- `amountOutMinimum` must be calculated correctly: `quotedAmount * (1 - slippage/100)`
- Default slippage: 0.5% for stable pairs, 1% for volatile
- Max slippage cap: 50% (refuse to execute above this)

**Deadline parameter:**
- All swaps must include `deadline: Math.floor(Date.now() / 1000) + 300` (5 min)
- Prevents stale pending transactions from executing at bad prices

**Gas estimation before execution:**
- Run `estimateGas()` before signing
- Warn if gas cost > 10% of swap value
- Show gas cost in USD equivalent

**Operation whitelist:**
- Only `SwapRouter02.exactInputSingle()` allowed
- No raw `transfer()`, no `send()`, no arbitrary contract calls
- Destination address locked to originating wallet — tokens always come back to sender

**Balance check before swap:**
- Verify user has sufficient token balance + ETH for gas
- Clean error if insufficient: "Need 0.001 ETH for gas, you have 0.0003 ETH"

**Amount cap:**
- Default max swap: 1 ETH equivalent
- Configurable via `--max-amount`
- Swaps above cap require explicit `--confirm-large`

---

### 4. Transaction Dashboard (localhost web UI)

A simple local web server showing all ArbiLink transactions.

**Stack:** Node.js + Express + plain HTML/CSS (no framework — keep it simple and fast)

**Start:**
```bash
npx tsx scripts/dashboard.ts
# Opens http://localhost:3099
```

**What it shows:**
- Transaction history table (swap, register, etc.)
- Each row: timestamp, type, pair, amount in/out, gas, status (✅/❌), Arbiscan link
- Summary cards: total swaps, success rate, total gas spent, total volume
- Auto-refreshes every 10 seconds
- Color coded: green = success, red = failed, yellow = pending

**Data storage:**
- Transactions logged to `logs/transactions.jsonl` (same pattern as FlashBot)
- Each script writes to this log on completion
- Dashboard reads from this file

**Log entry format:**
```json
{
  "timestamp": "2026-04-02T08:15:00Z",
  "type": "swap",
  "tokenIn": "WETH",
  "tokenOut": "USDC",
  "amountIn": "0.01",
  "amountOut": "20.51",
  "gasEth": "0.000012",
  "txHash": "0xabc...",
  "status": "success",
  "network": "arbitrum-sepolia",
  "riskScore": 9
}
```

---

## Success Criteria (v2.0)

- [ ] price.ts accepts any token pair — zero hardcoded addresses
- [ ] Auto fee tier detection works
- [ ] Risk scorecard runs before every swap (GoPlus + DEXScreener)
- [ ] Score 1-4 requires `--force` to proceed
- [ ] Slippage correctly enforced in amountOutMinimum
- [ ] Deadline included in all swaps
- [ ] Gas estimation shown before execution
- [ ] Destination locked to sender wallet
- [ ] Balance + gas check before swap
- [ ] dashboard.ts starts on :3099
- [ ] Dashboard shows all tx history with status + Arbiscan links
- [ ] All scripts log to logs/transactions.jsonl
- [ ] 0 TypeScript errors
- [ ] Security scan clean

## Out of Scope (v2.0)
- Multi-hop swaps (e.g. ARB → USDC → WETH)
- Limit orders
- Portfolio tracking across multiple wallets
- Mobile UI
