import { Mina, UInt64 } from 'o1js';
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
 * Scenario 2 - ZEC Sell Initialization: Deposit
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
  logHeader('Scenario 2: ZEC Sell - Step 1: Deposit');

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

  logInfo('Signing transaction with Alice\'s key...');
  const sentTx = await txn.sign([accounts.alice.key]).send();

  logSection('✅ Transaction Sent');
  console.log(`  Transaction Hash: ${sentTx.hash}`);
  console.log(`  Explorer: https://zekoscan.io/testnet/tx/${sentTx.hash}`);

  // Update state with transaction hash
  updateTradeState('zsi', { depositTxHash: sentTx.hash });

  // ============================================================================
  // STEP 10: Wait for Confirmation
  // ============================================================================

  await waitForConfirmation();

  // ============================================================================
  // STEP 11: Post-Deposit Balances
  // ============================================================================

  logSection('💰 Post-Deposit Balances');
  await logBalances(accounts, PublicKey.fromBase58(CONTRACT_ADDRESS));

  // ============================================================================
  // SUMMARY
  // ============================================================================

  logSection('📊 Deposit Summary');
  console.log(`  ✅ Alice deposited: ${Number(state.amount) / 1e9} MINA`);
  console.log(`  ✅ Transaction: ${sentTx.hash.slice(0, 10)}...${sentTx.hash.slice(-10)}`);
  console.log(`  ✅ Trade ID: ${state.tradeId}`);
  console.log(`  ⚠️  Offchain state not yet settled (will be settled later)`);

  logSection('🎯 Next Step');
  console.log('  Run: node build/src/scripts/zec_sell_initialization/2_zsi_verify_deposit.js');
  console.log('  This will query the offchain state to verify the deposit was recorded');
}

main()
  .then(() => {
    console.log('\n✅ Deposit complete!\n');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Deposit failed:', error);
    console.error('\nTroubleshooting:');
    console.error('  - Check that Alice has sufficient balance (need ~1.4 MINA)');
    console.error('  - Verify network connectivity to Zeko L2');
    console.error('  - Ensure the trade state file exists (run 0_zsi_setup.ts first)');
    console.error('  - Check that the contract is deployed and accessible');
    process.exit(1);
  });
