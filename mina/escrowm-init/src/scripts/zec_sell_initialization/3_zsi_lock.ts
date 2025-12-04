import { Mina, Field, PublicKey, fetchAccount } from 'o1js';
import {
  setupNetwork,
  loadTestAccounts,
  compileContract,
  getContractInstance,
  logBalances,
  waitForConfirmation,
  logHeader,
  logSection,
  logSuccess,
  logInfo,
  logWarning,
  FEE,
  CONTRACT_ADDRESS,
} from '../shared/test-utils.js';
import {
  loadTradeState,
  updateTradeState,
  displayTradeState,
  cleanupFailedTrade,
} from '../shared/state-manager.js';
import {
  ensureMiddlewareRunning,
  spawnEscrowdInstance,
  getEscrowdStatus,
  promptUserToFundZec,
  calculateZecFromOracle,
  generateApiKey,
} from '../shared/real-zec.js';

/**
 * Scenario 2 - ZEC Sell Initialization: Lock Trade
 *
 * Operator locks the trade for Bob after simulating ZEC confirmation.
 *
 * Steps:
 * 1. Setup network
 * 2. Compile contract
 * 3. Load trade state
 * 4. Simulate ZEC confirmation (mock)
 * 5. Operator locks trade for Bob (claimant)
 * 6. Wait for confirmation
 * 7. Update state with lock transaction hash
 * 8. Log balances after lock
 */

