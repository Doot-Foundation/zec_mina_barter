import { PrivateKey, PublicKey } from 'o1js';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Configuration for settlement service
 */

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

// Operator configuration
const operatorPrivateKeyBase58 = requireEnv('OPERATOR_PRIVATE_KEY');
const operatorPrivateKey = PrivateKey.fromBase58(operatorPrivateKeyBase58);
const operatorPublicKey = operatorPrivateKey.toPublicKey();

export const config = {
  // Mina network
  mina: {
    network: process.env.MINA_NETWORK || 'zeko-devnet',
    graphqlEndpoint: requireEnv('MINA_GRAPHQL_ENDPOINT'),
    poolAddress: PublicKey.fromBase58(requireEnv('MINA_POOL_ADDRESS')),
  },

  // Operator (pays for settlement transactions)
  operator: {
    privateKey: operatorPrivateKey,
    publicKey: operatorPublicKey,
  },

  // Settlement worker
  settlement: {
    intervalMs: parseInt(process.env.SETTLEMENT_INTERVAL_MS || '60000', 10), // 60s default
    minActionsThreshold: parseInt(process.env.SETTLEMENT_MIN_ACTIONS || '1', 10),
  },

  // Logging
  logging: {
    level: process.env.LOG_LEVEL || 'info',
  },
};
