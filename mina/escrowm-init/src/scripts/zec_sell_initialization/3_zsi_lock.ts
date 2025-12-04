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
} from '../shared/state-manager.js';
import {
  generateMockZecTxHash,
  confirmMockZecTrade,
  logMockZecTrade,
  generateMockEscrowdv2State,
  logMockEscrowdv2State,
  verifyMockEscrowdv2StateForLock,
} from '../shared/mock-zec.js';

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
  // STEP 5: Simulate ZEC Confirmation (MOCK)
  // ============================================================================

  logSection('🪙 MOCK: Simulating ZEC Transaction Confirmation');
  console.log('  In real scenario: Bob would send ZEC to Alice');
  console.log('  For testing: We mock ZEC transaction confirmation');

  if (!state.zecTradeData) {
    console.error('❌ No ZEC trade data found in state');
    process.exit(1);
  }

  // Add mock tx hash and confirmations
  const mockZecTxHash = generateMockZecTxHash();
  const confirmedZecTrade: import('../shared/mock-zec.js').MockZecTradeData = {
    sellerAddress: state.zecTradeData.sellerAddress,
    buyerAddress: state.zecTradeData.buyerAddress,
    amount: BigInt(state.zecTradeData.amount), // Convert string to bigint
    txHash: mockZecTxHash,
    confirmations: 6, // Standard safe confirmation count
  };

  logMockZecTrade(confirmedZecTrade, 'Bob → Alice (CONFIRMED)');

  console.log('  ⚠️  MOCK ZEC Confirmation Details:');
  console.log(`  Tx Hash: ${mockZecTxHash}`);
  console.log(`  Confirmations: 6`);
  console.log(`  Status: ✅ Confirmed (MOCKED)`);

  // ============================================================================
  // STEP 5A: Verify escrowdv2 State (MOCK)
  // ============================================================================

  logSection('🔍 Verifying Mock escrowdv2 State');
  console.log('  In real scenario: Operator would query ZEC escrow contract');
  console.log('  For testing: We simulate escrowdv2 state checks');

  // Generate mock escrowdv2 state (simulates querying the ZEC escrow)
  const escrowdv2State = generateMockEscrowdv2State(mockZecTxHash, 6);
  logMockEscrowdv2State(escrowdv2State, 'Before MINA Lock');

  // Verify state is valid for locking MINA side
  const verification = verifyMockEscrowdv2StateForLock(escrowdv2State);

  if (!verification.valid) {
    console.error(`\n❌ escrowdv2 State Invalid for Locking`);
    console.error(`  Reason: ${verification.reason}`);
    console.error(`  Cannot proceed with MINA lock until ZEC escrow is ready`);
    process.exit(1);
  }

  logSuccess('escrowdv2 state verified - ready to lock MINA side');
  console.log('  ✅ ZEC deposited and confirmed');
  console.log('  ✅ No refund detected');
  console.log('  ✅ Safe to proceed with MINA lock');

  // Update state with mock ZEC confirmation
  updateTradeState('zsi', {
    zecTradeData: {
      sellerAddress: confirmedZecTrade.sellerAddress,
      buyerAddress: confirmedZecTrade.buyerAddress,
      amount: confirmedZecTrade.amount.toString(), // Convert bigint to string for JSON
      txHash: confirmedZecTrade.txHash,
      confirmations: confirmedZecTrade.confirmations,
    },
  });

  logSuccess('Mock ZEC transaction confirmed');

  // ============================================================================
  // STEP 6: Pre-Lock Balances
  // ============================================================================

  logSection('💰 Pre-Lock Balances');
  await logBalances(accounts, PublicKey.fromBase58(CONTRACT_ADDRESS));

  // ============================================================================
  // STEP 7: Lock Trade
  // ============================================================================

  logSection('🔒 Locking Trade for Bob');

  const zkApp = getContractInstance();
  const tradeIdField = Field.from(state.tradeIdField);

  console.log(`  Trade ID: ${state.tradeId}`);
  console.log(`  Operator: ${accounts.operator.address.toBase58()}`);
  console.log(`  Claimant (Bob): ${accounts.bob.address.toBase58()}`);
  console.log(`  Amount Locked: ${Number(state.amount) / 1e9} MINA`);
  console.log(`  Fee: ${FEE / 1e9} MINA`);

  logInfo('Building lock transaction...');

  const txn = await Mina.transaction(
    { sender: accounts.operator.address, fee: FEE },
    async () => {
      await zkApp.lockTrade(tradeIdField, accounts.bob.address);
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

  logInfo('Signing transaction with Operator key...');
  const sentTx = await txn.sign([accounts.operator.key]).send();

  logSection('✅ Transaction Sent');
  console.log(`  Transaction Hash: ${sentTx.hash}`);
  console.log(`  Explorer: https://zekoscan.io/testnet/tx/${sentTx.hash}`);

  // Update state with lock transaction hash
  updateTradeState('zsi', { lockTxHash: sentTx.hash });

  // ============================================================================
  // STEP 10: Wait for Confirmation
  // ============================================================================

  await waitForConfirmation();

  // ============================================================================
  // STEP 11: Post-Lock Balances
  // ============================================================================

  logSection('💰 Post-Lock Balances');
  await logBalances(accounts, PublicKey.fromBase58(CONTRACT_ADDRESS));

  // ============================================================================
  // STEP 12: Verify Lock Status
  // ============================================================================

  logSection('🔍 Verifying Lock Status');
  console.log('  Attempting to query offchain state...');

  try {
    const trade = await zkApp.offchainState.fields.trades.get(tradeIdField);

    if (!trade.isSome.toBoolean()) {
      logWarning('Trade not found in offchain state');
      console.log('  This is EXPECTED if settlement hasn\'t occurred yet');
      console.log('  The lock transaction was successful - continue to next step');
    } else {
      const tradeData = trade.value;
      logSuccess('Trade found in offchain state!');

      console.log(`  Locked (inTransit): ${tradeData.inTransit.toBoolean()}`);
      console.log(`  Claimant: ${tradeData.claimant.toBase58()}`);

      // Verify lock status
      const isLocked = tradeData.inTransit.toBoolean();
      const claimantMatches = tradeData.claimant.toBase58() === accounts.bob.address.toBase58();

      if (isLocked && claimantMatches) {
        logSuccess('Lock verified: Trade is locked for Bob');
      } else {
        logWarning('Lock status unexpected');
        console.log(`  Expected: locked=true, claimant=Bob`);
        console.log(`  Actual: locked=${isLocked}, claimant=${tradeData.claimant.toBase58()}`);
      }
    }
  } catch (error) {
    logWarning('Failed to query offchain state');
    console.log('  Error:', error);
    console.log('  This may be expected if settlement hasn\'t occurred yet');
    console.log('  The lock transaction was successful - continue to next step');
  }

  // ============================================================================
  // STEP 13: Generate Settlement Proof
  // ============================================================================

  logSection('⚡ Generating Settlement Proof');
  console.log('  ⚠️  Settlement proof generation takes 5-6 minutes');
  console.log('  This commits the lock to offchain state');
  console.log('  Please be patient...\n');

  logInfo('Starting proof generation...');
  console.log(`  Started at: ${new Date().toLocaleTimeString()}`);

  const proofStartTime = Date.now();
  const settlementProof = await zkApp.offchainState.createSettlementProof();
  const proofDuration = ((Date.now() - proofStartTime) / 1000 / 60).toFixed(2);

  logSuccess(`Settlement proof generated in ${proofDuration} minutes`);
  console.log(`  Completed at: ${new Date().toLocaleTimeString()}`);

  // ============================================================================
  // STEP 14: Submit Settlement Transaction
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

  // ============================================================================
  // STEP 15: Wait for Settlement Confirmation
  // ============================================================================

  await waitForConfirmation();

  logSuccess('Lock settled on-chain - offchain state is now queryable');

  // ============================================================================
  // SUMMARY
  // ============================================================================

  logSection('📊 Lock Summary');
  console.log(`  ✅ Trade ID: ${state.tradeId}`);
  console.log(`  ✅ Lock transaction: ${sentTx.hash.slice(0, 10)}...${sentTx.hash.slice(-10)}`);
  console.log(`  ✅ Settlement transaction: ${settleSentTx.hash.slice(0, 10)}...${settleSentTx.hash.slice(-10)}`);
  console.log(`  ✅ Claimant set to: Bob (${accounts.bob.address.toBase58().slice(0, 20)}...)`);
  console.log(`  ✅ Amount locked: ${Number(state.amount) / 1e9} MINA`);
  console.log(`  ✅ Offchain state settled and queryable`);
  console.log(`  🪙 MOCK: ZEC transaction confirmed (${mockZecTxHash.slice(0, 10)}...)`);

  logSection('🎯 Next Step');
  console.log('  Run: node build/src/scripts/zec_sell_initialization/4_zsi_claim.js');
  console.log('  This will execute Bob\'s claim of the locked MINA');
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
