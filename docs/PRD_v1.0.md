# PRD v1.0 — ArbiLink: Arbitrum Agent Skill for OpenClaw
**Status:** APPROVED  
**Date:** 2026-04-02  
**Author:** Astraea  
**Bounty:** ArbiLink Challenge — Agentic Bounty (Arbitrum Foundation)  
**Deadline:** April 3, 2026 — 19:30 CET (~2:30 AM SGT April 4)

---

## Vision
An OpenClaw skill that gives any AI agent native Arbitrum superpowers — read on-chain data, check balances, query live token prices, and execute swaps on Uniswap V3 — all via natural language. Agent identity registered on Arbitrum Sepolia registry.

## What We're Building
**`arbitrum-agent` OpenClaw Skill**

A self-contained skill that enables an OpenClaw agent to:
1. Check ETH/token balances on Arbitrum
2. Get live token prices via Uniswap V3 on Arbitrum
3. Execute token swaps on Uniswap V3 (Arbitrum)
4. Register agent identity on Arbitrum identity registry (agent0 SDK)
5. Read recent transactions for a wallet

## Why This is Original
- OpenClaw-native (they explicitly listed OpenClaw as a valid deployment target — we're the only ones building for it)
- Combines agent identity registration + real DeFi execution in one skill
- Built on our real FlashBot DEX knowledge (Uniswap V3 patterns we know well)

## Target Platform
- Arbitrum Sepolia (testnet for submission)
- Arbitrum One (mainnet-ready, same code)
- macOS Apple Silicon, Node.js v25+

## Tech Stack
- Node.js / TypeScript
- ethers.js v6 (we know this from FlashBot)
- @arbitrum/sdk or direct RPC calls
- Uniswap V3 SDK / direct contract calls
- agent0 SDK for identity registration
- OpenClaw SKILL.md format

## Out of Scope
- Frontend UI
- Mainnet real funds (testnet only for submission)
- Multi-chain bridging (v2 idea)

## Success Criteria
- [ ] Agent can check wallet balance on Arbitrum Sepolia
- [ ] Agent can get token prices from Uniswap V3
- [ ] Agent can execute a test swap on Arbitrum Sepolia
- [ ] Agent identity registered on Arbitrum Sepolia registry
- [ ] SKILL.md written — any OpenClaw agent can install and use
- [ ] GitHub repo public with full README
- [ ] Submission form filled
- [ ] 0 TypeScript errors
