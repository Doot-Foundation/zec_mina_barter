import fs from 'fs';
import path from 'path';
import { Field } from 'o1js';
import { generateUUID, uuidToField } from '../../utils.js';
import { fileURLToPath } from 'url';
import { killEscrowdInstance } from './real-zec.js';

// Get directory name for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ==============================================================================
// STATE FILE PATHS
// ==============================================================================

const STATE_DIR = path.join(__dirname, '..', '.state');
const MSI_STATE_FILE = path.join(STATE_DIR, 'mina_sell_state.json');
const ZSI_STATE_FILE = path.join(STATE_DIR, 'zec_sell_state.json');

// ==============================================================================
// TYPE DEFINITIONS
// ==============================================================================

export interface TradeState {
  tradeId: string;              // UUID
  tradeIdField: string;         // Field as string (for serialization)
  depositor: string;            // PublicKey base58
  claimant: string;             // PublicKey base58
  amount: string;               // Amount in nanomina
  depositTxHash?: string;       // Transaction hash from deposit
  lockTxHash?: string;          // Transaction hash from lock
  claimTxHash?: string;         // Transaction hash from claim
  settleTxHash?: string;        // Transaction hash from settle

  // Real ZEC escrowdv2 integration fields
  escrowdApiKey?: string;          // Unique API key for this trade
  escrowdPort?: number;            // Port where escrowdv2 is running (8000-18000)
  escrowdAddress?: string;         // ZEC unified address (utest1...)
  escrowdVerified?: boolean;       // ZEC funding confirmed
  escrowdInTransit?: boolean;      // Escrow locked
  escrowdOriginAddress?: string;   // Where ZEC came from (for refunds)

  createdAt: number;            // Timestamp
  completedAt?: number;         // Timestamp
}

// ==============================================================================
// DIRECTORY MANAGEMENT
// ==============================================================================

function ensureStateDir(): void {
  if (!fs.existsSync(STATE_DIR)) {
    fs.mkdirSync(STATE_DIR, { recursive: true });
  }
}

// ==============================================================================
// STATE INITIALIZATION
// ==============================================================================

export function initializeTradeState(
  depositor: string,
  claimant: string,
  minaAmount: number,
  scenario: 'msi' | 'zsi'
): TradeState {
  ensureStateDir();

  const tradeId = generateUUID();
  const tradeIdField = uuidToField(tradeId);

  const state: TradeState = {
    tradeId,
    tradeIdField: tradeIdField.toString(),
    depositor,
    claimant,
    amount: (minaAmount * 1e9).toString(),
    createdAt: Date.now(),
  };

  const filePath = scenario === 'msi' ? MSI_STATE_FILE : ZSI_STATE_FILE;
  fs.writeFileSync(filePath, JSON.stringify(state, null, 2));

  console.log(`\n📝 Trade State Initialized:`);
  console.log(`  Trade ID: ${tradeId}`);
  console.log(`  Depositor: ${depositor.slice(0, 20)}...`);
  console.log(`  Claimant: ${claimant.slice(0, 20)}...`);
  console.log(`  Amount: ${minaAmount} MINA (${state.amount} nanomina)`);
  console.log(`  State file: ${filePath}`);

  return state;
}

// ==============================================================================
// STATE LOADING
// ==============================================================================

export function loadTradeState(scenario: 'msi' | 'zsi'): TradeState {
  const filePath = scenario === 'msi' ? MSI_STATE_FILE : ZSI_STATE_FILE;

  if (!fs.existsSync(filePath)) {
    console.error(`❌ Trade state file not found: ${filePath}`);
    console.error('   Please run the setup script (0_msi_setup.ts or 0_zsi_setup.ts) first');
    process.exit(1);
  }

  try {
    const state = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as TradeState;
    console.log(`\n📂 Loaded Trade State:`);
    console.log(`  Trade ID: ${state.tradeId}`);
    console.log(`  Created: ${new Date(state.createdAt).toLocaleString()}`);

    return state;
  } catch (error) {
    console.error(`❌ Failed to load trade state from ${filePath}`);
    console.error('   Error:', error);
    process.exit(1);
  }
}

// ==============================================================================
// STATE UPDATES
// ==============================================================================

export function updateTradeState(
  scenario: 'msi' | 'zsi',
  updates: Partial<TradeState>
): TradeState {
  const state = loadTradeState(scenario);
  const updatedState = { ...state, ...updates };

  const filePath = scenario === 'msi' ? MSI_STATE_FILE : ZSI_STATE_FILE;
  fs.writeFileSync(filePath, JSON.stringify(updatedState, null, 2));

  console.log(`✅ Trade state updated`);

  return updatedState;
}

