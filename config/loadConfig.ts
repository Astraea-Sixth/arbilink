import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = join(__dirname, "networks.json");

interface TokenEntry {
  address: string;
  decimals: number;
}

export type { TokenEntry };

export interface NetworkConfig {
  name: string;
  rpc: string;
  router: string;
  routerVersion: "v1" | "v2";
  quoter: string;
  factory: string;
  registry: string;
  explorer: string;
  tokens: Record<string, TokenEntry>;
  commonTokens?: Record<string, TokenEntry>;
}

interface Config {
  defaultWallet: string;
  networks: Record<string, NetworkConfig>;
}

let _config: Config | null = null;

export function loadConfig(): Config {
  if (!_config) {
    const raw = readFileSync(CONFIG_PATH, "utf-8");
    _config = JSON.parse(raw) as Config;
  }
  return _config;
}

export function getNetwork(name: string): NetworkConfig {
  const config = loadConfig();
  const net = config.networks[name];
  if (!net) {
    console.error(`Unknown network: ${name}. Available: ${Object.keys(config.networks).join(", ")}`);
    process.exit(1);
  }
  return net;
}

export function getDefaultWallet(): string {
  return loadConfig().defaultWallet;
}

/** Get all tokens for a network: core tokens + commonTokens merged */
export function getAllTokens(networkName: string): Record<string, TokenEntry> {
  const net = getNetwork(networkName);
  return { ...net.tokens, ...(net.commonTokens ?? {}) };
}

/** Build set of all known safe token addresses (lowercase) across all networks */
export function getSafeAddresses(): Set<string> {
  const config = loadConfig();
  const addrs = new Set<string>();
  for (const net of Object.values(config.networks)) {
    for (const token of Object.values(net.tokens)) {
      addrs.add(token.address.toLowerCase());
    }
  }
  return addrs;
}

/** Build set of all known WETH addresses (lowercase) across all networks */
export function getWethAddresses(): Set<string> {
  const config = loadConfig();
  const addrs = new Set<string>();
  for (const net of Object.values(config.networks)) {
    const weth = net.tokens["WETH"];
    if (weth) addrs.add(weth.address.toLowerCase());
  }
  return addrs;
}

/** Map sepolia token addresses to their mainnet equivalents (lowercase keys) */
export function getSepoliaToMainnetMap(): Record<string, string> {
  const config = loadConfig();
  const sepolia = config.networks["sepolia"];
  const one = config.networks["one"];
  if (!sepolia || !one) return {};
  const map: Record<string, string> = {};
  for (const [symbol, sepoliaToken] of Object.entries(sepolia.tokens)) {
    const mainnetToken = one.tokens[symbol];
    if (mainnetToken) {
      map[sepoliaToken.address.toLowerCase()] = mainnetToken.address;
    }
  }
  return map;
}
