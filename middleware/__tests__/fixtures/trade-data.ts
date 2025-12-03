/**
 * Test fixture trade data for integration tests
 */

import { FIXTURE_ADDRESSES } from './addresses.js';

export const FIXTURE_TRADES = {
  btcToMina: {
    tradeId: '550e8400-e29b-41d4-a716-446655440000',
    direction: 'BTC_TO_MINA',
    btcAmount: 0.001, // 0.001 BTC
    minaAmount: 10.0, // 10 MINA
    btcAmountSatoshis: 100000, // 0.001 BTC in satoshis
    minaAmountNanomina: 10_000_000_000, // 10 MINA in nanomina
    depositor: FIXTURE_ADDRESSES.alice,
    claimant: FIXTURE_ADDRESSES.bob,
    status: 'pending',
    createdAt: '2025-01-01T00:00:00Z',
  },
  minaToBtc: {
    tradeId: '550e8400-e29b-41d4-a716-446655440001',
    direction: 'MINA_TO_BTC',
    btcAmount: 0.001, // 0.001 BTC
    minaAmount: 10.0, // 10 MINA
    btcAmountSatoshis: 100000,
    minaAmountNanomina: 10_000_000_000,
    depositor: FIXTURE_ADDRESSES.bob,
    claimant: FIXTURE_ADDRESSES.alice,
    status: 'pending',
    createdAt: '2025-01-01T00:00:00Z',
  },
  largeTrade: {
    tradeId: '550e8400-e29b-41d4-a716-446655440002',
    direction: 'BTC_TO_MINA',
    btcAmount: 0.1, // 0.1 BTC
    minaAmount: 1000.0, // 1000 MINA
    btcAmountSatoshis: 10_000_000,
    minaAmountNanomina: 1_000_000_000_000,
    depositor: FIXTURE_ADDRESSES.alice,
    claimant: FIXTURE_ADDRESSES.bob,
    status: 'pending',
    createdAt: '2025-01-01T00:00:00Z',
  },
  expiredTrade: {
    tradeId: '550e8400-e29b-41d4-a716-446655440003',
    direction: 'BTC_TO_MINA',
    btcAmount: 0.001,
    minaAmount: 10.0,
    btcAmountSatoshis: 100000,
    minaAmountNanomina: 10_000_000_000,
    depositor: FIXTURE_ADDRESSES.alice,
    claimant: FIXTURE_ADDRESSES.bob,
    status: 'expired',
    createdAt: '2024-01-01T00:00:00Z', // Old date
    expiryBlockHeight: 100, // Already expired
  },
  completedTrade: {
    tradeId: '550e8400-e29b-41d4-a716-446655440004',
    direction: 'BTC_TO_MINA',
    btcAmount: 0.001,
    minaAmount: 10.0,
    btcAmountSatoshis: 100000,
    minaAmountNanomina: 10_000_000_000,
    depositor: FIXTURE_ADDRESSES.alice,
    claimant: FIXTURE_ADDRESSES.bob,
    status: 'completed',
    createdAt: '2025-01-01T00:00:00Z',
    completedAt: '2025-01-02T00:00:00Z',
  },
};

/**
 * Oracle price fixtures (with 10 decimals precision)
 */
export const FIXTURE_ORACLE_PRICES = {
  bitcoin: {
    price: '1000000000000', // $100,000.00 with 10 decimals
    decimals: '10',
    timestamp: Date.now().toString(),
  },
  mina: {
    price: '10000000000', // $1.00 with 10 decimals
    decimals: '10',
    timestamp: Date.now().toString(),
  },
  highVolatility: {
    bitcoin: {
      price: '1500000000000', // $150,000.00 (50% increase)
      decimals: '10',
      timestamp: Date.now().toString(),
    },
    mina: {
      price: '5000000000', // $0.50 (50% decrease)
      decimals: '10',
      timestamp: Date.now().toString(),
    },
  },
};

/**
 * Expected port calculations based on Poseidon hash
 * These are examples - actual ports will be calculated deterministically
 */
export const FIXTURE_PORTS = {
  '550e8400-e29b-41d4-a716-446655440000': 15234,
  '550e8400-e29b-41d4-a716-446655440001': 16789,
  '550e8400-e29b-41d4-a716-446655440002': 18345,
  '550e8400-e29b-41d4-a716-446655440003': 19012,
  '550e8400-e29b-41d4-a716-446655440004': 20567,
};

/**
 * Expected escrowd command-line arguments
 */
export const FIXTURE_ESCROWD_ARGS = {
  btcToMina: (tradeId: string, port: number) => [
    '--network',
    'testnet',
    '--port',
    port.toString(),
    '--trade-id',
    tradeId,
    '--mode',
    'btc-to-mina',
    '--btc-amount',
    '100000', // satoshis
  ],
  minaToBtc: (tradeId: string, port: number) => [
    '--network',
    'testnet',
    '--port',
    port.toString(),
    '--trade-id',
    tradeId,
    '--mode',
    'mina-to-btc',
    '--mina-amount',
    '10000000000', // nanomina
  ],
};
