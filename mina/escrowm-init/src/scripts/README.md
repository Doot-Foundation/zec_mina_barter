# Doot Barter Swap - Integration Test Scripts

Comprehensive onchain integration tests for MINA ↔ ZEC atomic swaps on Zeko L2.

## Overview

This test suite validates the MinaEscrowPool smart contract with real onchain transactions. All MINA operations are executed on Zeko L2, while ZEC side operations are mocked for testing purposes.

## Test Scenarios

### Scenario 1: MINA Sell Initialization
**Directory**: `mina_sell_initialization/`

Alice wants to sell 1 MINA for ZEC. Bob wants to buy MINA with ZEC.

**Flow**:
1. Alice deposits 1 MINA to escrow
2. Operator verifies deposit
3. Bob sends ZEC to Alice (MOCKED)
4. Operator locks trade for Bob
5. Bob claims 1 MINA from escrow
6. Settlement proof generated
7. Final verification

### Scenario 2: ZEC Sell Initialization
**Directory**: `zec_sell_initialization/`

Bob wants to sell ZEC for MINA. Alice wants to buy ZEC with MINA.

**Flow**:
1. Alice deposits 1 MINA to escrow
2. Operator verifies deposit
3. Bob sends ZEC to Alice (MOCKED)
4. Operator locks trade for Bob
5. Bob claims 1 MINA from escrow
6. Settlement proof generated
7. Final verification

## Prerequisites

### Environment Setup

Create `.env` file in `mina/escrowm-init/` with:

```env
# Test Accounts (each needs ~50 MINA on Zeko L2)
USER_1_KEY=EKE...    # Alice's private key
USER_2_KEY=EKE...    # Bob's private key
OPERATOR_KEY=EKE...  # Operator's private key (from deployment)
```

### Requirements

- Node.js >= 18.14.0
- All accounts funded with at least 50 MINA on Zeko L2
- Contract deployed at: `B62qmg7giAqEhf7UdZamqYumnQotExwQFXEeuuW2Yze7V67ZtgFKNmo`

### Build

```bash
cd mina/escrowm-init
npm install
npm run build
```

## Running Tests

### Option 1: Run Full Test Suite (Recommended)

Execute all tests sequentially:

```bash
cd mina/escrowm-init/src/scripts
chmod +x run-all.sh
./run-all.sh
```

**Expected Duration**: ~28 minutes
- Scenario 1: ~14 minutes
- Scenario 2: ~14 minutes
- Includes 2 settlement proofs (5-6 minutes each)

### Option 2: Run Individual Scenario

#### MINA Sell Initialization

```bash
cd mina/escrowm-init

# Run each step sequentially
node build/src/scripts/mina_sell_initialization/0_msi_setup.js
node build/src/scripts/mina_sell_initialization/1_msi_deposit.js
node build/src/scripts/mina_sell_initialization/2_msi_verify_deposit.js
node build/src/scripts/mina_sell_initialization/3_msi_lock.js
node build/src/scripts/mina_sell_initialization/4_msi_claim.js
node build/src/scripts/mina_sell_initialization/5_msi_settle.js  # 5-6 minutes
node build/src/scripts/mina_sell_initialization/6_msi_verify_final.js
```

#### ZEC Sell Initialization

```bash
cd mina/escrowm-init

# Run each step sequentially
node build/src/scripts/zec_sell_initialization/0_zsi_setup.js
node build/src/scripts/zec_sell_initialization/1_zsi_deposit.js
node build/src/scripts/zec_sell_initialization/2_zsi_verify_deposit.js
node build/src/scripts/zec_sell_initialization/3_zsi_lock.js
node build/src/scripts/zec_sell_initialization/4_zsi_claim.js
node build/src/scripts/zec_sell_initialization/5_zsi_settle.js  # 5-6 minutes
node build/src/scripts/zec_sell_initialization/6_zsi_verify_final.js
```

## Script Details

### Shared Utilities

**`shared/test-utils.ts`**
- Network setup and configuration
- Account loading from .env
- Contract compilation (~50 seconds per script)
- Balance tracking and logging
- Transaction helpers
- Elaborate logging functions

**`shared/mock-zec.ts`**
- Mock ZEC address generation (t-addresses)
- Mock transaction hash generation
- Amount conversion (ZEC ↔ zatoshis)
- Exchange rate calculation (1 MINA = 0.02 ZEC)
- Mock data logging with clear "🪙 MOCK ZEC" labeling

