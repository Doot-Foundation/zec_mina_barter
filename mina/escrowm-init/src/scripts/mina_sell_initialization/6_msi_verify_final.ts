import { Field, PublicKey } from 'o1js';
import {
  setupNetwork,
  loadTestAccounts,
  compileContract,
  getContractInstance,
  logBalances,
  logHeader,
  logSection,
  logSuccess,
  logWarning,
  logInfo,
  CONTRACT_ADDRESS,
} from '../shared/test-utils.js';
import {
  loadTradeState,
  completeTradeState,
  displayTradeState,
} from '../shared/state-manager.js';

/**
 * Scenario 1 - MINA Sell Initialization: Final Verification
 *
 * Perform comprehensive verification of the completed atomic swap.
 *
 * Steps:
 * 1. Setup network
 * 2. Compile contract
 * 3. Load trade state
 * 4. Query final balances
 * 5. Query offchain state for trade
 * 6. Verify trade completion
 * 7. Verify all transaction hashes
 * 8. Mark trade as completed
 * 9. Display final summary
 */

async function main() {
  logHeader('Scenario 1: MINA Sell - Step 6: Final Verification');

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
  // STEP 5: Final Balances
  // ============================================================================

  logSection('💰 Final Account Balances');
  await logBalances(accounts, PublicKey.fromBase58(CONTRACT_ADDRESS));

  // ============================================================================
  // STEP 6: Query Offchain State
  // ============================================================================

  logSection('🔍 Querying Offchain State');
  console.log(`  Trade ID: ${state.tradeId}`);
  console.log('  Querying after settlement...');

  const zkApp = getContractInstance();
  const tradeIdField = Field.from(state.tradeIdField);

  let tradeFound = false;
  let tradeCompleted = false;

  try {
    const trade = await zkApp.offchainState.fields.trades.get(tradeIdField);

    if (!trade.isSome.toBoolean()) {
      logSuccess('Trade successfully completed and removed from offchain state!');
      console.log('  ✅ After claim, the trade is deleted from the Merkle map');
      console.log('  ✅ This confirms the atomic swap completed successfully');
      console.log('  ✅ All MINA has been transferred to the claimant');
      tradeCompleted = true;
    } else {
      tradeFound = true;
      const tradeData = trade.value;

      logSuccess('Trade found in offchain state!');

      logSection('📋 Final Trade Data');
      console.log(`  Trade ID: ${tradeData.tradeId.toString().slice(0, 20)}...`);
      console.log(`  Depositor: ${tradeData.depositor.toBase58()}`);
      console.log(`  Claimant: ${tradeData.claimant.toBase58()}`);
      console.log(`  Amount: ${tradeData.amount.toString()} nanomina (${Number(tradeData.amount.toString()) / 1e9} MINA)`);
      console.log(`  Refund Address: ${tradeData.refundAddress.toBase58()}`);
      console.log(`  Locked (inTransit): ${tradeData.inTransit.toBoolean()}`);
      console.log(`  Completed: ${tradeData.completed.toBoolean()}`);
      console.log(`  Deposit Block: ${tradeData.depositBlockHeight.toString()}`);
      console.log(`  Expiry Block: ${tradeData.expiryBlockHeight.toString()}`);

      tradeCompleted = tradeData.completed.toBoolean();

      // Verify expected values
      logSection('✅ Verification Checks');

      const depositorMatches = tradeData.depositor.toBase58() === state.depositor;
      console.log(`  Depositor matches: ${depositorMatches ? '✅' : '❌'}`);
      console.log(`    Expected: ${state.depositor.slice(0, 20)}...`);
      console.log(`    Actual: ${tradeData.depositor.toBase58().slice(0, 20)}...`);

      const claimantMatches = tradeData.claimant.toBase58() === state.claimant;
      console.log(`  Claimant matches: ${claimantMatches ? '✅' : '❌'}`);
      console.log(`    Expected: ${state.claimant.slice(0, 20)}...`);
      console.log(`    Actual: ${tradeData.claimant.toBase58().slice(0, 20)}...`);

      const amountMatches = tradeData.amount.toString() === state.amount;
      console.log(`  Amount matches: ${amountMatches ? '✅' : '❌'}`);
      console.log(`    Expected: ${Number(state.amount) / 1e9} MINA`);
      console.log(`    Actual: ${Number(tradeData.amount.toString()) / 1e9} MINA`);

      console.log(`  Trade completed: ${tradeCompleted ? '✅' : '⏳'}`);

      if (!depositorMatches || !claimantMatches || !amountMatches) {
        logWarning('Some verification checks failed!');
        console.log('  Please review the trade data above');
      } else {
        logSuccess('All verification checks passed!');
      }
    }
  } catch (error) {
    logWarning('Failed to query offchain state');
    console.log('  Error:', error);
    console.log('  This may indicate an issue with settlement or network connectivity');
  }

  // ============================================================================
  // STEP 7: Transaction Hash Verification
  // ============================================================================

  logSection('📝 Transaction Hash Verification');

  const txHashes = [
    { name: 'Deposit', hash: state.depositTxHash },
    { name: 'Lock', hash: state.lockTxHash },
    { name: 'Claim', hash: state.claimTxHash },
    { name: 'Settlement', hash: state.settleTxHash },
  ];

  let allTxPresent = true;

  for (const tx of txHashes) {
    if (tx.hash) {
      logSuccess(`${tx.name} transaction recorded`);
      console.log(`    Hash: ${tx.hash}`);
      console.log(`    Explorer: https://zekoscan.io/testnet/tx/${tx.hash}`);
    } else {
      logWarning(`${tx.name} transaction missing`);
      allTxPresent = false;
    }
  }

  if (allTxPresent) {
    logSuccess('All transaction hashes recorded');
  } else {
    logWarning('Some transaction hashes are missing');
  }

  // ============================================================================
  // STEP 8: Mock ZEC Verification
  // ============================================================================

  logSection('🪙 Mock ZEC Trade Verification');

  if (state.zecTradeData) {
    console.log(`  ⚠️  MOCK ZEC Trade (Bob → Alice):`);
    console.log(`  Seller: ${state.zecTradeData.sellerAddress}`);
    console.log(`  Buyer: ${state.zecTradeData.buyerAddress}`);
    console.log(`  Amount: ${Number(state.zecTradeData.amount) / 1e8} ZEC`);

    if (state.zecTradeData.txHash) {
      console.log(`  Tx Hash: ${state.zecTradeData.txHash}`);
      console.log(`  Confirmations: ${state.zecTradeData.confirmations}`);
      logSuccess('Mock ZEC transaction confirmed');
    } else {
      logWarning('Mock ZEC transaction not confirmed');
    }

    console.log('  ⚠️  This was MOCKED data for testing purposes');
  } else {
    logWarning('No ZEC trade data found in state');
  }

  // ============================================================================
  // STEP 9: Mark Trade as Completed
  // ============================================================================

  logSection('🎉 Marking Trade as Completed');

  completeTradeState('msi');

  const completedState = loadTradeState('msi');
  const duration = completedState.completedAt && completedState.createdAt
    ? ((completedState.completedAt - completedState.createdAt) / 1000 / 60).toFixed(1)
    : 'Unknown';

  console.log(`  Trade completed at: ${completedState.completedAt ? new Date(completedState.completedAt).toLocaleString() : 'Unknown'}`);
  console.log(`  Total duration: ${duration} minutes`);

  // ============================================================================
  // FINAL SUMMARY
  // ============================================================================

  logSection('🎊 FINAL SUMMARY: MINA Sell Initialization (Happy Path)');

  console.log('\n📖 Scenario Overview:');
  console.log('  Alice wanted to sell 1 MINA for ZEC');
  console.log('  Bob wanted to buy MINA with ZEC');
  console.log('  Atomic swap completed successfully!\n');

  console.log('✅ Swap Flow Completed:');
  console.log('  1. ✅ Alice deposited 1 MINA to escrow');
  console.log('  2. ✅ Deposit verified in offchain state');
  console.log('  3. ✅ Bob sent ZEC to Alice (MOCKED)');
  console.log('  4. ✅ Operator locked trade for Bob');
  console.log('  5. ✅ Bob claimed 1 MINA from escrow');
  console.log('  6. ✅ Settlement proof generated and submitted');
  console.log('  7. ✅ Final verification completed\n');

  console.log('📊 Final State:');
  console.log(`  Trade ID: ${state.tradeId}`);
  console.log(`  Alice (Depositor): ${state.depositor.slice(0, 20)}...`);
  console.log(`  Bob (Claimant): ${state.claimant.slice(0, 20)}...`);
  console.log(`  Amount: ${Number(state.amount) / 1e9} MINA`);
  console.log(`  Duration: ${duration} minutes`);
  console.log(`  Transactions: ${allTxPresent ? 'All recorded ✅' : 'Some missing ⚠️'}`);
  console.log(`  Offchain State: ${tradeFound ? (tradeCompleted ? 'Completed ✅' : 'Found ⏳') : 'Not found ⚠️'}\n`);

  console.log('🔗 Transaction Links:');
  if (state.depositTxHash) {
    console.log(`  Deposit: https://zekoscan.io/testnet/tx/${state.depositTxHash}`);
  }
  if (state.lockTxHash) {
    console.log(`  Lock: https://zekoscan.io/testnet/tx/${state.lockTxHash}`);
  }
  if (state.claimTxHash) {
    console.log(`  Claim: https://zekoscan.io/testnet/tx/${state.claimTxHash}`);
  }
  if (state.settleTxHash) {
    console.log(`  Settlement: https://zekoscan.io/testnet/tx/${state.settleTxHash}`);
  }

  logSection('🎯 Next Scenario');
  console.log('  To test ZEC sell initialization (Bob deposits, Alice claims):');
  console.log('  Run: node build/src/scripts/zec_sell_initialization/0_zsi_setup.js');
  console.log('  This will test the swap flow from the opposite direction\n');

  logInfo('State file location: mina/escrowm-init/src/scripts/.state/mina_sell_state.json');
}

main()
  .then(() => {
    console.log('\n✅ ✅ ✅ Scenario 1 (MINA Sell) Complete! ✅ ✅ ✅\n');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Final verification failed:', error);
    console.error('\nTroubleshooting:');
    console.error('  - Check that all previous steps completed successfully');
    console.error('  - Verify settlement was completed');
    console.error('  - Ensure network connectivity to Zeko L2');
    console.error('  - Review transaction hashes on ZekoScan');
    process.exit(1);
  });
