---
name: arbilink
description: "Arbitrum blockchain operations — check wallet balances, get live Uniswap V3 token prices, execute swaps, and register agent identity on Arbitrum. Use when: user asks about Arbitrum balances, token prices, DeFi swaps, or agent registration on-chain. Supports Arbitrum One (mainnet) and Arbitrum Sepolia (testnet)."
---

# ArbiLink — Arbitrum Agent Toolkit

## When to use

- User asks to check an Arbitrum wallet balance (ETH or ERC20)
- User wants a live token price from Uniswap V3 on Arbitrum
- User wants to execute a token swap on Arbitrum Sepolia (testnet)
- User wants to register the agent identity on-chain

## When NOT to use

- Non-Arbitrum chains (Ethereum mainnet, Optimism, Base, etc.)
- Complex DeFi operations beyond simple swaps (LP management, lending, etc.)
- Production mainnet swaps — swap.ts is testnet-only by design

## Install

```bash
cd /path/to/arbilink
npm install
cp .env.example .env
# Edit .env and add your Arbitrum Sepolia private key (for swap + register)
```

## Commands

### 1. Check balance

```bash
# ETH balance (default address, Sepolia)
npx tsx scripts/balance.ts

# ETH balance for a specific address on Arbitrum One
npx tsx scripts/balance.ts 0x1234...abcd --network one

# ERC20 token balance
npx tsx scripts/balance.ts --token 0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d --network sepolia
```

### 2. Get token price

```bash
# Default: WETH/USDC price on Arbitrum One
npx tsx scripts/price.ts

# Custom pair and fee tier
npx tsx scripts/price.ts --pair WETH/USDC --fee 3000
```

### 3. Execute swap (testnet only)

```bash
# Swap 0.001 ETH for USDC on Arbitrum Sepolia
npx tsx scripts/swap.ts --amount 0.001

# Dry run (estimate only, no transaction)
npx tsx scripts/swap.ts --amount 0.01 --dry-run

# Custom tokens and slippage
npx tsx scripts/swap.ts --amount 0.001 --tokenIn WETH --tokenOut USDC --slippage 2
```

### 4. Register agent identity

```bash
# Register with default name/metadata
npx tsx scripts/register.ts

# Custom name and metadata
npx tsx scripts/register.ts --name "My Agent" --metadata "Custom metadata"

# Check if already registered
npx tsx scripts/register.ts --check
```

## Network Configuration

| Network          | Usage                        | RPC                                        |
|------------------|------------------------------|---------------------------------------------|
| Arbitrum One     | Price lookups (mainnet liquidity) | https://arb1.arbitrum.io/rpc           |
| Arbitrum Sepolia | Swaps, registration, balances    | https://sepolia-rollup.arbitrum.io/rpc |

## Security

- Private key is loaded from `.env` (gitignored) — never committed to the repo
- swap.ts and register.ts require `PRIVATE_KEY` in `.env` — they exit with an error if missing
- Use a **testnet-only** key — never fund it with real assets
- balance.ts and price.ts are read-only and require no private key

## Contract Reference

See [references/contracts.md](references/contracts.md) for all contract addresses and ABIs.
