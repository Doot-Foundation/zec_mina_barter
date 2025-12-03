import { describe, it, before } from 'node:test';
import assert from 'node:assert';
import {
  Field,
  Mina,
  PrivateKey,
  PublicKey,
  AccountUpdate,
  UInt64,
} from 'o1js';
import { MinaEscrowPool, TradeData, offchainState } from '../src/MinaEscrowPool.js';
import { uuidToField, minaToNanomina } from '../src/utils.js';

/**
 * Slow Test Suite: Settlement Proof Generation
 *
 * This test enables real ZK proof generation to verify the complete
 * settlement proof flow. Settlement proofs are required to commit
 * off-chain state changes on-chain and take approximately 5-6 minutes to generate.
 *
 * Run with:
 *   npm test -- MinaEscrowPool.slow.test.ts
 *
 * Note: This test is marked as "slow" due to the proof generation time.
 * Run only when needed to verify full settlement flow.
 */
describe('MinaEscrowPool Settlement Proof (Slow)', () => {
  // Enable proofs for this test suite
  let proofsEnabled = true;

  let Local: Awaited<ReturnType<typeof Mina.LocalBlockchain>>;
  let deployer: Mina.TestPublicKey;
  let operator: Mina.TestPublicKey;
  let alice: Mina.TestPublicKey;  // MINA seller
  let bob: Mina.TestPublicKey;    // ZEC seller (claims MINA)

  let deployerKey: PrivateKey;
  let operatorKey: PrivateKey;
  let aliceKey: PrivateKey;
  let bobKey: PrivateKey;

  let zkAppAddress: PublicKey;
  let zkAppPrivateKey: PrivateKey;
  let zkApp: MinaEscrowPool;

  // Track timing metrics
  let startCompile: number;
  let compileTime: string;
  let offchainCompileTime: string;

  before(async () => {
    console.log('\n🔄 Starting Slow Test: Settlement Proof Generation');
    console.log('⏱️  This test takes ~5-6 minutes due to ZK proof generation\n');

    // Setup local blockchain with proofs enabled
    Local = await Mina.LocalBlockchain({ proofsEnabled });
    Mina.setActiveInstance(Local);

    // Get test accounts
    [deployer, operator, alice, bob] = Local.testAccounts;
    deployerKey = deployer.key;
    operatorKey = operator.key;
    aliceKey = alice.key;
    bobKey = bob.key;

    // Generate zkApp key pair
    zkAppPrivateKey = PrivateKey.random();
    zkAppAddress = zkAppPrivateKey.toPublicKey();

    // Create contract instance
    zkApp = new MinaEscrowPool(zkAppAddress);

    console.log('📝 Compiling MinaEscrowPool contract...');
    startCompile = Date.now();
    await MinaEscrowPool.compile();
    compileTime = ((Date.now() - startCompile) / 1000).toFixed(2);
    console.log(`✓ Contract compiled in ${compileTime}s`);

    console.log('📝 Compiling OffchainState program...');
    const startOffchainCompile = Date.now();
    await offchainState.compile();
    offchainCompileTime = ((Date.now() - startOffchainCompile) / 1000).toFixed(2);
    console.log(`✓ OffchainState compiled in ${offchainCompileTime}s\n`);
  });

  it('should generate settlement proof and commit offchain state changes', async () => {
    console.log('🚀 Test: Settlement Proof Generation');

    // Step 1: Deploy contract
    console.log('\n1️⃣  Deploying contract...');
    const deployTxn = await Mina.transaction(deployer, async () => {
      AccountUpdate.fundNewAccount(deployer);
      await zkApp.deploy();
    });
    await deployTxn.prove();
    await deployTxn.sign([deployerKey, zkAppPrivateKey]).send();
    console.log('   ✓ Contract deployed');

    // Step 2: Initialize operator
    console.log('2️⃣  Initializing operator...');
    const initTxn = await Mina.transaction(operator, async () => {
      await zkApp.initOperator();
    });
    await initTxn.prove();
    await initTxn.sign([operatorKey]).send();
    console.log('   ✓ Operator initialized');

    // Step 3: Alice deposits MINA
    const tradeId = uuidToField('550e8400-e29b-41d4-a716-446655440000');
    const depositAmount = UInt64.from(minaToNanomina(10)); // 10 MINA

    console.log('3️⃣  Alice deposits 10 MINA...');
    const depositTxn = await Mina.transaction(alice, async () => {
      await zkApp.deposit(tradeId, depositAmount, alice);
    });
    await depositTxn.prove();
    await depositTxn.sign([aliceKey]).send();
    console.log('   ✓ Deposit complete');

    // Verify contract balance
    const balance = Mina.getBalance(zkAppAddress);
    assert.strictEqual(balance.toString(), depositAmount.toString());
    console.log(`   ✓ Contract balance: ${balance.toBigInt() / 1_000_000_000n} MINA`);

    // Step 4: Operator locks trade for Bob
    console.log('4️⃣  Operator locks trade for Bob...');
    const lockTxn = await Mina.transaction(operator, async () => {
      await zkApp.lockTrade(tradeId, bob);
    });
    await lockTxn.prove();
    await lockTxn.sign([operatorKey]).send();
    console.log('   ✓ Trade locked');

    // Step 5: Generate settlement proof (this is the slow part!)
    console.log('\n5️⃣  Generating settlement proof...');
    console.log('   ⏳ This will take approximately 5-6 minutes...');
    console.log('   ⏳ Proof generation is computationally intensive...');

    const startProofTime = Date.now();

    // Create settlement proof for all pending offchain state changes
    const proof = await offchainState.createSettlementProof();

    const proofTime = ((Date.now() - startProofTime) / 1000).toFixed(2);
    console.log(`   ✓ Settlement proof generated in ${proofTime}s`);

    // Step 6: Submit settlement proof on-chain
    console.log('6️⃣  Settling offchain state on-chain...');
    const settleTxn = await Mina.transaction(operator, async () => {
      await zkApp.settle(proof);
    });
    await settleTxn.prove();
    await settleTxn.sign([operatorKey]).send();
    console.log('   ✓ Settlement complete');

    // Step 7: Verify we can now query offchain state
    console.log('7️⃣  Verifying offchain state query...');
    const trade = await zkApp.offchainState.fields.trades.get(tradeId);

    assert.ok(trade.isSome.toBoolean(), 'Trade should exist in offchain state');
    const tradeData = trade.value;

    // Verify trade data
    assert.strictEqual(tradeData.tradeId.toString(), tradeId.toString());
    assert.strictEqual(tradeData.depositor.toBase58(), alice.toBase58());
    assert.strictEqual(tradeData.amount.toString(), depositAmount.toString());
    assert.strictEqual(tradeData.inTransit.toBoolean(), true);
    assert.strictEqual(tradeData.claimant.toBase58(), bob.toBase58());
    assert.strictEqual(tradeData.completed.toBoolean(), false);

    console.log('   ✓ Trade data verified:');
    console.log(`      - Trade ID: ${tradeData.tradeId.toString().substring(0, 16)}...`);
    console.log(`      - Depositor: ${tradeData.depositor.toBase58().substring(0, 16)}...`);
    console.log(`      - Amount: ${tradeData.amount.toBigInt() / 1_000_000_000n} MINA`);
    console.log(`      - Locked: ${tradeData.inTransit.toBoolean()}`);
    console.log(`      - Claimant: ${tradeData.claimant.toBase58().substring(0, 16)}...`);

    // Step 8: Bob claims MINA
    console.log('8️⃣  Bob claims MINA...');
    const bobBalanceBefore = Mina.getBalance(bob);

    const claimTxn = await Mina.transaction(bob, async () => {
      await zkApp.claim(tradeId);
    });
    await claimTxn.prove();
    await claimTxn.sign([bobKey]).send();

    const bobBalanceAfter = Mina.getBalance(bob);
    const received = bobBalanceAfter.sub(bobBalanceBefore);

    console.log(`   ✓ Bob received: ${received.toBigInt() / 1_000_000_000n} MINA (minus fees)`);
    assert.ok(
      received.greaterThan(UInt64.from(minaToNanomina(9.9))),
      'Bob should receive close to 10 MINA'
    );

    // Final verification
    const finalBalance = Mina.getBalance(zkAppAddress);
    console.log(`   ✓ Final contract balance: ${finalBalance.toBigInt() / 1_000_000_000n} MINA`);

    console.log('\n✅ Settlement proof test complete!');
    console.log('━'.repeat(60));
    console.log('Summary:');
    console.log(`  • Contract compilation: ${compileTime}s`);
    console.log(`  • OffchainState compilation: ${offchainCompileTime}s`);
    console.log(`  • Settlement proof generation: ${proofTime}s`);
    console.log(`  • Total test time: ${((Date.now() - startCompile) / 1000).toFixed(2)}s`);
    console.log('━'.repeat(60));
  });
});
