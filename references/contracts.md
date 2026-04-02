# ArbiLink Contract Reference

## Networks

| Network          | Chain ID | RPC Endpoint                                |
|------------------|----------|---------------------------------------------|
| Arbitrum One     | 42161    | https://arb1.arbitrum.io/rpc                |
| Arbitrum Sepolia | 421614   | https://sepolia-rollup.arbitrum.io/rpc      |

## Agent Wallet

| Field   | Value                                        |
|---------|----------------------------------------------|
| Address | `0xa6b18B26717bBd10A3Ae828052C8CA35Ef5EcB8b` |

## Token Addresses

### Arbitrum One (Mainnet)

| Token | Address                                      |
|-------|----------------------------------------------|
| WETH  | `0x82aF49447D8a07e3bd95BD0d56f35241523fBab1` |
| USDC  | `0xaf88d065e77c8cC2239327C5EDb3A432268e5831` |

### Arbitrum Sepolia (Testnet)

| Token | Address                                      |
|-------|----------------------------------------------|
| WETH  | `0x980B62Da83eFf3D4576C647993b0c1D7faf17c73` |
| USDC  | `0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d` |

## Protocol Contracts

### Uniswap V3 — Arbitrum One

| Contract       | Address                                      |
|----------------|----------------------------------------------|
| Factory        | `0x1F98431c8aD98523631AE4a59f267346ea31F984` |
| Quoter V2      | `0x61fFE014bA17989E743c5F6cB21bF9697530B21e` |

### Uniswap V3 — Arbitrum Sepolia

| Contract       | Address                                      |
|----------------|----------------------------------------------|
| SwapRouter02   | `0x101F443B4d1b059569D643917553c771E1b9663E` |

### Identity Registry — Arbitrum Sepolia

| Contract | Address                                      |
|----------|----------------------------------------------|
| Registry | `0x8004A818BFB912233c491871b3d84c89A494BD9e` |

## ABIs Used

### ERC20 (balanceOf, decimals, symbol)

```json
[
  "function balanceOf(address owner) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)"
]
```

### Uniswap V3 Factory

```json
[
  "function getPool(address tokenA, address tokenB, uint24 fee) view returns (address)"
]
```

### Uniswap V3 Quoter V2

```json
[
  "function quoteExactInputSingle(tuple(address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96)) returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)"
]
```

### Uniswap V3 SwapRouter02

```json
[
  "function exactInputSingle(tuple(address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountOutMinimum, uint256 amountIn, uint160 sqrtPriceLimitX96)) payable returns (uint256 amountOut)"
]
```

### Identity Registry (ERC-8004 via agent0-sdk)

Uses `IDENTITY_REGISTRY_ABI` from `agent0-sdk`. Key functions:

- `register()` → mint with no URI
- `register(string agentURI)` → mint with ERC-8004 data URI
- `register(string agentURI, MetadataEntry[] metadata)` → mint with URI + metadata
- `ownerOf(uint256 tokenId)` → check token owner (ERC-721)
- `tokenURI(uint256 tokenId)` → get agent URI
- `getAgentWallet(uint256 agentId)` → get wallet for agent ID
