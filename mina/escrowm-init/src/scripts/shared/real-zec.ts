import fetch from 'node-fetch';
import * as readline from 'readline';
import { logInfo, logSuccess, logWarning, logSection } from './test-utils.js';

/**
 * Real ZEC Integration Module
 *
 * Replaces mock-zec.ts with real middleware + escrowdv2 integration.
 * Provides functions for spawning escrowdv2 instances, managing ZEC funding,
 * and coordinating with middleware services.
 */

// Configuration
const MIDDLEWARE_BASE_URL = process.env.MIDDLEWARE_URL || 'http://127.0.0.1:3000';
const MIDDLEWARE_TIMEOUT = 30000; // 30 seconds for spawn operations
const STATUS_TIMEOUT = 5000; // 5 seconds for status checks
const POLLING_INTERVAL = 3000; // 3 seconds between status polls
const MAX_POLLING_ATTEMPTS = 60; // 3 minutes total (60 * 3s)

// Interfaces
export interface EscrowdSpawnResult {
  success: boolean;
  port: number;
  address: string;
}

export interface EscrowdStatus {
  verified: boolean;
  in_transit: boolean;
  origin_address?: string;
  received_amount?: string;
}

/**
 * Ensures middleware coordinator is running and accessible
 */
export async function ensureMiddlewareRunning(): Promise<void> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), STATUS_TIMEOUT);

    const response = await fetch(`${MIDDLEWARE_BASE_URL}/health`, {
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      throw new Error(`Health check failed: ${response.status}`);
    }
  } catch (err: any) {
    console.error('\n❌ Middleware not running!');
    console.error('   Start it in another terminal:');
    console.error('   cd middleware && npm start\n');
    console.error(`   Error: ${err.message}`);
    process.exit(1);
  }
}

/**
 * Spawns a new escrowdv2 instance via middleware API
 *
 * @param tradeId - Unique trade identifier
 * @param apiKey - Generated API key for this trade
 * @returns Spawn result with port and ZEC address
 */
export async function spawnEscrowdInstance(
  tradeId: string,
  apiKey: string
): Promise<EscrowdSpawnResult> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), MIDDLEWARE_TIMEOUT);

    logInfo(`Calling middleware: POST /api/spawn-escrowd`);
    console.log(`  Trade ID: ${tradeId}`);
    console.log(`  API Key: ${apiKey}`);

    const response = await fetch(`${MIDDLEWARE_BASE_URL}/api/spawn-escrowd`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ tradeId, apiKey }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Spawn failed: ${response.status} - ${errorText}`);
    }

    const data = await response.json() as { port: number };

    // Get the escrowdv2 address from the spawned instance
    const addressResponse = await fetch(`http://127.0.0.1:${data.port}/address`, {
      timeout: STATUS_TIMEOUT,
    } as any);

    if (!addressResponse.ok) {
      throw new Error(`Failed to get address from escrowdv2: ${addressResponse.status}`);
    }

    const addressData = await addressResponse.json() as { ua: string };

    return {
      success: true,
      port: data.port,
      address: addressData.ua,
    };
  } catch (err: any) {
    console.error(`❌ Failed to spawn escrowdv2: ${err.message}`);
    return {
      success: false,
      port: 0,
      address: '',
    };
  }
}

/**
 * Gets current status of an escrowdv2 instance
 *
 * @param tradeId - Trade identifier
 * @param port - Port where escrowdv2 is running
 * @returns Current escrowdv2 status
 */
export async function getEscrowdStatus(
  tradeId: string,
  port: number
): Promise<EscrowdStatus> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), STATUS_TIMEOUT);

    const response = await fetch(`http://127.0.0.1:${port}/status`, {
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      throw new Error(`Status check failed: ${response.status}`);
    }

    const data = await response.json() as {
      status: string;
      verified: boolean;
      in_transit: boolean;
      origin_address?: string;
      received_amount?: string;
    };

    return {
      verified: data.verified || false,
      in_transit: data.in_transit || false,
      origin_address: data.origin_address,
      received_amount: data.received_amount,
    };
  } catch (err: any) {
    throw new Error(`Failed to get escrowdv2 status: ${err.message}`);
  }
}