// ==============================================================================
// TRADE ID RETRIEVAL
// ==============================================================================

export function getTradeIdField(scenario: 'msi' | 'zsi'): Field {
  const state = loadTradeState(scenario);
  return Field.from(state.tradeIdField);
}

// ==============================================================================
// TRADE COMPLETION
// ==============================================================================

export function completeTradeState(scenario: 'msi' | 'zsi'): void {
  updateTradeState(scenario, { completedAt: Date.now() });
  console.log(`\n🎉 Trade marked as completed`);
}

// ==============================================================================
// STATE CLEANUP
// ==============================================================================

export function cleanupStateFiles(): void {
  ensureStateDir();
  const files = [MSI_STATE_FILE, ZSI_STATE_FILE];

  for (const file of files) {
    if (fs.existsSync(file)) {
      fs.unlinkSync(file);
      console.log(`🗑️  Removed state file: ${file}`);
    }
  }
}

// ==============================================================================
// CLEANUP FAILED TRADE
// ==============================================================================

export async function cleanupFailedTrade(
  scenario: 'msi' | 'zsi',
  state: TradeState
): Promise<void> {
  console.log('\n🧹 Cleaning up failed trade...');

  // 1. Kill escrowdv2 instance if running
  if (state.escrowdPort) {
    console.log('  Stopping escrowdv2 instance...');
    await killEscrowdInstance(state.tradeId);
  }

  // 2. Emergency unlock on MINA if locked
  if (state.lockTxHash) {
    console.log('  ⚠️  Trade was locked on MINA side');
    console.log('  ⚠️  Manual recovery needed: Call emergencyUnlock on MINA contract');
    console.log(`  ⚠️  Trade ID Field: ${state.tradeIdField}`);
    console.log('  ⚠️  This will release the locked MINA funds');
  }

  // 3. Mark trade as failed in state file
  state.completedAt = Date.now();
  updateTradeState(scenario, state);

  console.log('  ✅ Cleanup complete');
  console.log('  ℹ️  State file preserved for debugging');
}

// ==============================================================================
// STATE DISPLAY
// ==============================================================================

export function displayTradeState(scenario: 'msi' | 'zsi'): void {
  const state = loadTradeState(scenario);

  console.log(`\n📊 Trade State Summary:`);
  console.log(`  Trade ID: ${state.tradeId}`);
  console.log(`  Amount: ${Number(state.amount) / 1e9} MINA`);
  console.log(`  Depositor: ${state.depositor.slice(0, 20)}...`);
  console.log(`  Claimant: ${state.claimant.slice(0, 20)}...`);

  if (state.depositTxHash) {
    console.log(`  ✅ Deposit Tx: ${state.depositTxHash.slice(0, 10)}...${state.depositTxHash.slice(-10)}`);
  }
  if (state.lockTxHash) {
    console.log(`  ✅ Lock Tx: ${state.lockTxHash.slice(0, 10)}...${state.lockTxHash.slice(-10)}`);
  }
  if (state.claimTxHash) {
    console.log(`  ✅ Claim Tx: ${state.claimTxHash.slice(0, 10)}...${state.claimTxHash.slice(-10)}`);
  }
  if (state.settleTxHash) {
    console.log(`  ✅ Settle Tx: ${state.settleTxHash.slice(0, 10)}...${state.settleTxHash.slice(-10)}`);
  }

  if (state.escrowdPort) {
    console.log(`  🪙 ZEC escrowdv2 Instance:`);
    console.log(`    Port: ${state.escrowdPort}`);
    if (state.escrowdAddress) {
      console.log(`    Address: ${state.escrowdAddress.slice(0, 20)}...${state.escrowdAddress.slice(-20)}`);
    }
    if (state.escrowdApiKey) {
      console.log(`    API Key: ${state.escrowdApiKey}`);
    }
    if (state.escrowdVerified !== undefined) {
      console.log(`    Verified: ${state.escrowdVerified ? '✅' : '❌'}`);
    }
    if (state.escrowdInTransit !== undefined) {
      console.log(`    In Transit: ${state.escrowdInTransit ? '✅' : '❌'}`);
    }
    if (state.escrowdOriginAddress) {
      console.log(`    Origin: ${state.escrowdOriginAddress.slice(0, 20)}...${state.escrowdOriginAddress.slice(-20)}`);
    }
  }

  const elapsed = state.completedAt
    ? ((state.completedAt - state.createdAt) / 1000 / 60).toFixed(1)
    : 'In Progress';
  console.log(`  ⏱️  Duration: ${elapsed} ${typeof elapsed === 'string' ? '' : 'minutes'}`);
}
