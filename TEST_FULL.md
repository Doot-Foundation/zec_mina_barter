# End-to-End Integration Test Plan: ZEC ↔ MINA Atomic Swap

## Overview

Transform the current mock-based test scripts into a complete end-to-end integration test system that:
- Uses **real middleware** (spawns real escrowdv2 instances)
- Uses **real ZEC blockchain** (zcashd + lightwalletd)
- Uses **real MINA blockchain** (Zeko L2)
- Provides **clear user prompts** for manual ZEC funding steps
- Implements **automatic cleanup** on failures

## User Requirements (Confirmed)

- ✅ **Middleware**: Manual startup in separate terminal
- ✅ **ZEC Wallets**: Use existing accounts 0 and 1 (already funded)
- ✅ **Test Organization**: Separate runners (`npm run test:msi-real` and `npm run test:zsi-real`)
- ✅ **Failure Handling**: Automatic cleanup with emergencyUnlock

---

## Architecture: Service Communication

```
Terminal 1: Middleware                Terminal 2: Test Scripts
┌──────────────────────┐             ┌──────────────────────┐
│ npm start            │             │ npm run test:msi-real│
│                      │             │                      │
│ Coordinator Polling  │◄───────────►│ HTTP Calls:          │
│ - Detects trades     │             │ /api/spawn-escrowd   │
│ - Locks both sides   │             │ /api/escrowd/status  │
│                      │             │                      │
│ Spawns escrowdv2 ──► │             │ User ZEC Funding:    │
│   Port 8000-18000    │◄───────────►│ - Query /address     │
│   Per-trade isolated │             │ - Send shielded ZEC  │
│                      │             │ - Wait for verify    │
└──────────────────────┘             └──────────────────────┘
         │ │                                    │
         │ └────────────────┐                  │
         │                  │                  │
         ▼                  ▼                  ▼
┌──────────────┐   ┌──────────────┐   ┌──────────────┐
│ Zeko L2      │   │ escrowdv2    │   │ zcashd       │
│ MinaEscrow   │   │ REST API     │   │ testnet      │
│ Pool         │   │ (spawned)    │   │ + lightwalletd│
└──────────────┘   └──────────────┘   └──────────────┘
```

---

## Implementation Plan

### Phase 1: Create Real ZEC Integration Module

**New File**: `/mina/escrowm-init/src/scripts/shared/real-zec.ts`

**Purpose**: Replace all mock-zec.ts functionality with real middleware + escrowdv2 integration

**Key Functions**:

```typescript
// Middleware API Client
async function spawnEscrowdInstance(tradeId: string, apiKey: string): Promise<{
  success: boolean;
  port: number;
  address: string;  // ZEC unified address from GET /address
}>

async function getEscrowdStatus(tradeId: string, port: number): Promise<{
  verified: boolean;
  in_transit: boolean;
  origin_address?: string;
  received_amount?: string;
}>

async function killEscrowdInstance(tradeId: string): Promise<boolean>

// User Interaction Prompts
async function promptUserToFundZec(
  escrowAddress: string,
  expectedZec: number,
  apiKey: string,
  fromAccount: number  // 0 or 1
): Promise<void>
// Displays:
// - Escrow address
// - Amount needed
// - Copy-paste zcash-cli command with account 0 or 1
// - Waits for user to press ENTER
// - Then polls getEscrowdStatus() until verified=true

// Utilities
function calculateZecFromOracle(minaAmount: number): Promise<number>
// Uses middleware oracle endpoint or direct Doot API call

function generateApiKey(): string
// Random 32-char key for this trade instance
```

**Implementation Details**:

1. **HTTP Client**: Use `node-fetch` or `axios` to call middleware API
   - Base URL: `http://127.0.0.1:3000` (configurable)
   - Timeout: 30 seconds for spawn, 5 seconds for status checks

2. **Middleware Health Check**: Add utility to verify middleware is running
   ```typescript
   async function ensureMiddlewareRunning(): Promise<void> {
     try {
       const response = await fetch('http://127.0.0.1:3000/health');
       if (!response.ok) throw new Error();
     } catch (err) {
       console.error('❌ Middleware not running!');
       console.error('   Start it in another terminal: cd middleware && npm start');
       process.exit(1);
     }
   }
   ```

