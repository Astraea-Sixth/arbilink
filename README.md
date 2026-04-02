# ArbiLink

**Arbitrum agent superpowers** — an OpenClaw skill that gives AI agents the ability to interact with the Arbitrum blockchain.

Built for the [Arbitrum Foundation Agentic Bounty](https://www.arbitrum.foundation/).

## What it does

ArbiLink provides five core capabilities:

- **Balance** — Check ETH and ERC20 token balances on Arbitrum One or Sepolia
- **Price** — Get live prices for any token pair by contract address from Uniswap V3
- **Swap** — Execute token swaps with risk scorecard and security hardening (testnet)
- **Register** — Register the agent's identity on an on-chain registry
- **Dashboard** — Web UI showing transaction history with auto-refresh

## Quick start

```bash
npm install
cp .env.example .env
# Edit .env and add your Arbitrum Sepolia private key

# Check your agent wallet balance
npx tsx scripts/balance.ts

# Get the current ETH price
npx tsx scripts/price.ts
```

## Commands

### Check balance

```bash
npx tsx scripts/balance.ts                          # Agent wallet ETH on Sepolia
npx tsx scripts/balance.ts 0x1234... --network one  # Any address on Arbitrum One
npx tsx scripts/balance.ts --token 0x75fa...        # ERC20 token balance
```

### Get token price

```bash
npx tsx scripts/price.ts --tokenIn 0x82aF49447D8a07e3bd95BD0d56f35241523fBab1 --tokenOut 0xaf88d065e77c8cC2239327C5EDb3A432268e5831
npx tsx scripts/price.ts --tokenIn 0x... --tokenOut 0x... --fee 3000 --amount 10 --network sepolia
```

### Swap tokens (testnet)

```bash
npx tsx scripts/swap.ts --amount 0.001 --testnet          # Swap ETH -> USDC on Sepolia
npx tsx scripts/swap.ts --amount 0.01 --dry-run            # Estimate only
npx tsx scripts/swap.ts --amount 0.001 --slippage 2 --testnet  # 2% slippage tolerance
npx tsx scripts/swap.ts --amount 5 --force --confirm-large --testnet  # Override safety checks
```

> `--testnet` sets `amountOutMinimum = 0` for low-liquidity Sepolia pools. Omit on mainnet for full slippage protection.

### Register agent (ERC-8004)

```bash
npx tsx scripts/register.ts                                              # Default profile
npx tsx scripts/register.ts --name "My Agent" --description "AI agent"   # Custom
npx tsx scripts/register.ts --check                                      # Check status (no key needed)
```

### Transaction dashboard

```bash
npx tsx scripts/dashboard.ts               # http://localhost:3099
```

## Architecture

```
arbilink/
├── SKILL.md              # OpenClaw skill definition
├── scripts/
│   ├── balance.ts        # Read-only: wallet balance queries
│   ├── price.ts          # Read-only: any token pair price by address
│   ├── swap.ts           # Write: testnet swaps + risk scorecard
│   ├── register.ts       # Write: on-chain agent registration
│   └── dashboard.ts      # Web UI: transaction history
├── logs/
│   └── transactions.jsonl  # Auto-generated transaction log
└── references/
    └── contracts.md      # All contract addresses and ABIs
```

- **Read-only scripts** (balance, price) use public RPC endpoints with no private key
- **Write scripts** (swap, register) load private key from `.env` (gitignored)
- All scripts use **ethers v6** and parse CLI args from `process.argv` (no external deps)
- Swaps support both **Arbitrum One** (mainnet, `--network one`) and **Arbitrum Sepolia** (testnet, default)
- SwapRouter v1 (with deadline) on mainnet, SwapRouter02 (no deadline) on Sepolia — handled automatically

## Verified Transactions

- **Registration** (Arbitrum Sepolia): [`0xacca222f...`](https://sepolia.arbiscan.io/tx/0xacca222f9748479b7e05fb1491f542b1ffe20d12805f3f6cc5be09e4bf08e17e)
- **Swap** (Arbitrum One mainnet): [`0xc971bcc6...`](https://arbiscan.io/tx/0xc971bcc6cf32117e83d756939088bd4d93c89a1fd16c716d706122c8e2a2b02a)

## Tech

- TypeScript (strict mode)
- ethers v6
- Uniswap V3 (Factory, QuoterV2, SwapRouter02)
- Express (dashboard server)
- GoPlus + DEXScreener (token risk analysis)
- Arbitrum One + Sepolia RPCs