**`shared/state-manager.ts`**
- Trade state initialization
- JSON file persistence (`.state/` directory)
- State loading and updating
- Transaction hash tracking
- Trade completion marking

### Step-by-Step Breakdown

#### Step 0: Setup
- Compiles contract and offchain state
- Generates unique trade UUID
- Creates mock ZEC trade data
- Initializes state file
- Logs initial balances

**Duration**: ~80 seconds

#### Step 1: Deposit
- User deposits 1 MINA to escrow
- Generates transaction proof
- Sends transaction on Zeko L2
- Waits 20 seconds for confirmation
- Updates state with transaction hash

**Duration**: ~80 seconds

#### Step 2: Verify Deposit
- Queries offchain state for trade
- Verifies deposit data
- Confirms trade not locked yet
- May show warning if settlement not occurred

**Duration**: ~60 seconds

#### Step 3: Lock Trade
- Simulates ZEC confirmation (mock)
- Operator locks trade for claimant
- Sets `inTransit = true`
- Updates state with lock transaction

**Duration**: ~80 seconds

#### Step 4: Claim
- Claimant withdraws locked MINA
- Verifies balance changes
- Analyzes transaction fees
- Trade marked as completed

**Duration**: ~80 seconds

#### Step 5: Settlement
- Generates ZK settlement proof
- Commits offchain state on-chain
- Updates Merkle root commitment
- Enables offchain state queries

**Duration**: ~6.8 minutes (50s compile + 5-6min proof)

#### Step 6: Final Verification
- Queries offchain state after settlement
- Verifies all transaction hashes
- Confirms trade completion
- Marks trade as completed in state file
- Displays comprehensive summary

**Duration**: ~60 seconds

## State Management

### State Files

**Location**: `src/scripts/.state/`

**Files**:
- `mina_sell_state.json` - Scenario 1 state
- `zec_sell_state.json` - Scenario 2 state

### State File Structure

```json
{
  "tradeId": "550e8400-e29b-41d4-a716-446655440000",
  "tradeIdField": "123456789...",
  "depositor": "B62qk...",
  "claimant": "B62qj...",
  "amount": "1000000000",
  "depositTxHash": "5Jt...",
  "lockTxHash": "5Ju...",
  "claimTxHash": "5Jv...",
  "settleTxHash": "5Jw...",
  "zecTradeData": {
    "sellerAddress": "t1abc...",
    "buyerAddress": "t1def...",
    "amount": "50000000",
    "txHash": "abc123...",
    "confirmations": 6
  },
  "createdAt": 1234567890000,
  "completedAt": 1234567890000
}
```

## Logging

All scripts include elaborate logging:

- **Visual Headers**: Box-style headers for each script
- **Phase Indicators**: Clear labels for each operation phase
- **Account Information**: All addresses with readable truncation
- **Balance Tracking**: Before/after balances for every operation
- **Transaction Details**: Full hashes, amounts, explorer links
- **Mock Data Labeling**: All ZEC data clearly marked with "🪙 MOCK ZEC"
- **Progress Indicators**: Compilation and settlement progress
- **Success/Error Markers**: Clear ✅/❌/⚠️ indicators
- **Summary Sections**: End-of-script operation summaries

## Technical Details

### Compilation

**CRITICAL**: Every script compiles the contract independently (~50 seconds per script).

**Compilation Order**:
1. `offchainState.compile()` - FIRST
2. `MinaEscrowPool.compile()` - SECOND
3. `setContractInstance()` - Required binding

**Why**: No compilation caching between scripts to ensure independence.

### Transaction Flow

**Pattern**:
```typescript
const txn = await Mina.transaction({ sender, fee: 0.4 MINA }, async () => {
  await zkApp.method(...);
});
await txn.prove();
const sentTx = await txn.sign([key]).send();
await waitFor20Seconds();
```

### Settlement Proofs

**Duration**: 5-6 minutes (expected)
**Purpose**: Commit batched offchain state changes on-chain
**Frequency**: Once per scenario (after all operations)
**Memory**: Requires sufficient RAM for proof generation

### Network Details