3. **User Prompt Format**:
   ```
   ═══════════════════════════════════════════════════════════════
     🪙 ACTION REQUIRED: Fund ZEC Escrow
   ═══════════════════════════════════════════════════════════════

   Trade ID: 550e8400-e29b-41d4-a716-446655440000
   Escrow Address: utest1ttt7ggr22jutu4dlvw8649...
   Amount Required: 0.02000000 ZEC

   Copy-paste this command in another terminal:

   curl -u zcashrpc:your_secure_password_here_change_me \
     --data-binary '{"jsonrpc":"1.0","id":"fund","method":"z_sendmany","params":[0,[{"address":"utest1ttt7ggr22jutu4dlvw8649...","amount":0.02,"memo":"<API_KEY>"}]]}' \
     -H 'content-type: text/plain;' \
     http://127.0.0.1:18232/

   Then POST to verify funding:

   curl -X POST http://127.0.0.1:8142/funding/shielded \
     -H 'Content-Type: application/json' \
     -d '{"api_key":"<API_KEY>","memo":"<API_KEY>","origin_address":"utest15dsyyx0mnx..."}'

   ⏳ Waiting for confirmation... (press ENTER after sending)
   ═══════════════════════════════════════════════════════════════
   ```

4. **Polling Loop**: After user presses ENTER, poll status every 3 seconds
   - Max 60 attempts (3 minutes total)
   - Success: `verified=true` returned from status endpoint
   - Failure: Throw error with recovery instructions

---

### Phase 2: Update State Manager

**File to Modify**: `/mina/escrowm-init/src/scripts/shared/state-manager.ts`

**Changes to `TradeState` interface**:

```typescript
export interface TradeState {
  // Existing fields...
  tradeId: string;
  tradeIdField: string;
  depositor: string;
  claimant: string;
  amount: string;
  depositTxHash?: string;
  lockTxHash?: string;
  claimTxHash?: string;
  settleTxHash?: string;

  // NEW: Real ZEC escrowdv2 integration fields
  escrowdApiKey?: string;          // Unique API key for this trade
  escrowdPort?: number;            // Port where escrowdv2 is running (8000-18000)
  escrowdAddress?: string;         // ZEC unified address (utest1...)
  escrowdVerified?: boolean;       // ZEC funding confirmed
  escrowdInTransit?: boolean;      // Escrow locked
  escrowdOriginAddress?: string;   // Where ZEC came from (for refunds)

  // REMOVE: Mock ZEC data (no longer needed)
  // zecTradeData?: {...}  // DELETE THIS

  // Existing timestamps
  createdAt: number;
  completedAt?: number;
}
```

**Add Cleanup Function**:

```typescript
export async function cleanupFailedTrade(
  scenario: 'msi' | 'zsi',
  state: TradeState
): Promise<void> {
  console.log('\n🧹 Cleaning up failed trade...');

  // 1. Kill escrowdv2 instance if running
  if (state.escrowdPort) {
    await killEscrowdInstance(state.tradeId);
  }

  // 2. Emergency unlock on MINA if locked
  if (state.lockTxHash) {
    console.log('  ⚠️  Calling emergencyUnlock on MINA contract...');
    // Call MinaEscrowPool.emergencyUnlock(tradeIdField)
  }

  // 3. Mark trade as failed in state file
  state.completedAt = Date.now();
  updateTradeState(scenario, state);

  console.log('  ✅ Cleanup complete');
}
```

---

### Phase 3: Modify MSI Lock Script

**File to Modify**: `/mina/escrowm-init/src/scripts/mina_sell_initialization/3_msi_lock.ts`

**Changes**:

1. **Remove Mock Imports** (Lines 23-29):
   ```diff
   - import {
   -   generateMockZecTxHash,
   -   confirmMockZecTrade,
   -   logMockZecTrade,
   -   generateMockEscrowdv2State,
   -   logMockEscrowdv2State,
   -   verifyMockEscrowdv2StateForLock,
   - } from '../shared/mock-zec.js';
   ```

2. **Add Real ZEC Imports**:
   ```typescript
   import {
     ensureMiddlewareRunning,
     spawnEscrowdInstance,
     getEscrowdStatus,
     promptUserToFundZec,
     calculateZecFromOracle,
     generateApiKey,
   } from '../shared/real-zec.js';
   import { cleanupFailedTrade } from '../shared/state-manager.js';
   ```

3. **Replace Mock Logic** (Lines 78-143): [See full replacement code in plan]

4. **Remove Old Mock Sections**: Delete lines 101-143 (mock escrowdv2 state generation)

---

### Phase 4: Modify ZSI Lock Script

