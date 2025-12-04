import { Mina, PrivateKey, PublicKey, fetchAccount } from 'o1js';
import { MinaEscrowPool, offchainState } from '../../MinaEscrowPool.js';
import dotenv from 'dotenv';

dotenv.config();

// Constants
export const ZEKO_DEVNET_ENDPOINT = 'https://devnet.zeko.io/graphql';

// Derive contract address from ESCROW_KEY in .env
const escrowKeyBase58 = process.env.ESCROW_KEY;
if (!escrowKeyBase58) {
  throw new Error('Missing ESCROW_KEY in .env file');
}
const escrowKey = PrivateKey.fromBase58(escrowKeyBase58);
export const CONTRACT_ADDRESS = escrowKey.toPublicKey().toBase58();

export const FEE = 1000_000_000; // 1 MINA
export const ZEKO_CONFIRMATION_WAIT = 20000; // 20 seconds

// Test accounts interface
export interface TestAccounts {
  alice: { key: PrivateKey; address: PublicKey };
  bob: { key: PrivateKey; address: PublicKey };
  operator: { key: PrivateKey; address: PublicKey };
}

// ==============================================================================
// LOGGING HELPERS
// ==============================================================================

export function logHeader(title: string): void {
  const padding = Math.max(0, 64 - title.length - 4);
  const leftPad = Math.floor(padding / 2);
  const rightPad = Math.ceil(padding / 2);

  console.log(
    '\n╔════════════════════════════════════════════════════════════════╗'
  );
  console.log(`║  ${' '.repeat(leftPad)}${title}${' '.repeat(rightPad)}  ║`);
  console.log(
    '╚════════════════════════════════════════════════════════════════╝\n'
  );
}

export function logSection(title: string): void {
  console.log(`\n${title}`);
}

export function logSuccess(message: string): void {
  console.log(`✅ ${message}`);
}

export function logError(message: string): void {
  console.error(`❌ ${message}`);
}

export function logInfo(message: string): void {
  console.log(`ℹ️  ${message}`);
}

export function logWarning(message: string): void {
  console.warn(`⚠️  ${message}`);
}

// ==============================================================================
// NETWORK SETUP
// ==============================================================================

export function setupNetwork(): void {
  logSection('🌐 Network Setup');
  console.log('  Connecting to Zeko L2 Devnet...');
  console.log(`  Endpoint: ${ZEKO_DEVNET_ENDPOINT}`);

  const network = Mina.Network({
    mina: ZEKO_DEVNET_ENDPOINT,
    archive: ZEKO_DEVNET_ENDPOINT,
  });
  Mina.setActiveInstance(network);

  logSuccess('Network configured');
}

// ==============================================================================
// ACCOUNT LOADING
// ==============================================================================

export function loadTestAccounts(): TestAccounts {
  logSection('🔑 Loading Test Accounts');

  const user1Key = process.env.USER_1_KEY;
  const user2Key = process.env.USER_2_KEY;
  const operatorKeyStr = process.env.OPERATOR_KEY;

  if (!user1Key || !user2Key || !operatorKeyStr) {
    logError('Missing required environment variables');
    console.error('  Required: USER_1_KEY, USER_2_KEY, OPERATOR_KEY');
    console.error('  Please check your .env file');
    process.exit(1);
  }

  try {
    const aliceKey = PrivateKey.fromBase58(user1Key);
    const bobKey = PrivateKey.fromBase58(user2Key);
    const operatorKey = PrivateKey.fromBase58(operatorKeyStr);

    const accounts = {
      alice: {
        key: aliceKey,
        address: aliceKey.toPublicKey(),
      },
      bob: {
        key: bobKey,
        address: bobKey.toPublicKey(),
      },
      operator: {
        key: operatorKey,
        address: operatorKey.toPublicKey(),
      },
    };

    console.log(`  Alice (USER_1): ${accounts.alice.address.toBase58()}`);
    console.log(`  Bob (USER_2): ${accounts.bob.address.toBase58()}`);
    console.log(`  Operator: ${accounts.operator.address.toBase58()}`);

    logSuccess('Accounts loaded successfully');

    return accounts;
  } catch (error) {
    logError('Failed to load accounts');
    console.error('  Error:', error);
    console.error('  Check that your private keys are valid Base58 strings');
    process.exit(1);
  }
}

