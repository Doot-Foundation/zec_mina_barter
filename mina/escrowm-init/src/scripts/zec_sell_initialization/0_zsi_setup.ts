import {
  setupNetwork,
  loadTestAccounts,
  compileContract,
  logBalances,
  logHeader,
  logSection,
  logSuccess,
  CONTRACT_ADDRESS,
} from '../shared/test-utils.js';
import {
  initializeTradeState,
  updateTradeState,
} from '../shared/state-manager.js';
import {
  generateMockZecTrade,
  logMockZecTrade,
  calculateMockZecAmount,
  logMockExchangeRate,
} from '../shared/mock-zec.js';
import { PublicKey } from 'o1js';

/**
 * Scenario 2 - ZEC Sell Initialization: Setup
 *
 * This script initializes the test scenario where Bob wants to sell ZEC for MINA.
 *
 * Steps:
 * 1. Setup network connection to Zeko L2
 * 2. Load test accounts (Alice, Bob, Operator)
 * 3. Compile MinaEscrowPool contract and offchain state
 * 4. Generate trade UUID
 * 5. Generate mock ZEC trade data (Alice selling ZEC to Bob)
 * 6. Initialize trade state file
 * 7. Log initial balances
 */

async function main() {
  logHeader('Scenario 2: ZEC Sell Initialization - Setup');

  console.log('📋 Scenario Overview:');
  console.log('  Bob wants to sell ZEC for MINA');
  console.log('  Alice wants to buy ZEC with MINA');
  console.log('  Alice deposits MINA → Operator locks → Bob claims MINA');
  console.log('  This is the HAPPY PATH test scenario (roles reversed)');

  // ============================================================================
  // STEP 1: Network Setup
  // ============================================================================

  setupNetwork();

  // ============================================================================
  // STEP 2: Load Accounts
  // ============================================================================

  const accounts = loadTestAccounts();

  // ============================================================================
  // STEP 3: Contract Compilation
  // ============================================================================

  await compileContract();

  // ============================================================================
  // STEP 4: Log Initial Balances
  // ============================================================================

  logSection('💰 Initial Account Balances');
  await logBalances(accounts, PublicKey.fromBase58(CONTRACT_ADDRESS));

  // ============================================================================
  // STEP 5: Initialize Trade State
  // ============================================================================

  logSection('📝 Initializing Trade State');

  const minaAmount = 4.0; // 4 MINA deposit (meets 0.001 ZEC minimum at 3600:1 rate)
  console.log(`  Alice will deposit: ${minaAmount} MINA`);

  const tradeState = initializeTradeState(
    accounts.alice.address.toBase58(), // Alice deposits MINA
    accounts.bob.address.toBase58(),   // Bob will claim MINA
    minaAmount,
    'zsi' // zec_sell_initialization scenario
  );

  // ============================================================================
  // SUMMARY
  // ============================================================================

  logSection('📊 Setup Summary');
  console.log(`  ✅ Network: Zeko L2 Devnet`);
  console.log(`  ✅ Contract: ${CONTRACT_ADDRESS}`);
  console.log(`  ✅ Compilation: Complete`);
  console.log(`  ✅ Trade ID: ${tradeState.tradeId}`);
  console.log(`  ✅ Alice (Depositor): ${accounts.alice.address.toBase58()}`);
  console.log(`  ✅ Bob (Claimant): ${accounts.bob.address.toBase58()}`);
  console.log(`  ✅ Operator: ${accounts.operator.address.toBase58()}`);
  console.log(`  ✅ Amount: ${minaAmount} MINA`);

  logSection('🎯 Next Step');
  console.log('  Run: node build/src/scripts/zec_sell_initialization/1_zsi_deposit.js');
  console.log('  This will execute Alice\'s deposit of 1 MINA to the escrow contract');
}

main()
  .then(() => {
    console.log('\n✅ Setup complete!\n');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Setup failed:', error);
    console.error('\nTroubleshooting:');
    console.error('  - Check that your .env file contains valid private keys');
    console.error('  - Ensure network connectivity to Zeko L2 Devnet');
    console.error('  - Verify that all accounts are funded with at least 50 MINA');
    process.exit(1);
  });