/**
 * Kills a running escrowdv2 instance via middleware
 *
 * @param tradeId - Trade identifier
 * @returns Success status
 */
export async function killEscrowdInstance(tradeId: string): Promise<boolean> {
  try {
    console.log(`  Killing escrowdv2 instance for trade ${tradeId}...`);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), STATUS_TIMEOUT);

    const response = await fetch(`${MIDDLEWARE_BASE_URL}/api/escrowd/${tradeId}`, {
      method: 'DELETE',
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      console.error(`  ⚠️  Failed to kill escrowdv2: ${response.status}`);
      return false;
    }

    console.log('  ✅ escrowdv2 instance killed');
    return true;
  } catch (err: any) {
    console.error(`  ⚠️  Error killing escrowdv2: ${err.message}`);
    return false;
  }
}

/**
 * Prompts user to fund ZEC escrow with clear instructions and waits for verification
 *
 * @param escrowAddress - ZEC unified address to fund
 * @param expectedZec - Amount of ZEC required
 * @param apiKey - API key to include in memo
 * @param fromAccount - Zcash account number (0 or 1)
 */
export async function promptUserToFundZec(
  escrowAddress: string,
  expectedZec: number,
  apiKey: string,
  fromAccount: number,
  port: number
): Promise<void> {
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  🪙 ACTION REQUIRED: Fund ZEC Escrow');
  console.log('═══════════════════════════════════════════════════════════════\n');
  console.log(`  Escrow Address: ${escrowAddress}`);
  console.log(`  Amount Required: ${expectedZec.toFixed(8)} ZEC`);
  console.log(`  From Account: ${fromAccount}`);
  console.log(`  API Key (memo): ${apiKey}\n`);

  // Hex-encode the memo (API key)
  const memoHex = Buffer.from(apiKey, 'utf8').toString('hex');

  // Account addresses (must match your zcashd wallet)
  const accountAddresses = {
    0: 'utest15dsyyx0mnx7tgnewau68lxsylcyttmxvd2sddpjjctscjmdqld5dwj76mcggymhg32hk8jxr398hmwxj2cf6skpnxyhy8v2yw8j97h04pzjassln94mgeuf2h9v9mp0gmhd5cxtqcz84dm856tp5pkp6q7tld9pe3y3dcrdmw5sqa7lq8hwp8der5209el4rcp7vjpjrgl7fxrucwk2',
    1: 'utest1ttt7ggr22jutu4dlvw8649j6a5c70ljj3ec5tymtaqmrl69rx7vruup73wy5ujydfvzst0qq2f0kup88wrhtp7uamrzw708hxpgumy7l5hzywr9z9freszdnqpvjp9cfrgjphs2me5cpc39j7ts4ywyxk2659er8xju34yxmkk08wk8q2hqvftjx7tx6hjd7nxkhrf30ja2c2v4xppk',
  };

  const sourceAddress = accountAddresses[fromAccount as keyof typeof accountAddresses];
  if (!sourceAddress) {
    throw new Error(`Invalid account number: ${fromAccount}. Use 0 or 1.`);
  }

  console.log('  Copy-paste this command in another terminal:\n');
  console.log(`curl -u zcashrpc:your_secure_password_here_change_me \\`);
  console.log(`  --data-binary '{"jsonrpc":"1.0","id":"fund","method":"z_sendmany","params":["${sourceAddress}",[{"address":"${escrowAddress}","amount":${expectedZec},"memo":"${memoHex}"}],1,null,"AllowRevealedAmounts"]}' \\`);
  console.log(`  -H 'content-type:text/plain;' \\`);
  console.log(`  http://127.0.0.1:18232/\n`);

  console.log('  Then POST to verify funding:\n');
  console.log(`curl -X POST http://127.0.0.1:${port}/funding/shielded \\`);
  console.log(`  -H 'Content-Type: application/json' \\`);
  console.log(`  -d '{"api_key":"${apiKey}","memo":"${apiKey}","origin_address":"${sourceAddress}"}'\n`);

  console.log('  ⏳ Waiting for confirmation... (press ENTER after sending both commands)');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // Wait for user to press ENTER
  await waitForUserInput();

  // Start polling for verification
  console.log('  ⏳ Polling for ZEC verification...');

  let attempts = 0;
  while (attempts < MAX_POLLING_ATTEMPTS) {
    await new Promise((resolve) => setTimeout(resolve, POLLING_INTERVAL));
    attempts++;

    try {
      const status = await getEscrowdStatus('', port);

      if (status.verified) {
        console.log(`\n  ✅ ZEC Escrow Verified!`);
        return;
      }

      process.stdout.write(`  ⏳ Attempt ${attempts}/${MAX_POLLING_ATTEMPTS}... checking status\r`);
    } catch (err: any) {
      // Continue polling on errors
      process.stdout.write(`  ⏳ Attempt ${attempts}/${MAX_POLLING_ATTEMPTS}... error (continuing)\r`);
    }
  }

  throw new Error('Timeout waiting for ZEC verification. Please check your transaction and try again.');
}

