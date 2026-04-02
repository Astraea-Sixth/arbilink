# Changelog

## v4.0 — Token Scanner + Polish
- **scan.ts** — Standalone token risk scanner. Paste any address, get full GoPlus + DEXScreener report with verdict
- **CHANGELOG.md** — Version history for bounty judges

## v3.0 — Portfolio, Monitoring & Gas
- **portfolio.ts** — Full wallet view: all token balances + USD values via Uniswap V3 QuoterV2
- **watch.ts** — Continuous risk monitoring: polls GoPlus, alerts on score changes, logs to JSONL
- **gas.ts** — Current gas price + swap cost estimate in USD with LOW/MEDIUM/HIGH recommendation
- **history.ts** — Transaction history via Arbiscan V2 API
- **price.ts** — Added `--tokens` flag for multi-token price table
- **swap.ts** — Enhanced receipt: sent/received/slippage%/gas(USD)/explorer link
- **config** — Added `commonTokens` (ARB, GMX, LINK, UNI, USDT) to networks.json

## v2.0 — Security Hardening + Risk Scorecard
- **Risk scorecard** — GoPlus + DEXScreener pre-swap analysis, score 1-10, blocks dangerous tokens
- **Any-pair pricing** — price.ts accepts any token address, auto-detects fee tier
- **Security hardening** — Slippage enforcement, balance checks, gas estimation, amount caps, deadline
- **dashboard.ts** — Express web UI showing transaction history with auto-refresh
- **Transaction logging** — All swaps/registrations logged to `logs/transactions.jsonl`
- **Mainnet support** — `--network one` for Arbitrum One with SwapRouter v1 (deadline in struct)

## v1.0 — Core Toolkit
- **balance.ts** — ETH + ERC20 balance check on Arbitrum One/Sepolia
- **price.ts** — Live Uniswap V3 price via QuoterV2
- **swap.ts** — Token swap on Uniswap V3 with slippage protection
- **register.ts** — Agent identity registration on Arbitrum registry (ERC-8004 via agent0-sdk)
- **SKILL.md** — OpenClaw skill definition
- **Config externalized** — All addresses in `config/networks.json`, zero hardcoding