- **Network**: Zeko L2 Devnet
- **GraphQL**: https://devnet.zeko.io/graphql
- **Explorer**: https://zekoscan.io/testnet
- **Finality**: 10-25 seconds (vs Mina L1's 3+ minutes)
- **Fees**: 0.4 MINA for all transactions

## Troubleshooting

### Common Issues

#### 1. Insufficient Balance
**Error**: Transaction fails due to low balance
**Solution**: Fund accounts with at least 50 MINA each on Zeko L2

#### 2. Compilation Timeout
**Error**: Script times out during compilation
**Solution**: Increase Node.js memory: `NODE_OPTIONS=--max-old-space-size=8192`

#### 3. Settlement Proof Fails
**Error**: Settlement proof generation fails
**Solution**:
- Ensure sufficient memory (8GB+ RAM recommended)
- Check that previous operations created offchain state actions
- Retry settlement script

#### 4. Offchain State Not Found
**Warning**: Trade not found when querying offchain state
**Reason**: Expected before settlement - offchain state requires settlement to be queryable
**Solution**: Continue to next step, settlement will make it queryable

#### 5. Network Connectivity
**Error**: GraphQL errors or timeouts
**Solution**:
- Check Zeko L2 network status
- Verify internet connection
- Retry the failed script

### Debug Tips

1. **Check State Files**: Review `.state/*.json` for transaction hashes and data
2. **ZekoScan Explorer**: Verify transactions at https://zekoscan.io/testnet
3. **Balance Verification**: Ensure accounts have sufficient funds before each step
4. **Sequential Execution**: Always run scripts in order (0 → 1 → 2 → ... → 6)
5. **Clean State**: Remove old state files before new test runs

## Performance Metrics

### Expected Timings

| Operation | Duration | Notes |
|-----------|----------|-------|
| Setup | ~80s | Compilation + initialization |
| Deposit | ~80s | Compilation + transaction |
| Verify Deposit | ~60s | Compilation + query |
| Lock | ~80s | Compilation + transaction |
| Claim | ~80s | Compilation + transaction |
| Settlement | ~6.8min | Compilation + 5-6min proof |
| Final Verify | ~60s | Compilation + verification |
| **Per Scenario** | **~14min** | Total for 7 steps |
| **Full Suite** | **~28min** | Both scenarios |

### Resource Usage

- **CPU**: High during compilation and proof generation
- **Memory**: 4-8GB recommended (8GB+ for settlement proofs)
- **Network**: Moderate (frequent Zeko L2 queries)
- **Storage**: Minimal (state files ~5KB each)

## Contract Information

- **Address**: `B62qmg7giAqEhf7UdZamqYumnQotExwQFXEeuuW2Yze7V67ZtgFKNmo`
- **Network**: Zeko L2 Devnet
- **Owner**: Configured via OPERATOR_KEY
- **Version**: 0.2.0
- **Explorer**: [View on ZekoScan](https://zekoscan.io/testnet/account/B62qmg7giAqEhf7UdZamqYumnQotExwQFXEeuuW2Yze7V67ZtgFKNmo)

## Mock ZEC Details

All ZEC operations are mocked for testing:

- **Addresses**: Random t-addresses (format: `t1{32 chars}`)
- **Transaction Hashes**: Random 64-character hex strings
- **Amounts**: Calculated at 1 MINA = 0.02 ZEC (50:1 ratio)
- **Confirmations**: Fixed at 6 (standard safe confirmation count)
- **Labeling**: All mock data clearly marked with "🪙 MOCK ZEC" in logs

## Success Criteria

Each scenario is considered successful when:

✅ All 7 scripts execute without errors
✅ All transaction hashes recorded in state file
✅ Balance changes match expected amounts
✅ Settlement proof generated and committed
✅ Final verification confirms trade completion
✅ State file shows `completedAt` timestamp

## Next Steps

After running tests successfully:

1. **Review Transactions**: Check all transaction hashes on ZekoScan
2. **Verify Balances**: Confirm account balances changed as expected
3. **Analyze State**: Review state files for complete trade data
4. **Check Logs**: Look for any warnings or unexpected behavior
5. **Production Readiness**: Use these patterns for real ZEC integration

## Support

For issues or questions:

1. Check troubleshooting section above
2. Review script logs for detailed error messages
3. Verify all prerequisites are met
4. Ensure accounts are properly funded
5. Check Zeko L2 network status

---

**Generated**: Integration test suite for Doot Barter Swap MINA ↔ ZEC atomic swaps
**Contract**: MinaEscrowPool v0.2.0 on Zeko L2 Devnet
