# MINA ↔ ZEC Barter Protocol - Project Documentation

Decentralized atomic swap protocol between Mina Protocol and Zcash, enabling trustless peer-to-peer exchanges without intermediaries.

---

## Overview

This protocol enables **atomic swaps** between MINA and ZEC using a hybrid architecture:

- **MINA Side**: Shared pool zkApp (MinaEscrowPool) with OffchainState
- **ZEC Side**: Per-trade escrowdv2 instances (off-chain Rust daemons)
- **Coordination**: Stateless middleware monitors both chains and locks trades

### Key Features

- ✅ **No Database**: All state lives on-chain or in escrowd instances
- ✅ **Privacy-Preserving**: Pool architecture breaks on-chain linkability
- ✅ **Trustless**: Smart contracts + cryptographic verification
- ✅ **Secure**: Both sides locked atomically before claims
- ✅ **Refund Safety**: Users can recover funds if counterparty fails

---

## Architecture

```
┌────────────────────────────────────────────────────┐
│                    Middleware                       │
│              (Stateless Coordinator)                │
│                                                      │
│  • Monitors both chains every 15s                   │
│  • Locks both sides when both funded                │
│  • No database - queries blockchain                 │
└──────────────┬────────────────┬─────────────────────┘
               │                │
               ▼                ▼
    ┌──────────────────┐  ┌──────────────────┐
    │  MinaEscrowPool  │  │  escrowdv2 (ZEC) │
    │   (Zeko L2)      │  │  Per-trade       │
    │                  │  │  instances       │
    │  • Shared pool   │  │  • Port 8000+    │
    │  • OffchainState │  │  • Shielded      │
    │  • 1B trades     │  │  • Operator API  │
    └──────────────────┘  └──────────────────┘
```

### Components

#### 1. MinaEscrowPool (Mina zkApp)

**Purpose**: Holds MINA deposits for all trades in a shared pool

**Technology**: o1js 2.0 with OffchainState

**Key Features**:
- **Shared Pool**: Single contract for all trades (privacy-preserving)
- **OffchainState**: Unlimited trade capacity (~1 billion trades)
- **Operator-Controlled**: Only operator can lock trades
- **Emergency Recovery**: Operator can unlock failed trades
- **Settlement Proofs**: Batched off-chain state commitments (~5-6 min)

**Methods**:
- `deposit(tradeId, amount, refundAddress)` - User deposits MINA
- `lockTrade(tradeId, claimant)` - Operator locks when ZEC funded
- `claim(tradeId)` - Claimant withdraws MINA
- `refund(tradeId)` - Depositor refunds if not locked
- `emergencyUnlock(tradeId)` - Operator unlocks failed trades
- `settle(proof)` - Commit off-chain state changes

**Data Structure**:
```typescript
TradeData {
  tradeId: Field,              // UUID as Poseidon hash
  depositor: PublicKey,        // Original MINA depositor
  amount: UInt64,              // MINA amount in nanomina
  inTransit: Bool,             // Locked by operator
  claimant: PublicKey,         // Who can claim MINA
  refundAddress: PublicKey,    // Refund destination
  depositBlockHeight: UInt32,  // When deposited
  expiryBlockHeight: UInt32,   // Expiry time
  completed: Bool              // Trade finished
}
```

#### 2. escrowdv2 (Zcash Escrow Daemon)

**Purpose**: Per-trade Zcash escrow service (one instance per trade)

**Technology**: Rust with Axum HTTP server, zcashd RPC backend

**Key Features**:
- **Per-Trade Instances**: Each trade gets dedicated escrowd
- **Shielded Support**: Sapling shielded addresses
- **Origin Binding**: One-time funding with verification
- **Mina Verification**: Validates Mina tx before locking
- **Operator-Protected**: Requires bearer token for sensitive ops
- **Full Balance Sweeps**: Always sends entire balance

**API Endpoints**:
- `GET /address` - Get escrow address (shielded or transparent)
- `GET /status` - Check verified/inTransit status
- `POST /funding/shielded` - Bind shielded funding (with memo verification)
- `POST /funding/transparent` - Bind transparent funding (with signature)
- `POST /set-in-transit` - Lock ZEC (operator only, requires Mina tx)
- `POST /send-back` - Refund to origin (when not locked)
- `POST /send-target` - Send to target (operator only, when locked)

**State Machine**:
```
UNVERIFIED → [funding] → VERIFIED
VERIFIED → [set-in-transit] → IN_TRANSIT
VERIFIED → [send-back] → COMPLETE (refund)
IN_TRANSIT → [send-target] → COMPLETE (success)
```

#### 3. Middleware (Coordinator)

**Purpose**: Stateless coordinator monitoring both chains

