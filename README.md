# ArbiLink

**AI agents manage on-chain assets — but they can't detect honeypots, rugged pools, or sandwich attacks.** ArbiLink is an [OpenClaw](https://github.com/openclaw/openclaw) skill that gives any AI agent a pre-swap risk scorecard, live Uniswap V3 prices, safe swap execution, and on-chain identity registration — all on Arbitrum.

Built for the [Arbitrum Foundation Agentic Bounty](https://www.arbitrum.foundation/).

---

## Install (OpenClaw)

Send this to your OpenClaw agent:

> "Please follow the SKILL.md at https://raw.githubusercontent.com/Astraea-Sixth/arbilink/main/SKILL.md and set up ArbiLink on this machine."

Your agent will clone the repo, install dependencies, and confirm when ready.

### Manual install

```bash
git clone https://github.com/Astraea-Sixth/arbilink && cd arbilink
npm install
cp .env.example .env   # add your private key for swap/register
```

---

## Architecture

```
┌─────────────────┐
│  OpenClaw Agent  │
└────────┬────────┘
         │  natural language → script execution
         ▼
┌─────────────────┐
│  ArbiLink Skill  │
│                  │
│  balance.ts ─────┼──▶  Arbitrum RPC (ETH/ERC20 balances)
│  portfolio.ts ───┼──▶  Arbitrum RPC + QuoterV2 (all balances + USD)
│  price.ts ───────┼──▶  Uniswap V3 QuoterV2 (live prices)
│  swap.ts ────────┼──▶  Uniswap V3 SwapRouter (execution)
│      │           │      ├─▶ GoPlus Security API (honeypot/tax detection)
│      │           │      └─▶ DEXScreener API (liquidity analysis)
│  watch.ts ───────┼──▶  GoPlus API (continuous risk monitoring)
│  gas.ts ─────────┼──▶  Arbitrum RPC (gas price + swap cost estimate)
│  history.ts ─────┼──▶  Arbiscan V2 API (transaction history)
│  register.ts ────┼──▶  Arbitrum Identity Registry (ERC-8004)
│  dashboard.ts ───┼──▶  localhost:3099 (transaction history UI)
└─────────────────┘
```

---

## Real Output

### Check balance

```
$ npx tsx scripts/balance.ts --network one
Address: 0xa6b18B26717bBd10A3Ae828052C8CA35Ef5EcB8b | Network: Arbitrum One | ETH: 0.00149
```

### Live price (any token pair)

```
$ npx tsx scripts/price.ts --tokenIn 0x82aF49447D8a07e3bd95BD0d56f35241523fBab1 \
    --tokenOut 0xaf88d065e77c8cC2239327C5EDb3A432268e5831
WETH/USDC on Arbitrum One
  Pool: 0xC6962004f452bE9203591991D15f6b388e09E8D0
  Fee tier: 0.05%
  Price: 1 WETH = 2,041.97 USDC
```

### Safe swap (dry run)

```
$ npx tsx scripts/swap.ts --amount 0.001 --network one --dry-run
Estimated output: 2.041987 USDC

--- DRY RUN ---
Swap: 0.001 WETH -> USDC
Network: Arbitrum One
Amount in: 0.001 WETH
Min output: 2.021568 USDC
Slippage: 1%
Fee tier: 0.05%
```

### Honeypot blocked by risk scorecard

```
$ npx tsx scripts/swap.ts --amount 0.1 --tokenOut 0xDEAD...SCAM --network one --dry-run

--- Risk Scorecard: SCAM ---
Score: 2/10 🔴 DANGER

Passed:
  ✅ Listed on DEX

Warnings:
  ⚠️  HONEYPOT — cannot sell after buying
  ⚠️  Sell tax: 99.0%
  ⚠️  Contract is not open source
  ⚠️  LP not locked
  ⚠️  Creator holds 45.2%
  ⚠️  Low holder count: 47
  ⚠️  Low DEX liquidity: $8,400

Risk score too low (2/10). Use --force to override.
```

### Agent registration (ERC-8004)

```
$ npx tsx scripts/register.ts --name "Astraea" --description "OpenClaw AI agent"
Registering agent on Arbitrum Sepolia...
Tx submitted: 0xacca222f9748479b7e05fb1491f542b1ffe20d12805f3f6cc5be09e4bf08e17e

--- Registration Complete ---
Tx hash: 0xacca222f...
Gas used: 338830
Block: 255910945
Agent ID (token): 50
```

### Portfolio overview

```
$ npx tsx scripts/portfolio.ts --network one

Portfolio for 0xa6b1...cB8b on Arbitrum One
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Token              Balance         Price         Value
  ──────────────────────────────────────────────────────
  ETH               0.001494      $2,042.71        $3.05
  USDC                  2.04         $1.00          $2.04
  ──────────────────────────────────────────────────────
  TOTAL                                            $5.09
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### Multi-token price table

```
$ npx tsx scripts/price.ts --tokens WETH,ARB

Token Prices on Arbitrum One (vs USDC)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Token              Price (USD)         Fee
  ──────────────────────────────────────────
  WETH               $2,042.8338       0.05%
  ARB                    $0.0909       0.05%
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### Gas price check

```
$ npx tsx scripts/gas.ts --network one

Gas Report — Arbitrum One
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Gas price:    0.0200 gwei
  Swap cost:    0.000003 ETH (est. 150000 gas)
  ETH price:    $2,041.69
  Swap cost:    $0.0061 USD

  Recommendation: LOW — great time to swap
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### Token risk scan

```
$ npx tsx scripts/scan.ts 0x912CE59144191C1204E64559FE8253a0e49E6548

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 TOKEN SCAN — ARB
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 Name:         Arbitrum (ARB)
 Address:      0x912CE59144191C1204E64559FE8253a0e49E6548
 Network:      Arbitrum One
 Total supply: 10,000,000,000
 Price:        $0.091368
 Liquidity:    $221,823
 24h volume:   $14,200,000

 Risk Score:   9/10  ✅ SAFE

 Passed:
   ✅ Not a honeypot
   ✅ Buy tax: 0.0%
   ✅ Sell tax: 0.0%
   ✅ Contract is verified / open source
   ✅ Creator holds 0.0%
   ✅ No other potential risks flagged
   ✅ Holder count: 1,205,000
   ✅ DEX liquidity: $221,823

 Verdict:      ✅ SAFE — Token passes most security checks.
 Explorer:     https://arbiscan.io/token/0x912CE...
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

## On-Chain Proof

| Action | TX Hash | Network | Link |
|---|---|---|---|
| Agent Registration | `0xacca222f...e17e` | Arbitrum Sepolia | [View on Arbiscan](https://sepolia.arbiscan.io/tx/0xacca222f9748479b7e05fb1491f542b1ffe20d12805f3f6cc5be09e4bf08e17e) |
| WETH → USDC Swap | `0xc971bcc6...b02a` | Arbitrum One | [View on Arbiscan](https://arbiscan.io/tx/0xc971bcc6cf32117e83d756939088bd4d93c89a1fd16c716d706122c8e2a2b02a) |

---

## Scripts

| Script | Purpose | Network | Requires Key |
|---|---|---|---|
| `balance.ts` | ETH / ERC20 balance check | Both | No |
| `portfolio.ts` | All token balances + USD values | Both | No |
| `price.ts` | Live Uniswap V3 price (single pair or `--tokens` table) | Both | No |
| `gas.ts` | Current gas price + swap cost estimate in USD | Both | No |
| `scan.ts` | Standalone token risk scanner (GoPlus + DEXScreener) | Both | No |
| `swap.ts` | Token swap with risk scorecard + security checks | Both | Yes |
| `watch.ts` | Continuous token risk monitoring with alerts | Both | No |
| `history.ts` | Transaction history from Arbiscan V2 API | Both | Arbiscan key |
| `register.ts` | On-chain agent identity (ERC-8004) | Sepolia | Yes |
| `dashboard.ts` | Transaction history web UI (localhost:3099) | N/A | No |

### Key flags (swap.ts)

| Flag | Purpose |
|---|---|
| `--network one\|sepolia` | Target network (default: sepolia) |
| `--fee 500\|3000\|10000` | Uniswap fee tier |
| `--slippage N` | Max slippage % (default: 1, cap: 50) |
| `--dry-run` | Estimate only, no execution |
| `--testnet` | Zero slippage protection (for broken testnet pools) |
| `--force` | Override risk scorecard blocks |
| `--max-amount N` | Max swap size in token units (default: 1) |
| `--confirm-large` | Override max amount cap |

---

## Config

All addresses, RPCs, and contract references live in [`config/networks.json`](config/networks.json) — zero hardcoded values in scripts.

```
config/
  networks.json      # Addresses, RPCs, tokens for each network
  loadConfig.ts      # Typed config loader
```

## Security

- Private key loaded from `.env` (gitignored) — never in the repo
- Pre-swap risk scorecard via GoPlus + DEXScreener (blocks score < 5 unless `--force`)
- Slippage enforcement with BigInt math (`amountOutMinimum = quote * (1 - slippage/100)`)
- Balance + gas pre-check with clear error messages
- Gas estimation before signing (warns if gas > 10% of swap value)
- Recipient locked to sender wallet
- Max swap cap with explicit override required
- SwapRouter v1 deadline (5 min) on mainnet

## Tech

- TypeScript (strict mode)
- ethers v6
- Uniswap V3 (Factory, QuoterV2, SwapRouter v1 + v2)
- agent0-sdk (ERC-8004 identity registration)
- Express (dashboard)
- GoPlus + DEXScreener (risk analysis)
- Arbitrum One + Sepolia

---

## What's Next

- **Multi-hop swaps** — ARB → USDC → WETH via optimal routing
- **Limit orders** — set a target price, agent monitors and executes
- **Telegram alerts** — push notifications when a watched token's risk score drops
- **Mainnet watch daemon** — persistent background process monitoring multiple tokens

---

MIT License · Built with [OpenClaw](https://github.com/openclaw/openclaw)
