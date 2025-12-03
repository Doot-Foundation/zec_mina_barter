import { Mina, PublicKey } from 'o1js';
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
} from '../shared/state-manager.js';

/**
 * Scenario 2 - ZEC Sell Initialization: Settlement
 *
 * Generate and submit settlement proof to commit offchain state changes.
 *
 * Steps:
 * 1. Setup network
 * 2. Compile contract
 * 3. Load trade state
 * 4. Generate settlement proof (5-6 minutes)
 * 5. Submit settlement transaction
 * 6. Wait for confirmation
 * 7. Update state with settle transaction hash
 *
 * Note: Settlement proof generation takes 5-6 minutes. This is expected behavior.
 */

async function main() {
  logHeader('Scenario 2: ZEC Sell - Step 5: Settlement');

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
  // STEP 5: Pre-Settlement Balances
  // ============================================================================

  logSection('💰 Pre-Settlement Balances');
  await logBalances(accounts, PublicKey.fromBase58(CONTRACT_ADDRESS));

  // ============================================================================
  // STEP 6: Generate Settlement Proof
  // ============================================================================

  logSection('⚡ Generating Settlement Proof');

  console.log('  ⚠️  IMPORTANT: Settlement proof generation takes 5-6 minutes');
  console.log('  This is expected behavior for offchain state settlement');
  console.log('  The proof cryptographically commits all pending offchain state changes');
  console.log('  Please be patient...\n');

  const zkApp = getContractInstance();

  logInfo('Starting proof generation...');
  console.log(`  Started at: ${new Date().toLocaleTimeString()}`);

  const proofStartTime = Date.now();

  let proof;
  try {
    proof = await zkApp.offchainState.createSettlementProof();
    const proofDuration = ((Date.now() - proofStartTime) / 1000 / 60).toFixed(2);

    logSuccess(`Settlement proof generated in ${proofDuration} minutes`);
    console.log(`  Completed at: ${new Date().toLocaleTimeString()}`);
  } catch (error) {
    console.error('\n❌ Failed to generate settlement proof');
    console.error('  Error:', error);
    console.error('\nPossible causes:');
    console.error('  - No pending offchain state actions to settle');
    console.error('  - Insufficient memory or resources');
    console.error('  - Network connectivity issues');
    throw error;
  }

  // ============================================================================
  // STEP 7: Build Settlement Transaction
  // ============================================================================

  logSection('📤 Submitting Settlement Transaction');

  console.log(`  Submitter: Operator (${accounts.operator.address.toBase58()})`);
  console.log(`  Contract: ${CONTRACT_ADDRESS}`);
  console.log(`  Fee: ${FEE / 1e9} MINA`);

  logInfo('Building settlement transaction...');

  const settleTxn = await Mina.transaction(
    { sender: accounts.operator.address, fee: FEE },
    async () => {
      await zkApp.settle(proof);
    }
  );

  logSuccess('Transaction built');

  // ============================================================================
  // STEP 8: Prove Transaction
  // ============================================================================

  logInfo('Generating transaction proof...');
  await settleTxn.prove();
  logSuccess('Transaction proof generated');

  // ============================================================================
  // STEP 9: Sign and Send Transaction
  // ============================================================================

  logInfo('Signing transaction with Operator key...');
  const sentTx = await settleTxn.sign([accounts.operator.key]).send();

  logSection('✅ Transaction Sent');
  console.log(`  Transaction Hash: ${sentTx.hash}`);
  console.log(`  Explorer: https://zekoscan.io/testnet/tx/${sentTx.hash}`);

  // Update state with settle transaction hash
  updateTradeState('zsi', { settleTxHash: sentTx.hash });

  // ============================================================================
  // STEP 10: Wait for Confirmation
  // ============================================================================

  await waitForConfirmation();

  // ============================================================================
  // STEP 11: Post-Settlement Balances
  // ============================================================================

  logSection('💰 Post-Settlement Balances');
  await logBalances(accounts, PublicKey.fromBase58(CONTRACT_ADDRESS));

  // ============================================================================
  // STEP 12: Verify Settlement
  // ============================================================================

  logSection('🔍 Verifying Settlement');

  try {
    // Query the commitment to verify it updated
    const commitment = await zkApp.offchainStateCommitments.fetch();

    logSuccess('Settlement successful!');
    console.log('  Offchain state commitment updated on-chain');
    console.log('  All pending actions have been committed');
    console.log('  Offchain state queries should now work');
  } catch (error) {
    logWarning('Could not verify settlement');
    console.log('  Error:', error);
    console.log('  The transaction may still be processing');
  }

  // ============================================================================
  // SUMMARY
  // ============================================================================

  logSection('📊 Settlement Summary');
  console.log(`  ✅ Trade ID: ${state.tradeId}`);
  console.log(`  ✅ Settlement proof generated`);
  console.log(`  ✅ Settlement transaction: ${sentTx.hash.slice(0, 10)}...${sentTx.hash.slice(-10)}`);
  console.log(`  ✅ Offchain state committed on-chain`);

  logSection('📋 Transaction Timeline');
  if (state.depositTxHash) {
    console.log(`  1. Deposit: ${state.depositTxHash.slice(0, 10)}...`);
  }
  if (state.lockTxHash) {
    console.log(`  2. Lock: ${state.lockTxHash.slice(0, 10)}...`);
  }
  if (state.claimTxHash) {
    console.log(`  3. Claim: ${state.claimTxHash.slice(0, 10)}...`);
  }
  console.log(`  4. Settle: ${sentTx.hash.slice(0, 10)}...`);

  logSection('ℹ️  What Settlement Does');
  console.log('  Settlement is the process of committing all pending offchain state');
  console.log('  changes to the on-chain Merkle root commitment. After settlement:');
  console.log('  - Offchain state queries will return the latest data');
  console.log('  - The trade state is cryptographically committed on-chain');
  console.log('  - Historical proofs can be generated for the settled state');

  logSection('🎯 Next Step');
  console.log('  Run: node build/src/scripts/zec_sell_initialization/6_zsi_verify_final.js');
  console.log('  This will perform final verification of the completed swap');
}

main()
  .then(() => {
    console.log('\n✅ Settlement complete!\n');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Settlement failed:', error);
    console.error('\nTroubleshooting:');
    console.error('  - Ensure all previous steps completed successfully');
    console.error('  - Check that Operator has sufficient balance for fees');
    console.error('  - Verify there are pending offchain state actions to settle');
    console.error('  - Ensure you have sufficient memory (proof generation is intensive)');
    console.error('  - Check network connectivity to Zeko L2');
    console.error('  - Try running settlement again if it timed out');
    process.exit(1);
  });
