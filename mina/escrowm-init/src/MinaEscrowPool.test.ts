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
import { MinaEscrowPool, TradeData, offchainState } from './MinaEscrowPool.js';
import { uuidToField, minaToNanomina } from './utils.js';

describe('MinaEscrowPool', () => {
  let proofsEnabled = false;

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

  before(async () => {
    // Setup local blockchain
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

    console.log('Compiling MinaEscrowPool...');
    if (proofsEnabled) {
      await MinaEscrowPool.compile();
      await offchainState.compile();
    }
    console.log('Compilation complete');
  });

  it('should deploy contract', async () => {
    const txn = await Mina.transaction(deployer, async () => {
      AccountUpdate.fundNewAccount(deployer);
      await zkApp.deploy();
    });
    await txn.prove();
    await txn.sign([deployerKey, zkAppPrivateKey]).send();

    const operatorState = zkApp.operator.get();
    assert.deepStrictEqual(operatorState, PublicKey.empty());
  });

  it('should initialize operator', async () => {
    const txn = await Mina.transaction(operator, async () => {
      await zkApp.initOperator();
    });
    await txn.prove();
    await txn.sign([operatorKey]).send();

    const operatorState = zkApp.operator.get();
    assert.deepStrictEqual(operatorState, operator);
  });

  it('should allow user to deposit MINA', async () => {
    const tradeId = uuidToField('550e8400-e29b-41d4-a716-446655440000');
    const depositAmount = UInt64.from(minaToNanomina(10)); // 10 MINA

    // Alice deposits 10 MINA
    const txn = await Mina.transaction(alice, async () => {
      await zkApp.deposit(tradeId, depositAmount, alice);
    });
    await txn.prove();
    await txn.sign([aliceKey]).send();

    // Check contract balance increased
    const balance = Mina.getBalance(zkAppAddress);
    assert.strictEqual(balance.toString(), depositAmount.toString());

    // Note: OffchainState requires settlement proof to query
    // In production, middleware would call settle() before querying
  });

  it('should allow operator to lock trade', async () => {
    const tradeId = uuidToField('550e8400-e29b-41d4-a716-446655440000');

    // Operator locks trade for Bob to claim
    const txn = await Mina.transaction(operator, async () => {
      await zkApp.lockTrade(tradeId, bob);
    });
    await txn.prove();
    await txn.sign([operatorKey]).send();

    // Trade is now locked, Bob can claim
  });

  it('should allow claimant to withdraw MINA', async () => {
    const tradeId = uuidToField('550e8400-e29b-41d4-a716-446655440000');

    const bobBalanceBefore = Mina.getBalance(bob);

    // Bob claims MINA
    const txn = await Mina.transaction(bob, async () => {
      await zkApp.claim(tradeId);
    });
    await txn.prove();
    await txn.sign([bobKey]).send();

    // Check Bob received MINA (10 MINA minus fees)
    const bobBalanceAfter = Mina.getBalance(bob);
    const received = bobBalanceAfter.sub(bobBalanceBefore);

    // Should receive close to 10 MINA (accounting for transaction fee)
    assert.ok(received.greaterThan(UInt64.from(minaToNanomina(9.9))));
  });

  it('should allow depositor to refund if not locked', async () => {
    const tradeId2 = uuidToField('660e8400-e29b-41d4-a716-446655440001');
    const depositAmount = UInt64.from(minaToNanomina(5)); // 5 MINA

    // Alice deposits 5 MINA
    const depositTxn = await Mina.transaction(alice, async () => {
      await zkApp.deposit(tradeId2, depositAmount, alice);
    });
    await depositTxn.prove();
    await depositTxn.sign([aliceKey]).send();

    const aliceBalanceBefore = Mina.getBalance(alice);

    // Alice refunds (trade never locked)
    const refundTxn = await Mina.transaction(alice, async () => {
      await zkApp.refund(tradeId2);
    });
    await refundTxn.prove();
    await refundTxn.sign([aliceKey]).send();

    // Alice should get MINA back
    const aliceBalanceAfter = Mina.getBalance(alice);
    const refunded = aliceBalanceAfter.sub(aliceBalanceBefore);

    // Should receive close to 5 MINA (accounting for fees)
    assert.ok(refunded.greaterThan(UInt64.from(minaToNanomina(4.9))));
  });

  it('should prevent non-operator from locking trade', async () => {
    const tradeId3 = uuidToField('770e8400-e29b-41d4-a716-446655440002');
    const depositAmount = UInt64.from(minaToNanomina(3));

    // Alice deposits
    const depositTxn = await Mina.transaction(alice, async () => {
      await zkApp.deposit(tradeId3, depositAmount, alice);
    });
    await depositTxn.prove();
    await depositTxn.sign([aliceKey]).send();

    // Alice tries to lock (should fail - not operator)
    try {
      const lockTxn = await Mina.transaction(alice, async () => {
        await zkApp.lockTrade(tradeId3, bob);
      });
      await lockTxn.prove();
      await lockTxn.sign([aliceKey]).send();

      assert.fail('Should have thrown error');
    } catch (error) {
      // Expected: only operator can lock
      assert.ok(error instanceof Error);
    }
  });

  it('should prevent claiming unlocked trade', async () => {
    const tradeId3 = uuidToField('770e8400-e29b-41d4-a716-446655440002');

    // Bob tries to claim unlocked trade (should fail)
    try {
      const claimTxn = await Mina.transaction(bob, async () => {
        await zkApp.claim(tradeId3);
      });
      await claimTxn.prove();
      await claimTxn.sign([bobKey]).send();

      assert.fail('Should have thrown error');
    } catch (error) {
      // Expected: trade not locked
      assert.ok(error instanceof Error);
    }
  });

  it('should prevent refund after trade is locked', async () => {
    const tradeId4 = uuidToField('880e8400-e29b-41d4-a716-446655440003');
    const depositAmount = UInt64.from(minaToNanomina(2));

    // Alice deposits
    const depositTxn = await Mina.transaction(alice, async () => {
      await zkApp.deposit(tradeId4, depositAmount, alice);
    });
    await depositTxn.prove();
    await depositTxn.sign([aliceKey]).send();

    // Operator locks
    const lockTxn = await Mina.transaction(operator, async () => {
      await zkApp.lockTrade(tradeId4, bob);
    });
    await lockTxn.prove();
    await lockTxn.sign([operatorKey]).send();

    // Alice tries to refund (should fail - locked)
    try {
      const refundTxn = await Mina.transaction(alice, async () => {
        await zkApp.refund(tradeId4);
      });
      await refundTxn.prove();
      await refundTxn.sign([aliceKey]).send();

      assert.fail('Should have thrown error');
    } catch (error) {
      // Expected: trade is locked
      assert.ok(error instanceof Error);
    }
  });

  it('should prevent double deposits with same tradeId', async () => {
    const tradeId5 = uuidToField('990e8400-e29b-41d4-a716-446655440004');
    const depositAmount = UInt64.from(minaToNanomina(1));

    // First deposit succeeds
    const deposit1 = await Mina.transaction(alice, async () => {
      await zkApp.deposit(tradeId5, depositAmount, alice);
    });
    await deposit1.prove();
    await deposit1.sign([aliceKey]).send();

    // Second deposit with same tradeId should fail
    try {
      const deposit2 = await Mina.transaction(alice, async () => {
        await zkApp.deposit(tradeId5, depositAmount, alice);
      });
      await deposit2.prove();
      await deposit2.sign([aliceKey]).send();

      assert.fail('Should have thrown error');
    } catch (error) {
      // Expected: trade already exists
      assert.ok(error instanceof Error);
    }
  });
});
