import fs from 'fs';
import path from 'path';
import { Field } from 'o1js';
import { generateUUID, uuidToField } from '../../utils.js';
import { fileURLToPath } from 'url';

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
  zecTradeData?: {              // Mock ZEC trade data
    sellerAddress: string;
    buyerAddress: string;
    amount: string;             // Zatoshis as string
    txHash?: string;
    confirmations?: number;
  };
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

  if (state.zecTradeData) {
    console.log(`  🪙 ZEC Trade (MOCK):`);
    console.log(`    Seller: ${state.zecTradeData.sellerAddress}`);
    console.log(`    Buyer: ${state.zecTradeData.buyerAddress}`);
    console.log(`    Amount: ${Number(state.zecTradeData.amount) / 1e8} ZEC`);
    if (state.zecTradeData.txHash) {
      console.log(`    Tx: ${state.zecTradeData.txHash.slice(0, 10)}...${state.zecTradeData.txHash.slice(-10)}`);
      console.log(`    Confirmations: ${state.zecTradeData.confirmations}`);
    }
  }

  const elapsed = state.completedAt
    ? ((state.completedAt - state.createdAt) / 1000 / 60).toFixed(1)
    : 'In Progress';
  console.log(`  ⏱️  Duration: ${elapsed} ${typeof elapsed === 'string' ? '' : 'minutes'}`);
}