/**
 * Waits for user to press ENTER
 */
function waitForUserInput(): Promise<void> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    rl.question('', () => {
      rl.close();
      resolve();
    });
  });
}

/**
 * Calculates expected ZEC amount from MINA amount using oracle
 *
 * @param minaAmount - Amount of MINA
 * @returns Expected ZEC amount
 */
export async function calculateZecFromOracle(minaAmount: number): Promise<number> {
  try {
    // Try middleware oracle endpoint first
    const response = await fetch(`${MIDDLEWARE_BASE_URL}/api/oracle/exchange-rate?from=mina&to=zec`, {
      timeout: STATUS_TIMEOUT,
    } as any);

    if (response.ok) {
      const data = await response.json() as { rate: number };
      return minaAmount * data.rate;
    }

    // Fallback: Use Doot Foundation API directly
    const dootApiKey = process.env.DOOT_API_KEY || '';
    const minaResponse = await fetch('https://doot.foundation/api/get/price?token=mina', {
      headers: dootApiKey ? { Authorization: `Bearer ${dootApiKey}` } : {},
      timeout: STATUS_TIMEOUT,
    } as any);

    const zecResponse = await fetch('https://doot.foundation/api/get/price?token=bitcoin', {
      headers: dootApiKey ? { Authorization: `Bearer ${dootApiKey}` } : {},
      timeout: STATUS_TIMEOUT,
    } as any);

    if (!minaResponse.ok || !zecResponse.ok) {
      throw new Error('Failed to fetch oracle prices');
    }

    const minaData = await minaResponse.json() as { price_data: { price: string } };
    const zecData = await zecResponse.json() as { price_data: { price: string } };

    const minaPrice = parseFloat(minaData.price_data.price) / 1e10;
    const zecPrice = parseFloat(zecData.price_data.price) / 1e10;

    const rate = minaPrice / zecPrice;
    return minaAmount * rate;
  } catch (err: any) {
    console.error(`⚠️  Failed to fetch oracle price: ${err.message}`);
    console.error('   Using fallback rate: 0.00002 ZEC per MINA');
    return minaAmount * 0.00002; // Fallback rate
  }
}

/**
 * Generates a random API key for trade isolation
 *
 * @returns 32-character hexadecimal API key
 */
export function generateApiKey(): string {
  const chars = '0123456789abcdef';
  let apiKey = '';
  for (let i = 0; i < 32; i++) {
    apiKey += chars[Math.floor(Math.random() * chars.length)];
  }
  return apiKey;
}
