import { Mina, Field, PublicKey, fetchAccount } from 'o1js';
import {
  setupNetwork,
  loadTestAccounts,
  compileContract,
  getContractInstance,
  getBalance,
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
} from '../shared/state-manager.js';

/**
 * Scenario 1 - MINA Sell Initialization: Claim
 *
 * Bob claims the locked MINA after Alice received ZEC.
 *
 * Steps:
 * 1. Setup network
 * 2. Compile contract
 * 3. Load trade state
 * 4. Log pre-claim balances
 * 5. Bob claims the MINA
 * 6. Wait for confirmation
 * 7. Update state with claim transaction hash
 * 8. Log post-claim balances
 * 9. Verify balance changes
 */

async function main() {
  logHeader('Scenario 1: MINA Sell - Step 4: Claim');

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
  const state = loadTradeState('msi');
  displayTradeState('msi');

  // ============================================================================
  // STEP 5: Pre-Claim Balances
  // ============================================================================

  logSection('💰 Pre-Claim Balances');

  // Get balances before logging
  const bobPreBalance = parseFloat(await getBalance(accounts.bob.address));
  const contractPreBalance = parseFloat(await getBalance(PublicKey.fromBase58(CONTRACT_ADDRESS)));

  // Log all balances
  await logBalances(accounts, PublicKey.fromBase58(CONTRACT_ADDRESS));

  // ============================================================================
  // STEP 6: Prepare Claim
  // ============================================================================

  logSection('💸 Preparing Claim Transaction');

  const zkApp = getContractInstance();
  const tradeIdField = Field.from(state.tradeIdField);

  console.log(`  Trade ID: ${state.tradeId}`);
  console.log(`  Claimant: Bob (${accounts.bob.address.toBase58()})`);
  console.log(`  Amount to Claim: ${Number(state.amount) / 1e9} MINA`);
  console.log(`  Fee: ${FEE / 1e9} MINA`);

  // ============================================================================
  // STEP 7: Build Transaction
  // ============================================================================

  logInfo('Building claim transaction...');

  const txn = await Mina.transaction(
    { sender: accounts.bob.address, fee: FEE },
    async () => {
      await zkApp.claim(tradeIdField);
    }
  );

  logSuccess('Transaction built');

  // ============================================================================
  // STEP 8: Prove Transaction
  // ============================================================================

  logInfo('Generating transaction proof (this may take a moment)...');
  await txn.prove();
  logSuccess('Proof generated');

  // ============================================================================
  // STEP 9: Sign and Send Transaction
  // ============================================================================

  logInfo('Signing transaction with Bob\'s key...');
  const sentTx = await txn.sign([accounts.bob.key]).send();

  logSection('✅ Transaction Sent');
  console.log(`  Transaction Hash: ${sentTx.hash}`);
  console.log(`  Explorer: https://zekoscan.io/testnet/tx/${sentTx.hash}`);

  // Update state with claim transaction hash
  updateTradeState('msi', { claimTxHash: sentTx.hash });

  // ============================================================================
  // STEP 10: Wait for Confirmation
  // ============================================================================

  await waitForConfirmation();

  // ============================================================================
  // STEP 11: Post-Claim Balances
  // ============================================================================

  logSection('💰 Post-Claim Balances');

  // Get balances after claim
  const bobPostBalance = parseFloat(await getBalance(accounts.bob.address));
  const contractPostBalance = parseFloat(await getBalance(PublicKey.fromBase58(CONTRACT_ADDRESS)));

  // Log all balances
  await logBalances(accounts, PublicKey.fromBase58(CONTRACT_ADDRESS));

  // ============================================================================
  // STEP 12: Verify Balance Changes
  // ============================================================================

  logSection('📊 Balance Change Analysis');

  const bobChange = bobPostBalance - bobPreBalance;
  const contractChange = contractPostBalance - contractPreBalance;
  const expectedClaim = Number(state.amount) / 1e9;
  const feeAmount = FEE / 1e9;

  console.log(`  Bob's balance change: ${bobChange > 0 ? '+' : ''}${bobChange.toFixed(9)} MINA`);
  console.log(`  Contract balance change: ${contractChange > 0 ? '+' : ''}${contractChange.toFixed(9)} MINA`);

  console.log(`\n  Expected:`)
  console.log(`    Bob receives: ${expectedClaim} MINA`);
  console.log(`    Bob pays fee: ${feeAmount} MINA`);
  console.log(`    Bob net change: ~${(expectedClaim - feeAmount).toFixed(9)} MINA`);
  console.log(`    Contract releases: ${expectedClaim} MINA`);

  // Verify the changes are approximately correct (allowing for small differences)
  const bobExpectedChange = expectedClaim - feeAmount;
  const bobChangeDiff = Math.abs(bobChange - bobExpectedChange);
  const contractExpectedChange = -expectedClaim;
  const contractChangeDiff = Math.abs(contractChange - contractExpectedChange);

  console.log(`\n  Verification:`);

  if (bobChangeDiff < 0.5) {
    logSuccess(`Bob's balance change matches expected (~${bobExpectedChange.toFixed(9)} MINA)`);
  } else {
    logWarning(`Bob's balance change differs from expected`);
    console.log(`    Difference: ${bobChangeDiff.toFixed(9)} MINA`);
  }

  if (contractChangeDiff < 0.1) {
    logSuccess(`Contract balance change matches expected (${contractExpectedChange.toFixed(9)} MINA)`);
  } else {
    logWarning(`Contract balance change differs from expected`);
    console.log(`    Difference: ${contractChangeDiff.toFixed(9)} MINA`);
  }

  // ============================================================================
  // STEP 13: Query Offchain State
  // ============================================================================

  logSection('🔍 Querying Offchain State');
  console.log('  Attempting to verify trade completion...');

  try {
    const trade = await zkApp.offchainState.fields.trades.get(tradeIdField);

    if (!trade.isSome.toBoolean()) {
      logWarning('Trade not found in offchain state');
      console.log('  This is EXPECTED if settlement hasn\'t occurred yet');
      console.log('  The claim transaction was successful - continue to settlement');
    } else {
      const tradeData = trade.value;
      logSuccess('Trade found in offchain state!');

      console.log(`  Completed: ${tradeData.completed.toBoolean()}`);
      console.log(`  Amount: ${tradeData.amount.toString()} nanomina`);
      console.log(`  Claimant: ${tradeData.claimant.toBase58()}`);

      if (tradeData.completed.toBoolean()) {
        logSuccess('Trade marked as completed in offchain state');
      } else {
        console.log('  Trade not yet marked as completed (requires settlement)');
      }
    }
  } catch (error) {
    logWarning('Failed to query offchain state');
    console.log('  Error:', error);
    console.log('  This may be expected if settlement hasn\'t occurred yet');
    console.log('  The claim transaction was successful - continue to settlement');
  }

  // ============================================================================
  // STEP 14: Generate Settlement Proof
  // ============================================================================

  logSection('⚡ Generating Settlement Proof');
  console.log('  ⚠️  Settlement proof generation takes 5-6 minutes');
  console.log('  This commits the claim to offchain state');
  console.log('  Please be patient...\n');

  logInfo('Starting proof generation...');
  console.log(`  Started at: ${new Date().toLocaleTimeString()}`);

  const proofStartTime = Date.now();
  const settlementProof = await zkApp.offchainState.createSettlementProof();
  const proofDuration = ((Date.now() - proofStartTime) / 1000 / 60).toFixed(2);

  logSuccess(`Settlement proof generated in ${proofDuration} minutes`);
  console.log(`  Completed at: ${new Date().toLocaleTimeString()}`);

  // ============================================================================
  // STEP 15: Submit Settlement Transaction
  // ============================================================================

  logSection('📤 Submitting Settlement Transaction');

  // Fetch latest account state to ensure fresh nonce
  logInfo('Fetching latest Operator account state...');
  await fetchAccount({ publicKey: accounts.operator.address });

  logInfo('Building settlement transaction...');
  const settleTxn = await Mina.transaction(
    { sender: accounts.operator.address, fee: FEE },
    async () => {
      await zkApp.settle(settlementProof);
    }
  );

  logSuccess('Transaction built');

  logInfo('Generating transaction proof...');
  await settleTxn.prove();
  logSuccess('Transaction proof generated');

  logInfo('Signing transaction with Operator key...');
  const settleSentTx = await settleTxn.sign([accounts.operator.key]).send();

  logSection('✅ Settlement Transaction Sent');
  console.log(`  Transaction Hash: ${settleSentTx.hash}`);
  console.log(`  Explorer: https://zekoscan.io/testnet/tx/${settleSentTx.hash}`);

  updateTradeState('msi', { settleTxHash: settleSentTx.hash });

  // ============================================================================
  // STEP 16: Wait for Settlement Confirmation
  // ============================================================================

  await waitForConfirmation();

  logSuccess('Claim settled on-chain - offchain state is now queryable');

  // ============================================================================
  // SUMMARY
  // ============================================================================

  logSection('📊 Claim Summary');
  console.log(`  ✅ Trade ID: ${state.tradeId}`);
  console.log(`  ✅ Claim transaction: ${sentTx.hash.slice(0, 10)}...${sentTx.hash.slice(-10)}`);
  console.log(`  ✅ Settlement transaction: ${settleSentTx.hash.slice(0, 10)}...${settleSentTx.hash.slice(-10)}`);
  console.log(`  ✅ Bob claimed: ${expectedClaim} MINA`);
  console.log(`  ✅ Bob's net change: ${bobChange > 0 ? '+' : ''}${bobChange.toFixed(9)} MINA (including fees)`);
  console.log(`  ✅ Contract released: ${Math.abs(contractChange).toFixed(9)} MINA`);
  console.log(`  ✅ Offchain state settled and queryable`);

  logSection('🎯 Next Step');
  console.log('  Run: node build/src/scripts/mina_sell_initialization/6_msi_verify_final.js');
  console.log('  This will perform final verification of the completed swap');
}

main()
  .then(() => {
    console.log('\n✅ Claim complete!\n');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Claim failed:', error);
    console.error('\nTroubleshooting:');
    console.error('  - Ensure previous step (lock) completed successfully');
    console.error('  - Check that Bob has sufficient balance for fees');
    console.error('  - Verify Bob is the correct claimant for this trade');
    console.error('  - Ensure trade is locked (inTransit = true)');
    console.error('  - Check network connectivity to Zeko L2');
    process.exit(1);
  });
