# ArbiLink

**Arbitrum agent superpowers** — an OpenClaw skill that gives AI agents the ability to interact with the Arbitrum blockchain.

Built for the [Arbitrum Foundation Agentic Bounty](https://www.arbitrum.foundation/).

## What it does

ArbiLink provides four core capabilities:

- **Balance** — Check ETH and ERC20 token balances on Arbitrum One or Sepolia
- **Price** — Get live token prices from Uniswap V3 pools on Arbitrum One
- **Swap** — Execute token swaps via Uniswap V3 on Arbitrum Sepolia (testnet)
- **Register** — Register the agent's identity on an on-chain registry

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
npx tsx scripts/price.ts                   # WETH/USDC (default)
npx tsx scripts/price.ts --pair WETH/USDC --fee 3000  # 0.3% fee tier
```

### Swap tokens (testnet)

```bash
npx tsx scripts/swap.ts --amount 0.001                # Swap ETH -> USDC
npx tsx scripts/swap.ts --amount 0.01 --dry-run       # Estimate only
npx tsx scripts/swap.ts --amount 0.001 --slippage 2   # 2% slippage tolerance
```

### Register agent (ERC-8004)

```bash
npx tsx scripts/register.ts                                              # Default profile
npx tsx scripts/register.ts --name "My Agent" --description "AI agent"   # Custom
npx tsx scripts/register.ts --check                                      # Check status (no key needed)
```

## Architecture

```
arbilink/
├── SKILL.md              # OpenClaw skill definition
├── scripts/
│   ├── balance.ts        # Read-only: wallet balance queries
│   ├── price.ts          # Read-only: Uniswap V3 price oracle
│   ├── swap.ts           # Write: testnet token swaps
│   └── register.ts       # Write: on-chain agent registration
└── references/
    └── contracts.md      # All contract addresses and ABIs
```

- **Read-only scripts** (balance, price) use public RPC endpoints with no private key
- **Write scripts** (swap, register) load private key from `.env` (gitignored)
- All scripts use **ethers v6** and parse CLI args from `process.argv` (no external deps)
- Price quotes come from **Arbitrum One** (mainnet) where real liquidity exists
- Swaps execute on **Arbitrum Sepolia** (testnet) for safe experimentation

## Tech

- TypeScript (strict mode)
- ethers v6
- Uniswap V3 (Factory, QuoterV2, SwapRouter02)
- Arbitrum One + Sepolia RPCs