**Technology**: TypeScript with o1js integration

**Key Features**:
- **Stateless**: No database, all state from blockchain
- **Archive-Driven**: Rebuilds OffchainState from archive actions
- **Supabase Integration**: Keypairs table for address mapping
- **Automatic Settlement**: Background worker for proofs
- **Error Recovery**: Emergency unlock on ZEC lock failure
- **Retry Logic**: 5 attempts with 60s backoff

**Process Flow**:
1. Poll MinaEscrowPool via archive (rebuild OffchainState map)
2. For each active trade, poll corresponding escrowd instance
3. When both funded and neither locked → lock both atomically
4. When MINA claimed → send ZEC to depositor
5. If ZEC lock fails → emergency unlock MINA

**Configuration**:
- Operator private key (pays for Mina transactions)
- MinaEscrowPool contract address
- Escrowd base URL/port/range
- Supabase credentials (keypairs table)
- Polling interval (default 15s)

---

## Trade Flow (Complete Example)

### Actors

- **Alice**: Wants to sell 10 MINA for 0.05 ZEC
- **Bob**: Wants to buy 10 MINA for 0.05 ZEC
- **Operator/Middleware**: Coordinates the swap

### Prerequisites

1. Middleware generates UUID: `550e8400-e29b-41d4-a716-446655440000`
2. Derives trade ID Field: `Poseidon(UUID)`
3. Calculates escrowd port: `hash(UUID) % 10000 + 8000 = 8423`
4. Starts escrowd instance at port 8423

### Step-by-Step Flow

#### 1. Alice Deposits MINA

```typescript
// Alice calls deposit() on MinaEscrowPool
await zkApp.deposit(
  tradeIdField,                    // Field(0x550e8400...)
  UInt64.from(10_000_000_000),     // 10 MINA in nanomina
  aliceMinaRefundAddress           // Her refund address
);
// OffchainState action emitted
// Trade status: deposited, inTransit=false
```

#### 2. Bob Deposits ZEC

```bash
# Bob sends shielded ZEC with memo
zcash-cli z_sendmany "zbob..." '[{
  "address": "zescrow_8423...",
  "amount": 0.05,
  "memo": "550e8400-e29b-41d4-a716-446655440000"
}]'

# Bob binds funding to escrowd
curl http://127.0.0.1:8423/funding/shielded -d '{
  "api_key": "shared_secret",
  "memo": "550e8400-e29b-41d4-a716-446655440000",
  "origin_address": "zbob_refund..."
}'
# escrowd verifies memo on-chain, sets verified=true
```

#### 3. Middleware Detects Both Funded

```typescript
// Middleware polls every 15 seconds
const minaTrade = await getTradeFromArchive(tradeId);
const zecStatus = await fetch(`http://127.0.0.1:8423/status`);

// Both conditions met:
// - minaTrade.inTransit === false
// - zecStatus.verified === true && zecStatus.inTransit === false
// → Ready to lock both sides
```

#### 4. Middleware Locks Both Sides

```typescript
// Step 4a: Lock MINA side first
const bobMinaAddress = lookupMinaAddress(zecStatus.origin_address);
await zkApp.lockTrade(tradeIdField, bobMinaAddress);
// MINA trade now locked (inTransit=true, claimant=Bob)

// Step 4b: Lock ZEC side
const minaLockTxHash = "5Ju...";  // Hash from step 4a
await fetch(`http://127.0.0.1:8423/set-in-transit`, {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${OPERATOR_TOKEN}` },
  body: JSON.stringify({ mina_tx_hash: minaLockTxHash })
});
// ZEC escrowd validates Mina tx, sets inTransit=true
// Both sides now locked atomically
```

#### 5. OffchainState Settlement

```typescript
// Settlement worker (runs in background)
// Detects pending actions, generates proof (~5-6 minutes)
const proof = await generateSettlementProof();
await zkApp.settle(proof);
// OffchainState changes now committed on-chain
// Query operations now work
```

#### 6. Bob Claims MINA

```typescript
// Bob calls claim() on MinaEscrowPool
await zkApp.claim(tradeIdField);
// Bob receives 10 MINA
// Trade removed from OffchainState (completed=true)
```

#### 7. Alice Claims ZEC

```typescript
// Middleware observes trade disappeared from OffchainState
// (or could be triggered manually by operator)
const aliceZecAddress = lookupZcashAddress(minaTrade.depositor);
await fetch(`http://127.0.0.1:8423/send-target`, {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${OPERATOR_TOKEN}` },
  body: JSON.stringify({ target_address: aliceZecAddress })
});
// Alice receives 0.05 ZEC
// escrowd instance exits and cleans up
```

#### 8. Cleanup

- MINA trade removed from OffchainState
- ZEC escrowd process exits
- Data directories can be archived/deleted
- Ports freed for reuse

---

## Error Recovery

### Scenario 1: ZEC Lock Fails After MINA Lock

```typescript
// Middleware attempts ZEC lock 5 times with 60s backoff
for (let i = 0; i < 5; i++) {
  try {
    await lockZecSide(tradeId);
    break;
  } catch (e) {
    if (i === 4) {
      // Final attempt failed, emergency unlock MINA
      await zkApp.emergencyUnlock(tradeIdField);
      // Alice can now refund her MINA
    }
    await sleep(60000);
  }
}
```

### Scenario 2: Middleware Crashes

```typescript
// On restart:
// 1. Rebuild OffchainState from archive actions
// 2. Query all escrowd instances
// 3. Resume from current state (stateless design)
// No data loss because all state is on-chain or in escrowd
```

### Scenario 3: User Wants Refund

```typescript
// If MINA not locked (inTransit=false):
await zkApp.refund(tradeIdField);
// Depositor gets MINA back