**File to Modify**: `/mina/escrowm-init/src/scripts/zec_sell_initialization/3_zsi_lock.ts`

**Changes**: Apply identical modifications as MSI lock script above, with these differences:

1. Use **account 1** instead of account 0 for ZEC funding:
   ```typescript
   await promptUserToFundZec(
     state.escrowdAddress!,
     expectedZec,
     state.escrowdApiKey!,
     1  // Use zcashd account 1 (different from MSI)
   );
   ```

2. Scenario parameter in cleanup calls uses `'zsi'` instead of `'msi'`

---

### Phase 5: Add NPM Scripts

**File to Modify**: `/mina/escrowm-init/package.json`

**Add New Scripts**:

```json
{
  "scripts": {
    // Existing scripts...
    "test:msi": "...",
    "test:zsi": "...",

    // NEW: Real integration test scripts
    "test:msi-real": "node build/src/scripts/mina_sell_initialization/0_msi_setup.js && node build/src/scripts/mina_sell_initialization/1_msi_deposit.js && node build/src/scripts/mina_sell_initialization/2_msi_verify_deposit.js && node build/src/scripts/mina_sell_initialization/3_msi_lock.js && node build/src/scripts/mina_sell_initialization/4_msi_claim.js && node build/src/scripts/mina_sell_initialization/6_msi_verify_final.js",

    "test:zsi-real": "node build/src/scripts/zec_sell_initialization/0_zsi_setup.js && node build/src/scripts/zec_sell_initialization/1_zsi_deposit.js && node build/src/scripts/zec_sell_initialization/2_zsi_verify_deposit.js && node build/src/scripts/zec_sell_initialization/3_zsi_lock.js && node build/src/scripts/zec_sell_initialization/4_zsi_claim.js && node build/src/scripts/zec_sell_initialization/6_zsi_verify_final.js",

    "pretest:msi-real": "npm run build",
    "pretest:zsi-real": "npm run build"
  }
}
```

---

### Phase 6: Update Middleware .env Configuration

**File**: `/middleware/.env` (user creates this manually before testing)

**Required Variables**: [See full .env template in plan]

---

## Critical Files Summary

### Files to Create (1 new file)

1. **`/mina/escrowm-init/src/scripts/shared/real-zec.ts`**
   - Middleware API client
   - User funding prompts
   - Status polling
   - ~300 lines

### Files to Modify (5 existing files)

1. **`/mina/escrowm-init/src/scripts/shared/state-manager.ts`**
   - Add escrowdv2 fields to TradeState interface
   - Add cleanupFailedTrade() function
   - Remove zecTradeData field
   - ~30 lines changed

2. **`/mina/escrowm-init/src/scripts/mina_sell_initialization/3_msi_lock.ts`**
   - Replace mock imports with real-zec imports
   - Replace mock logic (lines 78-143) with real spawn/fund/lock flow
   - Add error handling with automatic cleanup
   - ~150 lines changed

3. **`/mina/escrowm-init/src/scripts/zec_sell_initialization/3_zsi_lock.ts`**
   - Same changes as MSI lock script
   - Use account 1 instead of account 0
   - ~150 lines changed

4. **`/mina/escrowm-init/package.json`**
   - Add test:msi-real and test:zsi-real scripts
   - Add pretest hooks
   - ~5 lines added

5. **`/middleware/.env`**
   - User creates this file (copy from .env.example)
   - Configure all required environment variables
   - New file, ~30 lines

---

## Dependencies

### NPM Packages to Add

```bash
cd mina/escrowm-init
npm install node-fetch@2  # For middleware API calls (CommonJS compatible)
npm install --save-dev @types/node-fetch
```

---

## Testing Timeline

### Per-Test Duration

| Phase | Duration | Notes |
|-------|----------|-------|
| Setup | 1 min | Compile + generate trade ID |
| Deposit | 6 min | Transaction + settlement proof |
| Verify Deposit | 10 sec | Read-only query |
| Spawn escrowdv2 | 30 sec | Middleware API call + startup |
| User ZEC Funding | 2 min | Manual user action + verification |
| Middleware Lock | 1 min | Automatic detection + lock |
| Claim | 6 min | Transaction + settlement proof |
| Final Verify | 10 sec | Read-only query |
| **TOTAL** | **~16-17 min** | Per test scenario |

### Complete Test Suite

- MSI Test: 16-17 minutes
- ZSI Test: 16-17 minutes
- **Total**: ~32-34 minutes for both scenarios

---

**End of Plan**
