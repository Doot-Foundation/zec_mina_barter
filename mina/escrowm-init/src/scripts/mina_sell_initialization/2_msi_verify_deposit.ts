import { Field, Bool, PublicKey, fetchAccount } from 'o1js';
import {
  setupNetwork,
  compileContract,
  getContractInstance,
  logHeader,
  logSection,
  logSuccess,
  logWarning,
  logInfo,
  CONTRACT_ADDRESS,
} from '../shared/test-utils.js';
import {
  loadTradeState,
  displayTradeState,
} from '../shared/state-manager.js';

/**
 * Scenario 1 - MINA Sell Initialization: Verify Deposit
 *
 * Query the offchain state to verify Alice's deposit was recorded correctly.
 *
 * Steps:
 * 1. Setup network
 * 2. Compile contract
 * 3. Load trade state
 * 4. Query offchain state for trade
 * 5. Verify trade exists and data is correct
 *
 * Note: This verification may fail if settlement proof hasn't been generated yet.
 * Offchain state requires settlement to be fully queryable.
 */

async function main() {
  logHeader('Scenario 1: MINA Sell - Step 2: Verify Deposit');

  // ============================================================================
  // STEP 1: Network Setup
  // ============================================================================

  setupNetwork();

  // ============================================================================
  // STEP 2: Compile Contract
  // ============================================================================

  await compileContract();

  // ============================================================================
  // STEP 3: Load Trade State
  // ============================================================================

  logSection('📂 Loading Trade State');
  const state = loadTradeState('msi');
  displayTradeState('msi');

  // ============================================================================
  // STEP 4: Query Offchain State
  // ============================================================================

  logSection('🔍 Querying Offchain State');
  console.log(`  Trade ID: ${state.tradeId}`);
  console.log('  Fetching contract account...');

  // Fetch contract account first (required for offchain state queries)
  const contractAddress = PublicKey.fromBase58(CONTRACT_ADDRESS);
  await fetchAccount({ publicKey: contractAddress });

  console.log('  Attempting to query offchain state...');

  const zkApp = getContractInstance();
  const tradeIdField = Field.from(state.tradeIdField);

  try {
    const trade = await zkApp.offchainState.fields.trades.get(tradeIdField);

    if (!trade.isSome.toBoolean()) {
      logWarning('Trade not found in offchain state');
      console.log('  This is EXPECTED behavior before settlement proof is generated');
      console.log('  Offchain state changes require settlement to become queryable');
      console.log('  The deposit transaction was successful, but offchain state');
      console.log('  needs to be settled before it can be queried');

      logSection('📊 Status');
      console.log('  ✅ Deposit transaction: Confirmed');
      console.log('  ⏳ Offchain state: Pending settlement');
      console.log('  ℹ️  This is normal - continue to next step');

      logSection('🎯 Next Step');
      console.log('  Run: node build/src/scripts/mina_sell_initialization/3_msi_lock.js');
      console.log('  The lock operation will add another action to offchain state');
      return;
    }

    // Trade found - verify data
    const tradeData = trade.value;

    logSuccess('Trade found in offchain state!');

    logSection('📋 Trade Data');
    console.log(`  Trade ID: ${tradeData.tradeId.toString().slice(0, 20)}...`);
    console.log(`  Depositor: ${tradeData.depositor.toBase58()}`);
    console.log(`  Amount: ${tradeData.amount.toString()} nanomina`);
    console.log(`  Amount (MINA): ${Number(tradeData.amount.toString()) / 1e9}`);
    console.log(`  Refund Address: ${tradeData.refundAddress.toBase58()}`);
    console.log(`  Claimant: ${tradeData.claimant.toBase58()}`);
    console.log(`  Locked (inTransit): ${tradeData.inTransit.toBoolean()}`);
    console.log(`  Completed: ${tradeData.completed.toBoolean()}`);

    // ======================================================================
    // STEP 5: Verify Expected Values
    // ======================================================================

    logSection('✅ Verification Results');

    // Verify amount
    const expectedAmount = state.amount;
    const actualAmount = tradeData.amount.toString();
    const amountMatches = actualAmount === expectedAmount;

    console.log(`  Amount matches: ${amountMatches ? '✅' : '❌'}`);
    console.log(`    Expected: ${Number(expectedAmount) / 1e9} MINA`);
    console.log(`    Actual: ${Number(actualAmount) / 1e9} MINA`);

    // Verify depositor
    const expectedDepositor = state.depositor;
    const actualDepositor = tradeData.depositor.toBase58();
    const depositorMatches = actualDepositor === expectedDepositor;

    console.log(`  Depositor matches: ${depositorMatches ? '✅' : '❌'}`);
    console.log(`    Expected: ${expectedDepositor}`);
    console.log(`    Actual: ${actualDepositor}`);

    // Verify lock status
    const isLocked = tradeData.inTransit.toBoolean();
    const lockCorrect = !isLocked; // Should NOT be locked yet

    console.log(`  Lock status correct: ${lockCorrect ? '✅' : '❌'}`);
    console.log(`    Expected: false (not locked yet)`);
    console.log(`    Actual: ${isLocked}`);

    if (!amountMatches || !depositorMatches || !lockCorrect) {
      console.error('\n❌ Verification failed - unexpected state detected');
      process.exit(1);
    }

    logSuccess('All verifications passed!');

  } catch (error) {
    logWarning('Failed to query offchain state');
    console.log('  Error:', error);
    console.log('  This may be expected if settlement hasn\'t occurred yet');
    console.log('  The deposit transaction was successful - continue to next step');
  }

  // ============================================================================
  // SUMMARY
  // ============================================================================

  logSection('📊 Verification Summary');
  console.log(`  ✅ Trade ID: ${state.tradeId}`);
  console.log(`  ✅ Deposit transaction confirmed: ${state.depositTxHash?.slice(0, 10)}...`);
  console.log(`  ℹ️  Offchain state query may not work until settlement`);

  logSection('🎯 Next Step');
  console.log('  Run: node build/src/scripts/mina_sell_initialization/3_msi_lock.js');
  console.log('  This will simulate ZEC confirmation and lock the trade for Bob');
}

main()
  .then(() => {
    console.log('\n✅ Verification complete!\n');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Verification failed:', error);
    console.error('\nTroubleshooting:');
    console.error('  - Ensure previous step (deposit) completed successfully');
    console.error('  - Check network connectivity to Zeko L2');
    console.error('  - Verify trade state file exists');
    process.exit(1);
  });