// If ZEC not locked:
await fetch(`http://127.0.0.1:8423/send-back`, {
  method: 'POST',
  body: JSON.stringify({
    api_key: "shared_secret",
    signed_message: signature  // If transparent origin
  })
});
// Origin address gets ZEC back
```

---

## Performance & Timing

### Trade Completion Timeline

| Stage | Time | Network | Notes |
|-------|------|---------|-------|
| Alice deposits MINA | ~30s | Zeko L2 | Fast finality |
| Bob deposits ZEC | ~5-10min | Zcash | Shielded confirmation |
| Middleware detects | ~15s | Polling | Configurable interval |
| Lock MINA | ~30s | Zeko L2 | Proof generation |
| OffchainState settlement | ~5-6min | Batched | Automatic |
| Lock ZEC | ~10s | API | HTTP call |
| Bob claims MINA | ~30s | Zeko L2 | Proof generation |
| Alice claims ZEC | ~10s | Zcash | Shielded sweep |
| **Total** | **~12-18min** | End-to-end | Full cycle |

### Bottlenecks

1. **OffchainState Settlement**: 5-6 minutes (unavoidable batch proof)
2. **ZEC Shielded Confirmation**: 5-10 minutes (blockchain depth)
3. **Proof Generation**: ~30 seconds per MINA transaction

### Optimizations

- **Zeko L2**: 10-25s finality vs Mina L1's 3-5 min
- **Polling Interval**: Reduce to 5s for faster detection
- **Parallel Settlement**: Background worker runs continuously
- **Batch Trades**: Multiple trades in single settlement proof

---

## Security Model

### Trust Assumptions

1. **Middleware/Operator Honesty**: Must lock both sides atomically
2. **Smart Contract Correctness**: MinaEscrowPool logic must be sound
3. **Blockchain Security**: Mina and Zcash consensus must be secure
4. **Escrowd Isolation**: Each trade has dedicated instance

### Attack Vectors & Mitigations

| Attack | Mitigation |
|--------|------------|
| Middleware locks only one side | Atomic locking code + retry logic + emergency unlock |
| User refunds after counterparty deposits | Operator lock prevents refunds |
| Front-running deposits | Claimant assigned by operator after both funded |
| Middleware downtime | Trades can be refunded (no loss scenario) |
| Escrowd compromise | Single-trade impact, operator token required |
| Double-spend on ZEC | Confirmation depth + zcashd verification |
| Fake Mina tx for ZEC lock | escrowd validates tx on-chain via GraphQL |

### Privacy Considerations

**MINA Side**:
- ✅ Pool breaks linkability: Alice→Pool, Pool→Bob (not Alice→Bob)
- ❌ Middleware knows full mapping (necessary for coordination)
- ❌ On-chain amounts visible (OffchainState)
- ⚠️ Timing analysis may correlate trades

**ZEC Side**:
- ✅ Shielded transactions hide sender/amount (ZK proofs)
- ❌ Transparent fallback has full visibility
- ✅ Memo privacy: Only escrowd and sender see memo

---

## Data Structures

### MinaEscrowPool State

```typescript
// On-chain (8 Fields max)
@state(PublicKey) operator = State<PublicKey>();

// Off-chain (unlimited)
offchainState = OffchainState({
  trades: OffchainState.Map(Field, TradeData)
}, {
  logTotalCapacity: 30,      // 2^30 = ~1B trades
  maxActionsPerUpdate: 5      // Batch size
});
```

### escrowdv2 State

```rust
struct EscrowState {
    escrow_address: String,     // Shielded or transparent
    verified: bool,             // Origin bound and verified
    in_transit: bool,           // Locked by middleware
    origin: Option<OriginBinding>,
    mina_tx_hash: Option<String>,
}

