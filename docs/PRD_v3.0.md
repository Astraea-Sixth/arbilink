# PRD v3.0 — ArbiLink: Arbitrum Agent Skill
**Status:** APPROVED
**Date:** 2026-04-02
**Author:** Astraea
**Supersedes:** PRD v2.0
**Deadline:** April 3, 2026 19:30 CET (April 4, 1:30 AM SGT)

---

## New in v3.0

### 1. portfolio.ts — Full Portfolio View
Show all token balances + USD values in one command.

```bash
npx tsx scripts/portfolio.ts [--address 0x...] [--network one|sepolia]
```

**Output:**
```
Portfolio — 0xa6b18...  |  Arbitrum One
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Token     Balance        Price      Value
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ETH       0.00149        $2,041     $3.04
WETH      0.000          $2,041     $0.00
USDC      2.041          $1.00      $2.04
ARB       0.000          $0.091     $0.00
GMX       0.000          $22.14     $0.00
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Total                               $5.08
```

- Check ETH + a predefined list of common Arbitrum tokens (WETH, USDC, USDT, ARB, GMX, LINK, UNI)
- Get USD value by calling price.ts logic per token
- Total portfolio value
- Configurable token list via config/networks.json
- No hardcoding

---

### 2. watch.ts — Token Risk Monitor
Monitor a token address and alert if risk score changes.

```bash
npx tsx scripts/watch.ts --token 0x... --interval 60 [--threshold 5]
```

**Behavior:**
- Polls GoPlus API every `--interval` seconds (default 60)
- If risk score drops below `--threshold` (default 5): print alert + log to transactions.jsonl
- Detects: honeypot activation, tax changes, liquidity removal, new rug signals
- Runs until Ctrl+C

**Output on change:**
```
[14:32:01] 0xTOKEN... — Score: 9/10 ✅ SAFE
[14:33:01] 0xTOKEN... — Score: 9/10 ✅ SAFE
[14:34:01] 0xTOKEN... — Score: 2/10 🔴 DANGER
  ❌ Sell tax changed: 0% → 95%
  ❌ Liquidity dropped: $180k → $2k
  🚨 ALERT: Token risk score dropped from 9 to 2
```

---

### 3. Enhanced Swap Receipt
After a successful swap, show a clean formatted receipt.

**Before (current):**
```
Tx hash: 0xc971...
Gas used: 144435
```

**After:**
```
━━━━━━━━━━━━━━━━━━━━━━━━━━
 SWAP COMPLETE ✅
━━━━━━━━━━━━━━━━━━━━━━━━━━
 Sent:      0.001 WETH
 Received:  2.041 USDC
 Slippage:  0.04% (better than expected)
 Gas:       $0.0003 (144,435 units)
 TX:        0xc971bcc6...
 View:      https://arbiscan.io/tx/0xc971...
━━━━━━━━━━━━━━━━━━━━━━━━━━
```

- Calculate actual slippage vs quoted
- Show gas in USD
- Clean Arbiscan link

---

### 4. Multi-Token Price Table
```bash
npx tsx scripts/price.ts --tokens WETH,ARB,GMX,UNI,LINK
```

**Output:**
```
Prices on Arbitrum One (via Uniswap V3)
Token    Price       24h Pool    Fee
WETH     $2,041.97   $180M       0.05%
ARB      $0.091      $12M        0.05%
GMX      $22.14      $4M         0.30%
UNI      $6.82       $8M         0.30%
LINK     $13.47      $6M         0.05%
```

- `--tokens` accepts comma-separated symbols (must be in config) or 0x addresses
- All priced against USDC
- Shows liquidity pool size from DEXScreener

---

### 5. history.ts — Transaction History
Query past transactions for any wallet from Arbiscan API.

```bash
npx tsx scripts/history.ts [--address 0x...] [--limit 10] [--network one]
```

**Output:**
```
Recent Transactions — 0xa6b18...  |  Arbitrum One
Time             Type    Details                    Status
2026-04-02 17:21 Swap    0.001 WETH → 2.041 USDC   ✅
2026-04-02 16:52 Wrap    0.001 ETH → WETH           ✅
2026-04-02 08:51 Reg     Agent registered           ✅
```

- Uses Arbiscan API (free tier, no key needed for basic queries)
- Shows swaps, wraps, registrations
- Limit configurable

---

### 6. gas.ts — Gas Price Checker
```bash
npx tsx scripts/gas.ts [--network one]
```

**Output:**
```
Arbitrum One Gas
Current:   0.01 gwei
Swap cost: ~$0.0003
Status:    ✅ LOW — good time to swap
```

- Reads current gas price from RPC
- Estimates swap cost in USD
- Simple recommendation: LOW / MEDIUM / HIGH

---

## Updated config/networks.json
Add common Arbitrum token addresses to config:
```json
"commonTokens": {
  "ARB":  { "address": "0x912CE...", "decimals": 18 },
  "GMX":  { "address": "0xfc5A1...", "decimals": 18 },
  "LINK": { "address": "0xf97f4...", "decimals": 18 },
  "UNI":  { "address": "0xFa7F8...", "decimals": 18 },
  "USDT": { "address": "0xFd086...", "decimals": 6 }
}
```

---

## Updated README
- Add portfolio.ts, watch.ts, history.ts, gas.ts to scripts table
- Add portfolio output example
- Add watch mode alert example
- Update "What's next" to reflect shipped features

---

## Success Criteria
- [ ] portfolio.ts shows all balances + USD values
- [ ] watch.ts polls and alerts on risk change
- [ ] swap receipt shows sent/received/slippage/gas in USD
- [ ] price.ts --tokens accepts comma-separated list
- [ ] history.ts queries Arbiscan
- [ ] gas.ts shows current price + swap cost estimate
- [ ] config/networks.json has commonTokens
- [ ] 0 TypeScript errors
- [ ] Security scan clean
- [ ] README updated

## Out of Scope (v3.0)
- Actual Telegram notifications (use console for now)
- Multi-hop swaps
- Limit orders
