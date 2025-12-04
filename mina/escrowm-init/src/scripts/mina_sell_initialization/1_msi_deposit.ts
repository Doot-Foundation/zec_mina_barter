import { Mina, UInt64, fetchAccount } from 'o1js';
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
  FEE,
  CONTRACT_ADDRESS,
} from '../shared/test-utils.js';
import {
  loadTradeState,
  updateTradeState,
  displayTradeState,
} from '../shared/state-manager.js';
import { PublicKey, Field } from 'o1js';

/**
 * Scenario 1 - MINA Sell Initialization: Deposit
 *
 * Alice deposits 1 MINA into the escrow contract to initiate the swap.
 *
 * Steps:
 * 1. Load network and accounts
 * 2. Compile contract
 * 3. Load trade state from previous step
 * 4. Log balances before deposit
 * 5. Build and prove deposit transaction
 * 6. Sign with Alice's key and send
 * 7. Wait for Zeko confirmation
 * 8. Update state with transaction hash
 * 9. Log balances after deposit
 */

async function main() {
  logHeader('Scenario 1: MINA Sell - Step 1: Deposit');

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
  // STEP 5: Pre-Deposit Balances
  // ============================================================================

  logSection('💰 Pre-Deposit Balances');
  await logBalances(accounts, PublicKey.fromBase58(CONTRACT_ADDRESS));

  // ============================================================================
  // STEP 6: Prepare Deposit
  // ============================================================================

  logSection('📤 Preparing Deposit Transaction');

  const zkApp = getContractInstance();
  const tradeIdField = Field.from(state.tradeIdField);
  const depositAmount = UInt64.from(state.amount); // 1 MINA in nanomina

  console.log(`  Trade ID: ${state.tradeId}`);
  console.log(`  Trade ID Field: ${state.tradeIdField.slice(0, 20)}...`);
  console.log(`  Depositor: Alice (${accounts.alice.address.toBase58()})`);
  console.log(`  Amount: ${Number(state.amount) / 1e9} MINA`);
  console.log(`  Refund Address: ${accounts.alice.address.toBase58()}`);
  console.log(`  Fee: ${FEE / 1e9} MINA`);

  // ============================================================================
  // STEP 7: Build Transaction
  // ============================================================================

  logInfo('Building deposit transaction...');

  const txn = await Mina.transaction(
    { sender: accounts.alice.address, fee: FEE },
    async () => {
      await zkApp.deposit(tradeIdField, depositAmount, accounts.alice.address);
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

  logInfo("Signing transaction with Alice's key...");
  const sentTx = await txn.sign([accounts.alice.key]).send();

  logSection('✅ Transaction Sent');
  console.log(`  Transaction Hash: ${sentTx.hash}`);
  console.log(`  Explorer: https://zekoscan.io/testnet/tx/${sentTx.hash}`);

  // Update state with transaction hash
  updateTradeState('msi', { depositTxHash: sentTx.hash });

  // ============================================================================
  // STEP 10: Wait for Confirmation
  // ============================================================================

  await waitForConfirmation();

  // ============================================================================
  // STEP 11: Post-Deposit Balances
  // ============================================================================

  logSection('💰 Post-Deposit Balances');
  await logBalances(accounts, PublicKey.fromBase58(CONTRACT_ADDRESS));

  /// ALL BEING HANDLED BY THE MIDDLEWARE
  // ============================================================================
  // ============================================================================
  // ============================================================================
  // ============================================================================

  // ============================================================================
  // // STEP 12: Generate Settlement Proof
  // // ============================================================================

  // logSection('⚡ Generating Settlement Proof');
  // console.log('  ⚠️  Settlement proof generation takes 5-6 minutes');
  // console.log('  This commits the deposit to offchain state');
  // console.log('  Please be patient...\n');

  // logInfo('Starting proof generation...');
  // console.log(`  Started at: ${new Date().toLocaleTimeString()}`);

  // const proofStartTime = Date.now();
  // const settlementProof = await zkApp.offchainState.createSettlementProof();
  // const proofDuration = ((Date.now() - proofStartTime) / 1000 / 60).toFixed(2);

  // logSuccess(`Settlement proof generated in ${proofDuration} minutes`);
  // console.log(`  Completed at: ${new Date().toLocaleTimeString()}`);

  // // ============================================================================
  // // STEP 13: Submit Settlement Transaction
  // // ============================================================================

  // logSection('📤 Submitting Settlement Transaction');

  // // Fetch latest account state to ensure fresh nonce
  // logInfo('Fetching latest Operator account state...');
  // await fetchAccount({ publicKey: accounts.operator.address });

  // logInfo('Building settlement transaction...');
  // const settleTxn = await Mina.transaction(
  //   { sender: accounts.operator.address, fee: FEE },
  //   async () => {
  //     await zkApp.settle(settlementProof);
  //   }
  // );

  // logSuccess('Transaction built');

  // logInfo('Generating transaction proof...');
  // await settleTxn.prove();
  // logSuccess('Transaction proof generated');

  // logInfo('Signing transaction with Operator key...');
  // const settleSentTx = await settleTxn.sign([accounts.operator.key]).send();

  // logSection('✅ Settlement Transaction Sent');
  // console.log(`  Transaction Hash: ${settleSentTx.hash}`);
  // console.log(
  //   `  Explorer: https://zekoscan.io/testnet/tx/${settleSentTx.hash}`
  // );

  // // ============================================================================
  // // STEP 14: Wait for Settlement Confirmation
  // // ============================================================================

  // await waitForConfirmation();

  // logSuccess('Deposit settled on-chain - offchain state is now queryable');

  // // ============================================================================
  // // SUMMARY
  // // ============================================================================

  // logSection('📊 Deposit Summary');
  // console.log(`  ✅ Alice deposited: ${Number(state.amount) / 1e9} MINA`);
  // console.log(
  //   `  ✅ Deposit transaction: ${sentTx.hash.slice(
  //     0,
  //     10
  //   )}...${sentTx.hash.slice(-10)}`
  // );
  // console.log(
  //   `  ✅ Settlement transaction: ${settleSentTx.hash.slice(
  //     0,
  //     10
  //   )}...${settleSentTx.hash.slice(-10)}`
  // );
  // console.log(`  ✅ Trade ID: ${state.tradeId}`);
  // console.log(`  ✅ Offchain state settled and queryable`);

  // logSection('🎯 Next Step');
  // console.log(
  //   '  Run: node build/src/scripts/mina_sell_initialization/2_msi_verify_deposit.js'
  // );
  // console.log(
  //   '  This will query the offchain state to verify the deposit was recorded'
  // );
}

main()
  .then(() => {
    console.log('\n✅ Deposit complete!\n');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Deposit failed:', error);
    console.error('\nTroubleshooting:');
    console.error(
      '  - Check that Alice has sufficient balance (need ~1.4 MINA)'
    );
    console.error('  - Verify network connectivity to Zeko L2');
    console.error(
      '  - Ensure the trade state file exists (run 0_msi_setup.ts first)'
    );
    console.error('  - Check that the contract is deployed and accessible');
    process.exit(1);
  });
