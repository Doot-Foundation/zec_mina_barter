# Middleware ↔ Escrowm Communication Architecture

Complete technical specification of how the middleware interacts with the MinaEscrowPool (escrowm) smart contract.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Communication Channels](#communication-channels)
3. [Read Operations](#read-operations)
4. [Write Operations](#write-operations)
5. [Settlement Process](#settlement-process)
6. [Data Flow Examples](#data-flow-examples)
7. [Error Handling](#error-handling)

---

## Architecture Overview

### Components

```
┌─────────────────────────────────────────────────────────────┐
│                      Middleware                             │
│                                                             │
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────┐   │
│  │ Coordinator  │   │ MinaClient   │   │  Settlement  │   │
│  │  (polling)   │──▶│  (wrapper)   │──▶│    Worker    │   │
│  └──────────────┘   └──────┬───────┘   └──────────────┘   │
│                            │                                │
└────────────────────────────┼────────────────────────────────┘
                             │
                             ▼
                  ┌──────────────────────┐
                  │  Mina/Zeko Network   │
                  │   (GraphQL RPC)      │
                  └──────────┬───────────┘
                             │
                             ▼
                  ┌──────────────────────┐
                  │   MinaEscrowPool     │
                  │   (escrowm zkApp)    │
                  │                      │
                  │  On-chain:           │
                  │  - operator          │
                  │  - commitments       │
                  │                      │
                  │  Off-chain:          │
                  │  - trades Map        │
                  │    (Field→TradeData) │
                  └──────────────────────┘
```

### Key Modules

**Middleware Side**:
- **`coordinator.ts`** - Main orchestration loop (polls both chains)
- **`mina-client.ts`** - MinaEscrowPool contract wrapper
- **`settlement-worker.ts`** - Settlement proof generation
- **`contract-imports.ts`** - Dynamic contract loading and compilation

**Escrowm Side**:
- **`MinaEscrowPool.ts`** - Smart contract with 7 methods
- **`offchainState`** - Merkle map storing all trade data
- **`TradeData`** - Trade state structure

---

## Communication Channels

### 1. GraphQL Queries (Read Operations)

**Endpoint**: `config.mina.graphqlEndpoint`
- Zeko L2 Devnet: `https://devnet.zeko.io/graphql`
- Mina L1 Devnet: `https://api.minascan.io/node/devnet/v1/graphql`

**Purpose**: Read contract state and OffchainState data

**Methods**:
- `fetchAccount()` - Get on-chain account state
- `Mina.fetchActions()` - Get pending OffchainState actions
- `fetchMerkleMap()` - Rebuild OffchainState Merkle map from actions

### 2. Transaction Submission (Write Operations)

**Endpoint**: Same GraphQL endpoint

**Purpose**: Submit state-changing transactions

**Flow**:
```typescript
1. Create transaction  → Mina.transaction()
2. Generate ZK proof   → txn.prove()
3. Sign with operator  → txn.sign([operatorKey])
4. Submit to network   → txn.send()
5. Wait for inclusion  → sentTx.wait()
```

---

## Read Operations

### 1. Get All Active Trades

**Method**: `minaClient.getActiveTrades()`

**Implementation** (`mina-client.ts:91-137`):

```typescript
async getActiveTrades(): Promise<MinaTrade[]> {
  // Step 1: Fetch account state
  await fetchAccount({ publicKey: config.mina.poolAddress });

  // Step 2: Load contract modules
  const modules = await loadContracts();
  const zkApp = await this.getZkApp();

  // Step 3: Rebuild Merkle map from all actions (archive query)
  const { valueMap } = await fetchMerkleMap(
    this.treeHeight,  // 31 (logTotalCapacity=30)
    { address: config.mina.poolAddress, tokenId: zkApp.token.id },
    undefined
  );

  // Step 4: Deserialize all non-completed trades
  const trades: MinaTrade[] = [];
  for (const [, valueFields] of valueMap.entries()) {
    const tradeData = modules.TradeData.fromFields(tradeFields);

    if (tradeData.completed.toBoolean()) continue;  // Skip completed

    trades.push({
      tradeId: tradeData.tradeId.toString(),
      depositor: tradeData.depositor.toBase58(),
      amount: tradeData.amount.toString(),
      inTransit: tradeData.inTransit.toBoolean(),
      claimant: tradeData.claimant.toBase58(),
      // ... more fields
    });
  }

  return trades;
}
```

**Key Insight**: Uses `fetchMerkleMap()` from o1js internal helpers to reconstruct the entire OffchainState Map by replaying all actions from the archive node. This gives a complete view of all trades without querying each trade individually.

**Called By**: `coordinator.poll()` every 15 seconds (default)

**Returns**:
```typescript
interface MinaTrade {
  tradeId: string;            // UUID as string
  tradeIdField: string;       // Field representation
  depositor: string;          // Base58 public key
  amount: string;             // Nanomina
  inTransit: boolean;         // Locked by operator?
  claimant: string;           // Who can claim (Base58)
  refundAddress: string;      // Refund destination
  depositBlockHeight: string;
  expiryBlockHeight: string;
}
```

### 2. Get Single Trade

**Method**: `minaClient.getTrade(tradeId)`

**Implementation** (`mina-client.ts:145-187`):

```typescript
async getTrade(tradeId: string): Promise<MinaTrade | null> {
  // Get zkApp instance
  const zkApp = await this.getZkApp();
  const tradeIdField = this.toTradeIdField(tradeId);

  // Fetch latest account state
  await fetchAccount({ publicKey: config.mina.poolAddress });

  // Query trade from OffchainState
  const trade = await zkApp.offchainState.fields.trades.get(tradeIdField);

  // Check if trade exists
  if (!trade.isSome.toBoolean()) {
    return null;
  }

  const tradeData = trade.value;

  // Check if completed
  if (tradeData.completed.toBoolean()) {
    return null;
  }

  // Convert to MinaTrade format
  return { /* ... */ };
}
```

**Key Insight**: Queries a specific trade from OffchainState using `.get()`. More efficient than `getActiveTrades()` when you need just one trade.

**Called By**: `coordinator.getCombinedState()` when processing individual trades

### 3. Get Pool Balance

**Method**: `minaClient.getPoolBalance()`

**Implementation** (`mina-client.ts:296-305`):

```typescript
async getPoolBalance(): Promise<bigint> {
  const account = await fetchAccount({ publicKey: config.mina.poolAddress });
  const balance = account.account?.balance.toBigInt() ?? 0n;
  return balance;
}
```

**Called By**: `coordinator.poll()` for logging pool status

---

## Write Operations

All write operations require:
1. **Operator signature** - Middleware must be initialized with `OPERATOR_PRIVATE_KEY`
2. **ZK proof generation** - Every transaction requires proof (~10-30s)
3. **Network fees** - 0.1 MINA per transaction

### 1. Lock Trade

**Method**: `minaClient.lockTrade(tradeId, claimant)`

**Purpose**: Lock MINA side when ZEC side is funded

**Implementation** (`mina-client.ts:197-240`):

```typescript
async lockTrade(tradeId: string, claimant: PublicKey): Promise<string | null> {
  const tradeIdField = this.toTradeIdField(tradeId);
  logger.info(`Locking MINA trade: ${tradeIdField.toString()}`);

  // Get zkApp instance
  const zkApp = await this.getZkApp();

  // Fetch latest account state
  await fetchAccount({ publicKey: config.mina.poolAddress });
  await fetchAccount({ publicKey: config.operator.publicKey });

  // Create transaction
  const txn = await Mina.transaction(
    { sender: config.operator.publicKey, fee: 0.1e9 },
    async () => {
      await zkApp.lockTrade(tradeIdField, claimant);
    }
  );

  // Generate proof
  logger.debug('Generating proof for lockTrade...');
  await txn.prove();

  // Sign and send
  const signedTx = await txn.sign([config.operator.privateKey]).send();

  if (!signedTx || !signedTx.hash) {
    throw new Error('Transaction failed: no hash returned');
  }

  const txHash = signedTx.hash;
  logger.info(`✓ MINA trade locked: ${txHash}`);

  // Wait for inclusion (optional)
  await signedTx.wait();
  logger.debug(`Transaction confirmed: ${txHash}`);

  return txHash;
}
```

**Calls Contract Method**: `MinaEscrowPool.lockTrade()` (`MinaEscrowPool.ts:190-227`)

**Contract-Side Logic**:
```typescript
@method async lockTrade(tradeId: Field, claimant: PublicKey) {
  // 1. Verify operator signature
  const sender = this.sender.getAndRequireSignature();
  const operator = this.operator.getAndRequireEquals();
  sender.assertEquals(operator);

  // 2. Get trade from OffchainState
  const trade = await this.offchainState.fields.trades.get(tradeId);
  trade.isSome.assertTrue();  // Trade must exist
  const tradeData = trade.value;

  // 3. Validate: not already locked
  tradeData.inTransit.assertFalse();

  // 4. Validate: claimant not empty
  claimant.equals(PublicKey.empty()).assertFalse();

  // 5. Update trade: set inTransit=true and claimant
  const updatedTrade = new TradeData({
    ...tradeData,
    inTransit: Bool(true),
    claimant,
  });

  // 6. Write to OffchainState
  this.offchainState.fields.trades.update(tradeId, {
    from: trade,
    to: updatedTrade,
  });
}
```

**State Changes**:
- `TradeData.inTransit`: `false` → `true`
- `TradeData.claimant`: `PublicKey.empty()` → `claimant` (ZEC seller's MINA address)

**Called By**: `coordinator.lockBothSides()` after detecting both sides funded

**Parameters**:
- `tradeId`: UUID string (converted to Field internally)
- `claimant`: ZEC seller's MINA address (from Supabase keypair lookup)

### 2. Emergency Unlock

**Method**: `minaClient.emergencyUnlock(tradeId)`

**Purpose**: Unlock MINA if ZEC lock fails after MINA lock succeeds

**Implementation** (`mina-client.ts:249-291`):

```typescript
async emergencyUnlock(tradeId: string): Promise<string | null> {
  const tradeIdField = this.toTradeIdField(tradeId);
  logger.warn(`Emergency unlock MINA trade: ${tradeIdField.toString()}`);

  // Get zkApp instance
  const zkApp = await this.getZkApp();

  // Fetch latest account state
  await fetchAccount({ publicKey: config.mina.poolAddress });
  await fetchAccount({ publicKey: config.operator.publicKey });

  // Create transaction
  const txn = await Mina.transaction(
    { sender: config.operator.publicKey, fee: 0.1e9 },
    async () => {
      await zkApp.emergencyUnlock(tradeIdField);
    }
  );

  // Generate proof
  logger.debug('Generating proof for emergencyUnlock...');
  await txn.prove();

  // Sign and send
  const signedTx = await txn.sign([config.operator.privateKey]).send();

  const txHash = signedTx.hash;
  logger.warn(`✓ MINA trade emergency unlocked: ${txHash}`);

  await signedTx.wait();

  return txHash;
}
```

**Calls Contract Method**: `MinaEscrowPool.emergencyUnlock()` (`MinaEscrowPool.ts:298-325`)

**Contract-Side Logic**:
```typescript
@method async emergencyUnlock(tradeId: Field) {
  // 1. Verify operator signature
  const sender = this.sender.getAndRequireSignature();
  const operator = this.operator.getAndRequireEquals();
  sender.assertEquals(operator);

  // 2. Get trade from OffchainState
  const trade = await this.offchainState.fields.trades.get(tradeId);
  trade.isSome.assertTrue();
  const tradeData = trade.value;

  // 3. Validate: must be locked
  tradeData.inTransit.assertTrue();

  // 4. Update trade: set inTransit back to false, clear claimant
  const updatedTrade = new TradeData({
    ...tradeData,
    inTransit: Bool(false),
    claimant: PublicKey.empty(),
  });

  // 5. Write to OffchainState
  this.offchainState.fields.trades.update(tradeId, {
    from: trade,
    to: updatedTrade,
  });
}
```

**State Changes**:
- `TradeData.inTransit`: `true` → `false`
- `TradeData.claimant`: `<address>` → `PublicKey.empty()`

**Called By**:
1. `coordinator.cleanSlate()` on startup (crash recovery)
2. `coordinator.lockBothSides()` if ZEC lock fails after MINA lock

**Use Case**: Two-phase locking safety - if MINA locked but ZEC lock fails, middleware can revert the MINA lock to allow refunds.

---

## Settlement Process

### Overview

OffchainState changes (like `lockTrade`, `emergencyUnlock`) are queued as "actions" and must be periodically committed on-chain via settlement proofs.

**Frequency**: Settlement Worker checks every 60 seconds (default)

**Trigger**: When `pendingActionsCount >= 1`

**Duration**: ~5-6 minutes to generate proof

### Settlement Worker Flow

**Implementation** (`settlement-worker.ts:62-202`):

```typescript
async checkAndSettle() {
  // 1. Fetch account state
  await fetchAccount({ publicKey: config.mina.poolAddress });

  // 2. Get pending actions count
  const pendingActionsCount = await this.getPendingActionsCount();

  if (pendingActionsCount >= this.minActionsThreshold) {
    logger.info(`Found ${pendingActionsCount} pending actions, triggering settlement...`);
    await this.triggerSettlement(zkApp, modules);
  }
}

async getPendingActionsCount(): Promise<number> {
  // 1. Fetch fresh account state
  const account = await fetchAccount({ publicKey: config.mina.poolAddress });

  // 2. Create zkApp instance
  const zkApp = await createContractInstance(config.mina.poolAddress);

  // 3. Get fresh commitments
  const commitments = zkApp.offchainStateCommitments.get();

  // 4. Fetch actions since last settlement
  const actions = await Mina.fetchActions(
    config.mina.poolAddress,
    { fromActionState: commitments.actionState }
  );

  // 5. Count all actions
  const count = actions.reduce((blockSum, block) => {
    const blockCount = block.actions.reduce(
      (acctSum, acct) => acctSum + acct.length,
      0
    );
    return blockSum + blockCount;
  }, 0);

  return count;
}

async triggerSettlement(zkApp: any, modules: any) {
  logger.info('Generating settlement proof (this takes ~5-6 minutes)...');

  // 1. Create settlement proof (compute-intensive)
  const proof = await modules.offchainState.createSettlementProof();

  // 2. Fetch latest state
  await fetchAccount({ publicKey: config.mina.poolAddress });
  await fetchAccount({ publicKey: config.operator.publicKey });

  // 3. Create transaction
  const txn = await Mina.transaction(
    { sender: config.operator.publicKey, fee: 0.1e9 },
    async () => {
      await zkApp.settle(proof);
    }
  );

  // 4. Prove and send
  await txn.prove();
  const sentTx = await txn.sign([config.operator.privateKey]).send();

  logger.info(`✓ Settlement transaction sent: ${sentTx.hash}`);

  // 5. Wait for confirmation
  await sentTx.wait();

  logger.info(`✓✓ Settlement complete`);
}
```

**Calls Contract Method**: `MinaEscrowPool.settle()` (`MinaEscrowPool.ts:327-341`)

**Contract-Side Logic**:
```typescript
@method async settle(proof: TradeProof) {
  // Verify and apply settlement proof
  await this.offchainState.settle(proof);
}
```

**On-Chain State Changes**:
- `offchainStateCommitments.root` - Updated with new Merkle root
- `offchainStateCommitments.actionState` - Advanced to current action state

**Effect**: All pending OffchainState changes (lockTrade, emergencyUnlock, etc.) are committed and become permanent.

---

## Data Flow Examples

### Example 1: Mina-Initiated Barter (Complete Flow)

**Scenario**: Alice wants to sell 100 MINA for ZEC. Bob wants to buy.

#### Phase 1: User Deposits MINA

```
Alice (UI)
  ↓
  Calls: MinaEscrowPool.deposit(tradeId, 100e9, aliceRefundAddr)
  ↓
Contract State:
  OffchainState.trades[tradeId] = {
    depositor: Alice,
    amount: 100e9,
    inTransit: false,
    claimant: PublicKey.empty(),
    ...
  }
```

**Not middleware involved** - User interacts directly with contract.

#### Phase 2: Buyer Clicks "Buy" on UI

```
Bob (UI)
  ↓
  POST /api/spawn-escrowd { tradeId, apiKey }
  ↓
Middleware (api-server.ts)
  ↓
  escrowdManager.spawn(tradeId, apiKey)
  ↓
  Spawns: escrowdv2 instance on port 8000 + hash(tradeId)
  ↓
  Returns: { success: true, port: 8123 }
  ↓
UI gets port → Bob deposits ZEC to escrowdv2
```

#### Phase 3: Both Sides Funded - Middleware Detects

**Poll Cycle 1** (middleware/coordinator.ts):

```
coordinator.poll()
  ↓
1. minaClient.getActiveTrades()
     ↓ GraphQL query to Mina network
     ↓ fetchMerkleMap() rebuilds OffchainState
     ↓ Returns: [{ tradeId, depositor: Alice, amount: 100e9, inTransit: false, ... }]
  ↓
2. For each trade:
     coordinator.processTrade(minaTrade)
       ↓
     coordinator.getCombinedState(tradeId)
       ↓
       minaClient.getTrade(tradeId)
         ↓ Returns: { inTransit: false, amount: 100e9, ... }
       ↓
       escrowdClient.getStatus(tradeId)
         ↓ HTTP GET http://127.0.0.1:8123/status
         ↓ Returns: { verified: true, in_transit: false, origin_address: "t1..." }
       ↓
       Returns: { readyToLock: true }  // Both funded, neither locked
  ↓
3. coordinator.lockBothSides(state, minaTrade)
```

#### Phase 4: Two-Phase Locking

**Step 1: Lock MINA** (coordinator.ts:262):

```
coordinator.lockBothSides()
  ↓
1. Resolve claimant (Bob's MINA address):
     fetchKeypairByZcash(bobZecAddress)
       ↓ Supabase query
       ↓ Returns: { minaPublicKey: "B62q...", zcashPublicKey: "t1..." }
     ↓
   claimantPk = PublicKey.fromBase58(bobMinaAddress)
  ↓
2. minaClient.lockTrade(tradeId, claimantPk)
     ↓
     Creates transaction: zkApp.lockTrade(tradeIdField, claimantPk)
     ↓
     Generates ZK proof (~10-30s)
     ↓
     Signs with operator key
     ↓
     Submits to Mina network
     ↓
     Waits for inclusion
     ↓
     Returns: txHash
  ↓
Contract State (after settlement):
  OffchainState.trades[tradeId].inTransit = true
  OffchainState.trades[tradeId].claimant = bobMinaAddress
```

**Step 2: Lock ZEC** (coordinator.ts:290):

```
coordinator.lockBothSides() (continued)
  ↓
3. escrowdClient.setInTransit(tradeId, minaTxHash, expectedMinaAmount, oracle)
     ↓
     HTTP PUT http://127.0.0.1:8123/set_in_transit
     Body: {
       expected_mina: "100000000000",
       mina_tx_hash: "CkpZ...",
       mina_usd: "0.50",
       zec_usd: "30.00",
       decimals: 10,
       ...
     }
     ↓
     Returns: { success: true }
  ↓
Escrowdv2 State:
  in_transit = true
  expected_mina = 100e9
  mina_tx_hash = "CkpZ..."
```

**If ZEC lock fails**:

```
coordinator.lockBothSides()
  ↓
  minaClient.emergencyUnlock(tradeId)
    ↓
    Creates transaction: zkApp.emergencyUnlock(tradeIdField)
    ↓
    Generates proof
    ↓
    Submits to network
    ↓
Contract State (after settlement):
  OffchainState.trades[tradeId].inTransit = false
  OffchainState.trades[tradeId].claimant = PublicKey.empty()
```

#### Phase 5: Bob Claims MINA

```
Bob (UI)
  ↓
  Calls: MinaEscrowPool.claim(tradeId)
  ↓
Contract validates:
  - trade.inTransit == true ✓
  - sender == trade.claimant (Bob's MINA address) ✓
  ↓
  Sends 100 MINA to Bob
  ↓
  Marks trade as completed
  ↓
Contract State:
  OffchainState.trades[tradeId] = TradeData.empty() (completed=true)
```

#### Phase 6: Middleware Sweeps ZEC to Bob

**Poll Cycle 2**:

```
coordinator.poll()
  ↓
1. minaClient.getActiveTrades()
     ↓ Returns: [] (trade no longer in map, completed=true)
  ↓
2. lockedTrades has tradeId cached
     ↓
   coordinator.handlePostClaim(tradeId, cachedTrade)
     ↓
     escrowdClient.sweep(tradeId, bobZecAddress)
       ↓
       HTTP PUT http://127.0.0.1:8123/sweep
       Body: { target_address: "t1BobZecAddr..." }
       ↓
       Returns: { success: true, tx_id: "..." }
     ↓
     lockedTrades.delete(tradeId)
```

**Trade Complete!**
- Bob received 100 MINA from contract
- Bob received ZEC from escrowdv2
- Alice's MINA successfully sold for ZEC

---

### Example 2: Clean Slate Recovery (Crash Recovery)

**Scenario**: Middleware crashes after locking MINA but before locking ZEC.

#### On Startup:

```
coordinator.initialize()
  ↓
  coordinator.cleanSlate()
    ↓
1. minaClient.getActiveTrades()
     ↓ Returns: [{ tradeId: "123", inTransit: true, ... }]
  ↓
2. For each locked trade:
     escrowdClient.getStatus(tradeId)
       ↓ Returns: { verified: true, in_transit: false }
       ↓ ZEC NOT locked but MINA IS locked - inconsistent state!
  ↓
3. minaClient.emergencyUnlock(tradeId)
     ↓ Creates transaction: zkApp.emergencyUnlock(tradeIdField)
     ↓ Submits to network
     ↓ Trade unlocked, Alice can refund
  ↓
  logger.info('✓ Emergency unlocked 123')
```

**Result**: Inconsistent state resolved, Alice can refund her MINA.

---

## Error Handling

### Transaction Failures

**Network Errors**:
```typescript
try {
  const txHash = await minaClient.lockTrade(tradeId, claimant);
  if (!txHash) {
    throw new Error('Failed to lock MINA side');
  }
} catch (error) {
  logger.error(`Failed to lock MINA trade: ${error}`);
  return null;  // Retry in next poll cycle
}
```

**Proof Generation Failures**:
- ZK proof generation can fail due to invalid state transitions
- Middleware logs error and retries in next poll cycle
- Settlement worker has 60s interval, will retry failed settlements

### State Consistency

**Two-Phase Locking Safety**:
1. Lock MINA first (reversible via emergencyUnlock)
2. Lock ZEC second (harder to reverse)
3. If ZEC lock fails, immediately unlock MINA

**Clean Slate Recovery**:
- On startup, middleware checks all locked MINA trades
- If corresponding ZEC trade not locked, emergency unlock MINA
- Prevents stuck funds from middleware crashes

### Retry Logic

**Lock Retry State** (`coordinator.ts:280-288`):
```typescript
const retry = this.lockRetryState.get(state.tradeId) ?? {
  attempts: 0,
  nextAttempt: 0,
};

const now = Date.now();
if (retry.nextAttempt && now < retry.nextAttempt) {
  logger.debug(`Skipping ZEC lock retry until ${new Date(retry.nextAttempt)}`);
  return;  // Exponential backoff
}
```

---

## Performance Characteristics

### Read Operations

| Operation | Latency | Network Calls |
|-----------|---------|---------------|
| `getActiveTrades()` | ~2-5s | 1 (archive query + fetchMerkleMap) |
| `getTrade(id)` | ~1-3s | 1 (GraphQL query) |
| `getPoolBalance()` | ~0.5-1s | 1 (GraphQL query) |

### Write Operations

| Operation | Latency | Network Calls |
|-----------|---------|---------------|
| `lockTrade()` | ~10-30s | 1 (with proof generation) |
| `emergencyUnlock()` | ~10-30s | 1 (with proof generation) |
| Settlement | ~5-6 min | 1 (proof + transaction) |

**Optimization**: Middleware compiles contracts once on startup and caches for all subsequent operations.

---

## Configuration

### Environment Variables

**Middleware** (`middleware/.env`):
```bash
# Network
MINA_GRAPHQL_ENDPOINT=https://devnet.zeko.io/graphql
MINA_POOL_ADDRESS=B62q...  # MinaEscrowPool contract address

# Operator
OPERATOR_PRIVATE_KEY=EKE...

# Polling
POLL_INTERVAL_MS=15000  # Poll every 15 seconds
```

**Contract** (deployed with specific addresses):
```typescript
// Zeko L2 Devnet
Contract Address: B62qrbDCjDYEypocUpG3m6eL62zcvexsaRjhSJp5JWUQeny1qVEKbyP
Operator: B62qod2DugDjy9Jxhzd56gFS7npN8pWhanxxb36MLPzDDqtzzDyBy5z
```

---

## Summary

### Communication Flow

```
Middleware (Read)
  └─▶ GraphQL Query ─▶ Mina Network ─▶ MinaEscrowPool
                                          └─▶ OffchainState.trades

Middleware (Write)
  └─▶ Create Transaction ─▶ Generate Proof ─▶ Sign ─▶ Submit
                                                        └─▶ MinaEscrowPool
                                                              └─▶ Update OffchainState

Settlement Worker
  └─▶ Check Pending Actions ─▶ Generate Settlement Proof ─▶ Submit
                                                              └─▶ Commit Changes On-Chain
```

### Key Takeaways

1. **Stateless Architecture**: Middleware has no database, queries both chains every poll cycle
2. **Two-Phase Locking**: MINA locked first (reversible), ZEC locked second
3. **Crash Recovery**: Clean slate on startup emergency unlocks inconsistent states
4. **Settlement Required**: All OffchainState changes must be settled within reasonable time
5. **Performance**: Zeko L2 provides 10-25s finality vs Mina L1's 3+ minutes
6. **Security**: Operator-only operations protected by signature verification

---

**For Questions**:
- Middleware Architecture: See `middleware/README.md`
- Contract Specification: See `escrowm/README.md`
- Deployment Guide: See `escrowm/DEPLOY_ZEKO.md`
