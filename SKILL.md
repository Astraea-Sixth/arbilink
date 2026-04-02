---
name: arbilink
description: "Arbitrum blockchain operations — check wallet balances, get live Uniswap V3 token prices, execute swaps, and register agent identity on Arbitrum. Use when: user asks about Arbitrum balances, token prices, DeFi swaps, or agent registration on-chain. Supports Arbitrum One (mainnet) and Arbitrum Sepolia (testnet)."
---

# ArbiLink — Arbitrum Agent Toolkit

## When to use

- User asks to check an Arbitrum wallet balance (ETH or ERC20)
- User wants a live token price from Uniswap V3 on Arbitrum (any token pair by address)
- User wants to execute a token swap on Arbitrum Sepolia (testnet) with risk analysis
- User wants to register the agent identity on-chain
- User wants to view transaction history via the dashboard

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
# Any token pair by contract address (auto-detects fee tier)
npx tsx scripts/price.ts --tokenIn 0x82aF49447D8a07e3bd95BD0d56f35241523fBab1 --tokenOut 0xaf88d065e77c8cC2239327C5EDb3A432268e5831

# With explicit fee tier and amount for price impact
npx tsx scripts/price.ts --tokenIn 0x82aF49447D8a07e3bd95BD0d56f35241523fBab1 --tokenOut 0xaf88d065e77c8cC2239327C5EDb3A432268e5831 --fee 500 --amount 10

# On Arbitrum Sepolia
npx tsx scripts/price.ts --tokenIn 0x... --tokenOut 0x... --network sepolia
```

### 3. Execute swap (testnet only)

```bash
# Swap on Arbitrum Sepolia (--testnet bypasses slippage for low-liquidity testnet pools)
npx tsx scripts/swap.ts --amount 0.001 --testnet

# Dry run (estimate only, no transaction)
npx tsx scripts/swap.ts --amount 0.01 --dry-run

# Custom tokens and slippage
npx tsx scripts/swap.ts --amount 0.001 --tokenIn WETH --tokenOut USDC --slippage 2 --testnet

# Override risk check and amount cap
npx tsx scripts/swap.ts --amount 5 --force --confirm-large --max-amount 10 --testnet
```

> **Note:** `--testnet` sets `amountOutMinimum = 0` since Sepolia pools have near-zero liquidity. On mainnet, omit `--testnet` for full slippage protection.

### 4. Register agent identity (ERC-8004)

```bash
# Register with default agent profile
npx tsx scripts/register.ts

# Custom name and description
npx tsx scripts/register.ts --name "My Agent" --description "An AI agent on Arbitrum"

# Check if wallet is registered (no private key needed)
npx tsx scripts/register.ts --check
```

### 5. Transaction dashboard

```bash
# Start the dashboard at http://localhost:3099
npx tsx scripts/dashboard.ts
```

## Transaction Logging

All swaps and registrations are logged to `logs/transactions.jsonl` (JSONL format, one entry per line). The dashboard reads this file for display.

## Network Configuration

| Network          | Usage                              | RPC                                        |
|------------------|-------------------------------------|---------------------------------------------|
| Arbitrum One     | Swaps, price lookups (mainnet)     | https://arb1.arbitrum.io/rpc                |
| Arbitrum Sepolia | Swaps, registration, testing       | https://sepolia-rollup.arbitrum.io/rpc      |

## Verified Transactions

- **Registration** (Arbitrum Sepolia): [`0xacca222f...`](https://sepolia.arbiscan.io/tx/0xacca222f9748479b7e05fb1491f542b1ffe20d12805f3f6cc5be09e4bf08e17e)
- **Swap** (Arbitrum One mainnet): [`0xc971bcc6...`](https://arbiscan.io/tx/0xc971bcc6cf32117e83d756939088bd4d93c89a1fd16c716d706122c8e2a2b02a)

## Security

- Private key is loaded from `.env` (gitignored) — never committed to the repo
- swap.ts and register.ts require `PRIVATE_KEY` in `.env` — they exit with an error if missing
- swap.ts runs a GoPlus + DEXScreener risk scorecard before executing (blocks dangerous tokens unless --force)
- swap.ts enforces max slippage (50%), amount caps, and balance checks
- Use a **testnet-only** key — never fund it with real assets
- balance.ts and price.ts are read-only and require no private key

## Contract Reference

See [references/contracts.md](references/contracts.md) for all contract addresses and ABIs.