async function main() {
  logHeader('Scenario 2: ZEC Sell - Step 3: Lock Trade');

  // ============================================================================
  // STEP 1: Network Setup
  // ============================================================================

  setupNetwork();

  // ============================================================================
  // STEP 2: Load Accounts
  // ============================================================================

  const accounts = loadTestAccounts();

  // ============================================================================
  // STEP 3: Compile Contract
  // ============================================================================

  await compileContract();

  // ============================================================================
  // STEP 4: Load Trade State
  // ============================================================================

  logSection('📂 Loading Trade State');
  const state = loadTradeState('zsi');
  displayTradeState('zsi');

  // ============================================================================
  // STEP 5: Spawn escrowdv2 Instance via Middleware
  // ============================================================================

  logSection('🚀 Spawning escrowdv2 Instance');

  try {
    // Check middleware is running
    await ensureMiddlewareRunning();
    logSuccess('Middleware is accessible');

    // Generate unique API key for this trade
    const apiKey = generateApiKey();
    console.log(`  Generated API Key: ${apiKey}`);

    // Spawn escrowdv2 instance via middleware API
    console.log(`  Calling middleware: POST /api/spawn-escrowd`);
    const spawnResult = await spawnEscrowdInstance(state.tradeId, apiKey);

    if (!spawnResult.success) {
      throw new Error('Failed to spawn escrowdv2 instance');
    }

    console.log(`  ✅ escrowdv2 spawned on port: ${spawnResult.port}`);
    console.log(`  ✅ ZEC Escrow Address: ${spawnResult.address}`);

    // Update state with escrowdv2 details
    updateTradeState('zsi', {
      escrowdApiKey: apiKey,
      escrowdPort: spawnResult.port,
      escrowdAddress: spawnResult.address,
    });

  } catch (err: any) {
    console.error('❌ Failed to spawn escrowdv2:', err.message);
    const currentState = loadTradeState('zsi');
    await cleanupFailedTrade('zsi', currentState);
    process.exit(1);
  }

  // ============================================================================
  // STEP 6: User Funds ZEC Escrow (MANUAL STEP)
  // ============================================================================

  logSection('🪙 Funding ZEC Escrow');

  try {
    const currentState = loadTradeState('zsi');

    // Calculate expected ZEC amount from oracle
    const minaAmount = Number(currentState.amount) / 1e9;  // Convert from nanomina
    const expectedZec = await calculateZecFromOracle(minaAmount);

    console.log(`  MINA Amount: ${minaAmount} MINA`);
    console.log(`  Expected ZEC: ${expectedZec.toFixed(8)} ZEC`);
    console.log(`  Exchange Rate: ${(expectedZec / minaAmount).toFixed(8)} ZEC per MINA`);

    // Prompt user to send ZEC (uses account 1 for ZSI)
    await promptUserToFundZec(
      currentState.escrowdAddress!,
      expectedZec,
      currentState.escrowdApiKey!,
      1,  // Use zcashd account 1 (different from MSI which uses 0)
      currentState.escrowdPort!
    );

    // Verify funding was successful
    const status = await getEscrowdStatus(currentState.tradeId, currentState.escrowdPort!);

    if (!status.verified) {
      throw new Error('ZEC funding verification failed');
    }

    console.log(`  ✅ ZEC Escrow Verified!`);
    console.log(`  Origin Address: ${status.origin_address}`);
    console.log(`  Received Amount: ${status.received_amount} zatoshis`);

    // Update state
    updateTradeState('zsi', {
      escrowdVerified: true,
      escrowdOriginAddress: status.origin_address,
    });

  } catch (err: any) {
    console.error('❌ ZEC funding failed:', err.message);
    const currentState = loadTradeState('zsi');
    await cleanupFailedTrade('zsi', currentState);
    process.exit(1);
  }

  // ============================================================================
  // STEP 7: Wait for Middleware to Lock Both Sides
  // ============================================================================

  logSection('🔒 Waiting for Middleware to Lock Trade');

  console.log('  ℹ️  Middleware polling will detect:');
  console.log('     1. MINA deposit confirmed (from step 1)');
  console.log('     2. ZEC escrow verified (just completed)');
  console.log('     3. Automatically lock both sides');
  console.log('');
  console.log('  ⏳ Polling every 5 seconds... (max 5 minutes)');

  try {
    const currentState = loadTradeState('zsi');
    let attempts = 0;
    const maxAttempts = 60;  // 5 minutes

    while (attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 5000));  // 5 seconds
      attempts++;

      // Check escrowdv2 status
      const status = await getEscrowdStatus(currentState.tradeId, currentState.escrowdPort!);

      if (status.in_transit) {
        console.log(`\n  ✅ Trade locked by middleware!`);
        updateTradeState('zsi', { escrowdInTransit: true });
        break;
      }

      process.stdout.write(`  ⏳ Attempt ${attempts}/${maxAttempts}...\r`);
    }

    if (attempts >= maxAttempts) {
      throw new Error('Timeout waiting for middleware to lock trade');
    }

  } catch (err: any) {
    console.error('❌ Lock coordination failed:', err.message);
    const currentState = loadTradeState('zsi');
    await cleanupFailedTrade('zsi', currentState);
    process.exit(1);
  }

  logSuccess('Both sides locked atomically by middleware!');

  // ============================================================================
  // SUMMARY
  // ============================================================================

  const finalState = loadTradeState('zsi');

  logSection('📊 Lock Summary');
  console.log(`  ✅ Trade ID: ${finalState.tradeId}`);
  console.log(`  ✅ escrowdv2 Port: ${finalState.escrowdPort}`);
  console.log(`  ✅ escrowdv2 Address: ${finalState.escrowdAddress?.slice(0, 20)}...${finalState.escrowdAddress?.slice(-20)}`);
  console.log(`  ✅ ZEC Verified: ${finalState.escrowdVerified ? 'Yes' : 'No'}`);
  console.log(`  ✅ In Transit: ${finalState.escrowdInTransit ? 'Yes' : 'No'}`);
  console.log(`  ✅ Amount: ${Number(finalState.amount) / 1e9} MINA`);
  console.log(`  ✅ Real ZEC integration complete!`);

  logSection('🎯 Next Step');
  console.log('  Run: node build/src/scripts/zec_sell_initialization/4_zsi_claim.js');
  console.log('  This will execute Bob\'s claim of the locked MINA');
  console.log('  After claim, middleware will automatically send ZEC to Bob');
}

main()
  .then(() => {
    console.log('\n✅ Lock complete!\n');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Lock failed:', error);
    console.error('\nTroubleshooting:');
    console.error('  - Ensure previous step (deposit) completed successfully');
    console.error('  - Check that Operator has sufficient balance');
    console.error('  - Verify network connectivity to Zeko L2');
    console.error('  - Check that trade state file exists');
    process.exit(1);
  });
