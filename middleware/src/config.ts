import dotenv from "dotenv";
import { PublicKey, PrivateKey, Field, Poseidon } from "o1js";

// Load environment variables
dotenv.config();

/**
 * Validates required environment variables
 */
function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

/**
 * Configuration for the middleware coordinator
 */
export const config = {
  // Operator credentials
  operator: {
    privateKey: PrivateKey.fromBase58(requireEnv("OPERATOR_PRIVATE_KEY")),
    get publicKey() {
      return this.privateKey.toPublicKey();
    },
  },

  // Mina network configuration
  mina: {
    network: process.env.MINA_NETWORK || "zeko-devnet",
    graphqlEndpoint: requireEnv("MINA_GRAPHQL_ENDPOINT"),
    poolAddress: PublicKey.fromBase58(requireEnv("MINA_POOL_ADDRESS")),
  },

  // Escrowd configuration (ZEC side)
  escrowd: {
    baseUrl: process.env.ESCROWD_BASE_URL || "http://127.0.0.1",
    basePort: parseInt(process.env.ESCROWD_BASE_PORT || "9000", 10),
    portRange: parseInt(process.env.ESCROWD_PORT_RANGE || "10000", 10),
    operatorToken: requireEnv("ESCROWD_OPERATOR_TOKEN"),
    binaryPath: process.env.ESCROWD_BINARY_PATH || "cargo", // or path to escrowdv2 binary
    workingDir: process.env.ESCROWD_WORKING_DIR || "../zcash/escrowdv2",
  },

  // API server configuration
  api: {
    host: process.env.API_HOST || "127.0.0.1",
    port: parseInt(process.env.API_PORT || "3000", 10),
  },

  // Supabase keypair store
  supabase: {
    url: requireEnv("SUPABASE_URL"),
    serviceRoleKey: requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
  },

  // Oracle (Doot) pricing
  oracle: {
    baseUrl: process.env.ORACLE_BASE_URL || "https://doot.foundation",
    apiKey: requireEnv("ORACLE_API_KEY"),
    slippageBps: parseInt(process.env.ORACLE_SLIPPAGE_BPS || "1000", 10), // default 10%
    ttlMs: parseInt(process.env.ORACLE_TTL_MS || `${8 * 60_000}`, 10), // default 8 minutes
  },

  // Polling configuration
  polling: {
    intervalMs: parseInt(process.env.POLL_INTERVAL_MS || "15000", 10),
  },

  // Logging
  logging: {
    level: process.env.LOG_LEVEL || "info",
  },
} as const;

/**
 * Calculates escrowd instance port from trade UUID
 */
export function getEscrowdPort(tradeId: string): number {
  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  // If a UUID is provided, match zkApp behavior: Poseidon(hash(uuid chunks))
  if (uuidRegex.test(tradeId)) {
    const normalized = tradeId.replace(/-/g, "").toLowerCase();
    const chunks: Field[] = [];
    for (let i = 0; i < normalized.length; i += 8) {
      const chunk = normalized.slice(i, i + 8);
      const value = BigInt(`0x${chunk}`);
      chunks.push(Field(value));
    }
    const field = Poseidon.hash(chunks);
    const port = Number(field.toBigInt() % BigInt(config.escrowd.portRange));
    return config.escrowd.basePort + port;
  }

  // If a Field string is provided, use it directly
  try {
    const field = Field(tradeId);
    const port = Number(field.toBigInt() % BigInt(config.escrowd.portRange));
    return config.escrowd.basePort + port;
  } catch {
    // Fallback: char-code hash
    let hash = 0;
    for (let i = 0; i < tradeId.length; i++) {
      hash = (hash + tradeId.charCodeAt(i)) % config.escrowd.portRange;
    }
    return config.escrowd.basePort + hash;
  }
}

/**
 * Builds escrowd API URL for a trade
 * @param tradeId - Trade identifier (for backward compatibility with hash-based lookup)
 * @param endpoint - API endpoint path
 * @param port - Optional explicit port (preferred over hash-based calculation)
 */
export function getEscrowdUrl(
  tradeId: string,
  endpoint: string,
  port?: number
): string {
  const actualPort = port ?? getEscrowdPort(tradeId);
  const baseUrl = config.escrowd.baseUrl;
  return `${baseUrl}:${actualPort}${endpoint}`;
}

/**
 * Validates configuration
 */
export function validateConfig(): void {
  console.log("Validating configuration...");

  // Check operator key
  console.log(`  Operator: ${config.operator.publicKey.toBase58()}`);

  // Check network
  console.log(`  Network: ${config.mina.network}`);
  console.log(`  GraphQL: ${config.mina.graphqlEndpoint}`);

  // Check pool address
  console.log(`  Pool: ${config.mina.poolAddress.toBase58()}`);

  // Check escrowd
  console.log(
    `  Escrowd: ${config.escrowd.baseUrl}:${config.escrowd.basePort}-${
      config.escrowd.basePort + config.escrowd.portRange
    }`
  );

  // Supabase (sanitized)
  console.log(`  Supabase URL: ${config.supabase.url}`);

  console.log("Configuration validated ✓");
}