struct OriginBinding {
    origin_type: OriginType,    // Shielded or Transparent
    origin_address: String,     // Refund destination
}
```

### Supabase Schema

```sql
-- keypairs table (for address mapping)
CREATE TABLE keypairs (
  id UUID PRIMARY KEY,
  Mina_PublicKey TEXT NOT NULL UNIQUE,
  Zcash_PublicKey TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## API Reference

### MinaEscrowPool Methods

```typescript
// User methods
deposit(tradeId: Field, amount: UInt64, refundAddress: PublicKey)
claim(tradeId: Field)
refund(tradeId: Field)

// Operator methods (signature required)
initOperator()
lockTrade(tradeId: Field, claimant: PublicKey)
emergencyUnlock(tradeId: Field)

// Settlement (anyone can call)
settle(proof: TradeProof)
```

### escrowdv2 Endpoints

```bash
# Public endpoints
GET  /address                     # Get escrow address
GET  /status                      # Get verified/inTransit status
GET  /balance                     # Get current balance
GET  /health                      # Health check
POST /funding/shielded            # Bind shielded funding
POST /funding/transparent         # Bind transparent funding
POST /send-back                   # Refund to origin (requires api_key)

# Operator endpoints (require bearer token)
POST /set-in-transit              # Lock ZEC side
POST /send-target                 # Send to target address
```

---

## Project Structure

```
zec_barter/
├── escrowm/                    # MinaEscrowPool zkApp
│   ├── src/
│   │   ├── MinaEscrowPool.ts   # Main contract
│   │   ├── utils.ts            # UUID/Field conversion
│   │   ├── deploy-zeko.ts      # Zeko L2 deployment
│   │   └── MinaEscrowPool.test.ts
│   └── package.json
│
├── zcash/escrowdv2/            # Zcash escrow daemon
│   ├── src/
│   │   ├── main.rs             # HTTP server
│   │   ├── wallet.rs           # Wallet operations
│   │   ├── zcashd.rs           # RPC client
│   │   ├── state.rs            # State machine
│   │   ├── api.rs              # REST endpoints
│   │   └── mina.rs             # Mina verification
│   ├── tests/
│   │   └── *.rs                # Integration tests
│   └── Cargo.toml
│
├── middleware/                 # Stateless coordinator
│   ├── src/
│   │   ├── index.ts            # Entry point
│   │   ├── coordinator.ts      # Main loop
│   │   ├── mina-client.ts      # Archive queries
│   │   └── escrowd-client.ts   # Escrowd API
│   └── package.json
│
└── zcash/lightwalletd/         # Lightwalletd Docker setup
    └── docker-compose.yml
```

---

## Development Status

### Current Status (MVP)

- ✅ MinaEscrowPool contract with OffchainState
- ✅ escrowdv2 daemon with shielded support
- ✅ Middleware coordinator (stateless)
- ✅ Deployment scripts (Zeko L2)
- ✅ Unit tests (64/64 passing for escrowdv2)
- ✅ Contract tests (11 test cases)

### Known Limitations

- ⚠️ Operator centralization (single point of trust)
- ⚠️ 5-6 minute settlement delay (OffchainState)
- ⚠️ Manual trade initiation (no order book yet)
- ⚠️ No web UI (CLI only)
- ⚠️ Testnet only (not production ready)

### Roadmap

**Short Term**:
- [ ] Complete integration tests (135 tests deferred)
- [ ] Web UI for trade creation
- [ ] Monitoring dashboard
- [ ] Automated escrowd spawning

**Medium Term**:
- [ ] Decentralized operator network
- [ ] Order book (on-chain or off-chain)
- [ ] Multi-asset support (USDC, BTC)
- [ ] Partial fills

**Long Term**:
- [ ] Mainnet deployment
- [ ] ZK privacy for MINA amounts
- [ ] Cross-chain DEX integration
- [ ] Mobile app

---

## Contributing

1. **Smart Contracts**: Follow o1js best practices
2. **Rust Code**: Run `cargo fmt` and `cargo clippy`
3. **TypeScript**: Use strict mode and ESLint
4. **Testing**: Add tests for all features
5. **Documentation**: Update docs for significant changes

---

## Resources

- **Mina Protocol**: https://docs.minaprotocol.com/
- **o1js Framework**: https://docs.minaprotocol.com/zkapps/o1js
- **Zeko L2**: https://zeko.io/
- **Zcash**: https://zcash.readthedocs.io/
- **Lightwalletd**: https://github.com/zcash/lightwalletd

---

**Status**: MVP Complete (Testnet Only)
**Network**: Zeko L2 Devnet + Zcash Testnet
**Version**: 0.1.0
**License**: Apache-2.0