// ==============================================================================
// CONTRACT COMPILATION
// ==============================================================================

export async function compileContract(): Promise<void> {
  logSection('⚙️  Contract Compilation');
  console.log('  This will take approximately 50 seconds...');
  console.log('  Compiling offchainState and MinaEscrowPool...');

  const startTime = Date.now();

  try {
    // CRITICAL ORDER: offchainState FIRST, then MinaEscrowPool
    console.log('  Step 1/2: Compiling offchainState...');
    await offchainState.compile();
    const offchainTime = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`    ✓ OffchainState compiled in ${offchainTime}s`);

    console.log('  Step 2/2: Compiling MinaEscrowPool...');
    await MinaEscrowPool.compile();

    const totalTime = ((Date.now() - startTime) / 1000).toFixed(2);
    logSuccess(`Compilation complete in ${totalTime}s`);
  } catch (error) {
    logError('Compilation failed');
    console.error('  Error:', error);
    process.exit(1);
  }
}

// ==============================================================================
// CONTRACT INSTANCE
// ==============================================================================

export function getContractInstance(): MinaEscrowPool {
  const zkAppAddress = PublicKey.fromBase58(CONTRACT_ADDRESS);
  const zkApp = new MinaEscrowPool(zkAppAddress);
  zkApp.offchainState.setContractInstance(zkApp); // REQUIRED
  return zkApp;
}

// ==============================================================================
// BALANCE TRACKING
// ==============================================================================

export async function getBalance(address: PublicKey): Promise<string> {
  try {
    await fetchAccount({ publicKey: address });
    const balance = Mina.getBalance(address);
    const minaBalance = Number(balance.toBigInt()) / 1e9;
    return minaBalance.toFixed(4);
  } catch (error) {
    // Account might not exist yet or network error
    return '0.0000';
  }
}

export async function logBalances(
  accounts: TestAccounts,
  contractAddress?: PublicKey
): Promise<void> {
  logSection('💰 Account Balances');

  const aliceBalance = await getBalance(accounts.alice.address);
  const bobBalance = await getBalance(accounts.bob.address);
  const operatorBalance = await getBalance(accounts.operator.address);

  console.log(`  Alice: ${aliceBalance} MINA`);
  console.log(`  Bob: ${bobBalance} MINA`);
  console.log(`  Operator: ${operatorBalance} MINA`);

  if (contractAddress) {
    const contractBalance = await getBalance(contractAddress);
    console.log(`  Contract: ${contractBalance} MINA`);
  }
}

// ==============================================================================
// WAIT HELPERS
// ==============================================================================

export async function waitForConfirmation(): Promise<void> {
  logSection('⏳ Waiting for Zeko L2 Confirmation');
  console.log('  Zeko L2 typically confirms in 10-25 seconds');
  console.log('  Waiting 20 seconds for confirmation...');

  const waitSeconds = ZEKO_CONFIRMATION_WAIT / 1000;
  for (let i = waitSeconds; i > 0; i -= 5) {
    console.log(`  ${i}s remaining...`);
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }

  logSuccess('Confirmation period complete');
}

// ==============================================================================
// FORMATTING HELPERS
// ==============================================================================

export function formatTxHash(hash: string): string {
  if (!hash) return 'N/A';
  return `${hash.slice(0, 10)}...${hash.slice(-10)}`;
}

export function formatAddress(address: string): string {
  if (!address) return 'N/A';
  return `${address.slice(0, 20)}...${address.slice(-10)}`;
}

export function formatTimestamp(timestamp?: number): string {
  const ts = timestamp || Date.now();
  return new Date(ts).toISOString();
}

export function minaToNano(mina: number): bigint {
  return BigInt(Math.floor(mina * 1e9));
}

export function nanoToMina(nano: bigint | string): number {
  const amount = typeof nano === 'string' ? BigInt(nano) : nano;
  return Number(amount) / 1e9;
}
