# End-to-End Integration Test Plan: ZEC ↔ MINA Atomic Swap System

## Executive Summary

This plan designs a complete real-world integration test system for the ZEC ↔ MINA atomic swap protocol using:

- **Real middleware service** (coordinator + API server)
- **Real escrowdv2 instances** (Rust daemons spawned per trade)
- **Real MINA transactions** (Zeko L2 testnet)
- **Real ZEC transactions** (Zcash testnet with shielded addresses)
- **User-driven testing** (manual ZEC funding steps)

The system eliminates all mocks and tests the full production flow with actual blockchain interactions.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                    Test Environment                      │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  ┌──────────────┐      ┌──────────────┐               │
│  │  Middleware  │◄────►│ Test Scripts │               │
│  │  (Running)   │      │ (escrowm-init│               │
│  │              │      │    MSI/ZSI)  │               │
│  │ • API Server │      │              │               │
│  │ • Coordinator│      │ Calls spawn  │               │
│  │ • Spawner    │      │ API endpoint │               │
│  └──────┬───────┘      └──────────────┘               │
│         │                                               │
│         │ Spawns & Monitors                            │
│         ▼                                               │
│  ┌──────────────────────────────┐                      │
│  │  escrowdv2 Instances         │                      │
│  │  Port 8000-18000 (per trade) │                      │
│  │  • Real Rust binaries        │                      │
│  │  • Real ZEC wallet           │                      │
│  │  • Real shielded addresses   │                      │
│  └──────────────────────────────┘                      │
│                                                          │
└─────────────────────────────────────────────────────────┘
         │                          │
         ▼                          ▼
┌─────────────────┐        ┌─────────────────┐
│  Zeko L2 Testnet│        │ Zcash Testnet   │
│  MinaEscrowPool │        │ zcashd + lwallet│
│  On-chain state │        │ Shielded txs    │
└─────────────────┘        └─────────────────┘
```

---

## Phase 1: Real ZEC Integration Module

### 1.1 Create `real-zec.ts` Module

**Purpose**: Replace `mock-zec.ts` with real ZEC blockchain interactions.

**Location**: `/mina/escrowm-init/src/scripts/shared/real-zec.ts`

**Key Functions**:

```typescript
// Interface matching mock-zec.ts structure
export interface RealZecTradeData {
  sellerAddress: string; // Real ZEC unified address
  buyerAddress: string; // Real ZEC unified address
  amount: bigint; // Amount in zatoshis
  txHash?: string; // Real blockchain tx hash
  confirmations?: number; // Real confirmations from zcashd
}

// Core functions
export async function getEscrowdAddress(port: number): Promise<string>;
export async function fundEscrowdWithShielded(
  port: number,
  amount: number,
  originAddress: string,
  apiKey: string
): Promise<string>;
export async function verifyEscrowdFunding(
  port: number,
  apiKey: string,
  memo: string,
  originAddress: string
): Promise<boolean>;
export async function getEscrowdStatus(port: number): Promise<EscrowdStatus>;
export function promptUserForZecFunding(
  tradeId: string,
  port: number,
  zecAmount: number,
  apiKey: string
): Promise<void>;
```

**Implementation Details**:

1. **HTTP Client for escrowdv2 API**:

   - Use `fetch()` or `axios` for REST calls
   - Handle timeouts (30s for blockchain queries)
   - Retry logic for transient failures (3 attempts)

2. **Address Generation**:

   - Query `GET http://127.0.0.1:{port}/address`
   - Extract unified address from response
   - Cache per-trade to avoid repeated queries

3. **Status Polling**:

   - Query `GET http://127.0.0.1:{port}/status`
   - Parse `verified`, `in_transit`, `origin_address`, `received_amount`
   - Implement exponential backoff polling (5s → 10s → 20s)

4. **Funding Verification**:

   - POST to `/funding/shielded` with memo and origin
   - Wait for escrowdv2 to detect on-chain transaction
   - Verify `verified: true` in status response

5. **User Prompts**:
   - Display clear instructions with addresses and amounts
   - Show example `zcash-cli` commands
   - Wait for user confirmation before proceeding
   - Verify funding completed before continuing

---

## Phase 2: Middleware Integration

### 2.1 Modify Test Scripts to Call Middleware API

**Files to Modify**:

- `/mina/escrowm-init/src/scripts/mina_sell_initialization/0_msi_setup.ts`
- `/mina/escrowm-init/src/scripts/zec_sell_initialization/0_zsi_setup.ts`

**Changes**:

1. **Add Middleware API Client**:

```typescript
// In shared/middleware-client.ts (NEW FILE)
export async function spawnEscrowd(
  tradeId: string,
  apiKey: string
): Promise<{ success: boolean; port: number; message: string }> {
  const response = await fetch("http://127.0.0.1:3000/api/spawn-escrowd", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tradeId, apiKey }),
  });
  return await response.json();
}

export async function getEscrowdStatus(
  tradeId: string
): Promise<EscrowdStatusResponse | null> {
  const response = await fetch(
    `http://127.0.0.1:3000/api/escrowd/${tradeId}/status`
  );
  if (!response.ok) return null;
  return await response.json();
}
```

2. **Update Step 0 (Setup)**:
   - After trade initialization, call `spawnEscrowd(tradeId, apiKey)`
   - Store port number in state manager
   - Verify escrowdv2 is running before proceeding

### 2.2 Update State Manager

**File**: `/mina/escrowm-init/src/scripts/shared/state-manager.ts`

**Add Fields to TradeState**:

```typescript
export interface TradeState {
  // Existing fields...
  tradeId: string;
  tradeIdField: string;
  depositor: string;
  claimant: string;
  amount: string;

  // NEW: Escrowdv2 tracking
  escrowdPort?: number; // Port assigned by middleware
  escrowdApiKey?: string; // API key for this trade
  escrowdAddress?: string; // ZEC escrow address
  escrowdStatus?: {
    // Latest escrowd status
    verified: boolean;
    in_transit: boolean;
    origin_address?: string;
    received_amount?: number;
  };

  // Existing ZEC data (now real)
  zecTradeData?: {
    sellerAddress: string;
    buyerAddress: string;
    amount: string;
    txHash?: string;
    confirmations?: number;
  };

  // Existing timestamps
  createdAt: number;
  completedAt?: number;
}
```

---

## Phase 3: MSI (MINA Sell) Integration Flow

### 3.1 Step 0: Setup (Modified)

**File**: `/mina/escrowm-init/src/scripts/mina_sell_initialization/0_msi_setup.ts`

**New Steps**:

1. Load test accounts (Alice, Bob, Operator)
2. Generate trade UUID
3. **NEW**: Call middleware `/api/spawn-escrowd` with tradeId and apiKey
4. **NEW**: Wait for escrowdv2 to start (poll health endpoint)
5. **NEW**: Fetch escrow ZEC address from `GET /address`
6. **NEW**: Store port and address in state file
7. Display trade summary with escrow address

**Code Addition**:

```typescript
// After trade ID generation
logSection("🚀 Spawning escrowdv2 Instance");
const apiKey = generateMockZecTxHash(); // Use random key
const spawnResult = await spawnEscrowd(state.tradeId, apiKey);

if (!spawnResult.success) {
  throw new Error(`Failed to spawn escrowdv2: ${spawnResult.message}`);
}

logSuccess(`escrowdv2 spawned on port ${spawnResult.port}`);

// Wait for escrowdv2 to be ready
await waitForEscrowdReady(spawnResult.port);

// Get escrow address
const escrowAddr = await getEscrowdAddress(spawnResult.port);
logInfo(`ZEC Escrow Address: ${escrowAddr}`);

// Update state
updateTradeState("msi", {
  escrowdPort: spawnResult.port,
  escrowdApiKey: apiKey,
  escrowdAddress: escrowAddr,
});
```

### 3.2 Step 1: Deposit MINA (No Changes)

**File**: `/mina/escrowm-init/src/scripts/mina_sell_initialization/1_msi_deposit.ts`

This step remains unchanged - Alice deposits MINA to the pool.

### 3.3 Step 2: Verify Deposit (Add ZEC Prompts)

**File**: `/mina/escrowm-init/src/scripts/mina_sell_initialization/2_msi_verify_deposit.ts`

**New Section After MINA Verification**:

```typescript
// After settlement proof completes
logSection("🪙 ZEC Funding Required");
console.log("");
console.log("  MINA deposit verified and settled.");
console.log("  Now Bob needs to fund the ZEC escrow...");
console.log("");
await promptUserForZecFunding(
  state.tradeId,
  state.escrowdPort!,
  calculateZecAmount(Number(state.amount) / 1e9), // Based on oracle rate
  state.escrowdApiKey!
);
```

**Implementation of `promptUserForZecFunding()`**:

```typescript
export async function promptUserForZecFunding(
  tradeId: string,
  port: number,
  zecAmount: number,
  apiKey: string
): Promise<void> {
  const escrowAddr = await getEscrowdAddress(port);

  console.log("═══════════════════════════════════════════");
  console.log("  🪙 ACTION REQUIRED: Fund ZEC Escrow");
  console.log("═══════════════════════════════════════════");
  console.log("");
  console.log(`Trade ID: ${tradeId}`);
  console.log(`Escrow Address: ${escrowAddr}`);
  console.log(`Amount: ${zecAmount.toFixed(8)} ZEC`);
  console.log(`Memo (API Key): ${apiKey}`);
  console.log("");
  console.log("Example command:");
  console.log("");
  console.log(`zcash-cli z_sendmany "YOUR_SHIELDED_ADDR" '[{`);
  console.log(`  "address": "${escrowAddr}",`);
  console.log(`  "amount": ${zecAmount},`);
  console.log(`  "memo": "${Buffer.from(apiKey).toString("hex")}"`);
  console.log(`}]'`);
  console.log("");
  console.log("After sending, bind the funding:");
  console.log("");
  console.log(`curl -X POST http://127.0.0.1:${port}/funding/shielded \\`);
  console.log(`  -H 'Content-Type: application/json' \\`);
  console.log(`  -d '{`);
  console.log(`    "api_key": "${apiKey}",`);
  console.log(`    "memo": "${apiKey}",`);
  console.log(`    "origin_address": "YOUR_SHIELDED_ADDR"`);
  console.log(`  }'`);
  console.log("");
  console.log("Press ENTER when funding is complete...");

  // Wait for user input
  await new Promise<void>((resolve) => {
    process.stdin.once("data", () => resolve());
  });

  // Verify funding
  logInfo("Verifying ZEC funding...");
  let verified = false;
  for (let i = 0; i < 60; i++) {
    // 60 attempts x 5s = 5 minutes
    const status = await getEscrowdStatus(port);
    if (status && status.verified) {
      verified = true;
      break;
    }
    if (i % 12 === 0) {
      // Log every minute
      logInfo(`Waiting for confirmation... (${i * 5}s elapsed)`);
    }
    await sleep(5000);
  }

  if (!verified) {
    throw new Error("ZEC funding not verified after 5 minutes");
  }

  logSuccess("ZEC funding verified!");
}
```

### 3.4 Step 3: Lock (Remove Mock, Use Real Status)

**File**: `/mina/escrowm-init/src/scripts/mina_sell_initialization/3_msi_lock.ts`

**Replace Mock Section with Real Check**:

**REMOVE**:

```typescript
// Lines 78-143: All mock ZEC simulation code
const mockZecTxHash = generateMockZecTxHash();
const confirmedZecTrade = confirmMockZecTrade(...);
logMockZecTrade(...);
const escrowdv2State = generateMockEscrowdv2State(...);
```

**REPLACE WITH**:

```typescript
// ============================================================================
// STEP 5: Verify Real escrowdv2 State
// ============================================================================

logSection("🔍 Verifying Real escrowdv2 State");
console.log("  Querying escrowdv2 instance for current state...");

if (!state.escrowdPort) {
  throw new Error("No escrowdv2 port in state - run setup first");
}

const escrowdStatus = await getEscrowdStatus(state.escrowdPort);

if (!escrowdStatus) {
  throw new Error("Could not fetch escrowdv2 status");
}

logInfo(`Escrow Status:`);
console.log(`  Verified: ${escrowdStatus.verified ? "✅" : "❌"}`);
console.log(`  In Transit: ${escrowdStatus.in_transit ? "✅" : "❌"}`);
console.log(`  Origin Address: ${escrowdStatus.origin_address || "N/A"}`);
console.log(
  `  Received Amount: ${escrowdStatus.received_amount || 0} zatoshis`
);

// Verify state is valid for locking
if (!escrowdStatus.verified) {
  throw new Error("ZEC escrow not verified - funding not complete");
}

if (escrowdStatus.in_transit) {
  throw new Error("ZEC escrow already locked");
}

logSuccess("escrowdv2 state verified - ready to lock MINA side");

// Update state with real ZEC data
updateTradeState("msi", {
  escrowdStatus: escrowdStatus,
  zecTradeData: {
    sellerAddress: escrowdStatus.origin_address || "unknown",
    buyerAddress: state.depositor, // MINA depositor gets ZEC
    amount: escrowdStatus.received_amount?.toString() || "0",
    confirmations: 6, // escrowdv2 already verified
  },
});
```

**Note**: The middleware coordinator will automatically detect both sides are funded and lock both sides. The test script just needs to proceed to the claim step.

### 3.5 Steps 4-6: Claim, Settle, Verify (No Changes)

These steps remain unchanged - they already work with real blockchain state.

---

## Phase 4: ZSI (ZEC Sell) Integration Flow

### 4.1 Similar Modifications to ZSI Scripts

**Files to Modify**:

- `0_zsi_setup.ts` - Add middleware spawn call
- `1_zsi_deposit.ts` - Add ZEC funding prompt BEFORE MINA deposit
- `3_zsi_lock.ts` - Replace mock with real status check

**Key Difference**: In ZSI, user funds ZEC **before** depositing MINA.

**Modified Flow**:

1. Step 0: Setup + spawn escrowdv2 + get address
2. **NEW**: Prompt user to fund ZEC escrow first
3. Step 1: User deposits MINA (after ZEC is funded)
4. Step 2: Verify both sides (middleware auto-locks)
5. Steps 3-6: Lock/Claim/Settle/Verify

---

## Phase 5: Test Orchestrator

### 5.1 Create Main Test Runner

**Location**: `/mina/escrowm-init/src/scripts/run-integration-test.ts` (NEW FILE)

**Purpose**: Orchestrate complete test execution with proper sequencing.

```typescript
#!/usr/bin/env node
/**
 * End-to-End Integration Test Runner
 *
 * Prerequisites:
 * 1. Middleware running on http://127.0.0.1:3000
 * 2. zcashd + lightwalletd running
 * 3. Funded ZEC wallet available
 */

import readline from "readline";

async function runMSITest() {
  console.log("\n╔═══════════════════════════════════════╗");
  console.log("║  MSI Test: MINA Sell (Buy ZEC)       ║");
  console.log("╚═══════════════════════════════════════╝\n");

  console.log("This test simulates:");
  console.log("  1. Alice deposits MINA to pool");
  console.log("  2. Bob funds ZEC escrow (YOU perform this)");
  console.log("  3. Middleware locks both sides");
  console.log("  4. Bob claims MINA");
  console.log("  5. Alice receives ZEC");
  console.log("");

  await confirmContinue();

  // Run steps sequentially
  await runStep("0_msi_setup", "Initialize trade and spawn escrowdv2");
  await runStep("1_msi_deposit", "Alice deposits MINA");
  await runStep("2_msi_verify_deposit", "Verify deposit + PROMPT ZEC FUNDING");

  console.log("\n⏳ Waiting for middleware to detect and lock both sides...");
  await sleep(30000); // Wait 30s for middleware polling

  await runStep("3_msi_lock", "Verify lock status");
  await runStep("4_msi_claim", "Bob claims MINA");
  await runStep("5_msi_settle", "Settle final state");
  await runStep("6_msi_verify_final", "Verify complete");

  console.log("\n✅ MSI Test Complete!\n");
}

async function runZSITest() {
  console.log("\n╔═══════════════════════════════════════╗");
  console.log("║  ZSI Test: ZEC Sell (Buy MINA)       ║");
  console.log("╚═══════════════════════════════════════╝\n");

  console.log("This test simulates:");
  console.log("  1. Alice funds ZEC escrow (YOU perform this)");
  console.log("  2. Alice deposits MINA to pool");
  console.log("  3. Middleware locks both sides");
  console.log("  4. Alice refunds MINA (self-claim)");
  console.log("  5. Alice receives MINA");
  console.log("");

  await confirmContinue();

  await runStep(
    "0_zsi_setup",
    "Initialize trade and spawn escrowdv2 + PROMPT ZEC FUNDING"
  );
  await runStep("1_zsi_deposit", "Alice deposits MINA");

  console.log("\n⏳ Waiting for middleware to detect and lock both sides...");
  await sleep(30000);

  await runStep("2_zsi_verify_deposit", "Verify deposit");
  await runStep("3_zsi_lock", "Verify lock status");
  await runStep("4_zsi_claim", "Alice claims MINA");
  await runStep("5_zsi_settle", "Settle final state");
  await runStep("6_zsi_verify_final", "Verify complete");

  console.log("\n✅ ZSI Test Complete!\n");
}

async function runStep(scriptName: string, description: string) {
  console.log(`\n─────────────────────────────────────`);
  console.log(`  Running: ${description}`);
  console.log(`  Script: ${scriptName}`);
  console.log(`─────────────────────────────────────\n`);

  // Execute script using child_process
  const { execSync } = await import("child_process");
  const scriptPath =
    scriptName.startsWith("0_msi") ||
    scriptName.startsWith("1_msi") ||
    scriptName.startsWith("2_msi") ||
    scriptName.startsWith("3_msi") ||
    scriptName.startsWith("4_msi") ||
    scriptName.startsWith("5_msi") ||
    scriptName.startsWith("6_msi")
      ? `./build/src/scripts/mina_sell_initialization/${scriptName}.js`
      : `./build/src/scripts/zec_sell_initialization/${scriptName}.js`;

  try {
    execSync(`node ${scriptPath}`, { stdio: "inherit" });
  } catch (error) {
    console.error(`\n❌ Step failed: ${description}`);
    throw error;
  }
}

async function confirmContinue() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  await new Promise<void>((resolve) => {
    rl.question("Press ENTER to continue...", () => {
      rl.close();
      resolve();
    });
  });
}

async function main() {
  console.log("╔═══════════════════════════════════════════════════╗");
  console.log("║  ZEC ↔ MINA Atomic Swap Integration Test         ║");
  console.log("║  End-to-End Real Blockchain Testing              ║");
  console.log("╚═══════════════════════════════════════════════════╝");
  console.log("");
  console.log("Prerequisites Check:");
  console.log("  [ ] Middleware running (http://127.0.0.1:3000/health)");
  console.log("  [ ] zcashd running (testnet port 18232)");
  console.log("  [ ] lightwalletd running (port 9067)");
  console.log("  [ ] Funded ZEC wallet available");
  console.log("  [ ] MinaEscrowPool deployed on Zeko L2");
  console.log("");

  await confirmContinue();

  // Check middleware health
  try {
    const response = await fetch("http://127.0.0.1:3000/health");
    if (!response.ok) {
      throw new Error("Middleware not responding");
    }
    console.log("✅ Middleware health check passed\n");
  } catch (error) {
    console.error("❌ Middleware health check failed");
    console.error("   Start middleware: cd middleware && npm start");
    process.exit(1);
  }

  console.log("Select test to run:");
  console.log("  1. MSI (MINA Sell / ZEC Buy)");
  console.log("  2. ZSI (ZEC Sell / MINA Buy)");
  console.log("  3. Both (MSI then ZSI)");
  console.log("");

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const choice = await new Promise<string>((resolve) => {
    rl.question("Enter choice (1-3): ", (answer) => {
      rl.close();
      resolve(answer);
    });
  });

  switch (choice.trim()) {
    case "1":
      await runMSITest();
      break;
    case "2":
      await runZSITest();
      break;
    case "3":
      await runMSITest();
      console.log("\n─────────────────────────────────────\n");
      await sleep(5000);
      await runZSITest();
      break;
    default:
      console.error("Invalid choice");
      process.exit(1);
  }

  console.log("\n╔═══════════════════════════════════════════════════╗");
  console.log("║  All Tests Completed Successfully!               ║");
  console.log("╚═══════════════════════════════════════════════════╝\n");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error) => {
  console.error("\n❌ Test suite failed:", error);
  process.exit(1);
});
```

---

## Phase 6: User Documentation

### 6.1 Create User Guide

**Location**: `/REAL_INTEGRATION_TEST_GUIDE.md` (NEW FILE)

**Contents**:

````markdown
# Real Integration Test Guide

## Prerequisites

1. Start zcashd testnet:
   ```bash
   docker compose -f zcash/docker-compose.zcashd.yml up -d
   ```
````

2. Start lightwalletd:

   ```bash
   cd zcash/lightwalletd && docker compose up -d
   ```

3. Create funded ZEC wallet:

   ```bash
   # Get testnet faucet funds
   zcash-cli getnewaddress
   # Request funds from https://faucet.testnet.z.cash/
   ```

4. Configure middleware:

   ```bash
   cd middleware
   cp .env.example .env
   # Edit .env with your values
   ```

5. Start middleware:
   ```bash
   cd middleware
   npm install && npm run build && npm start
   ```

## Running Tests

### Terminal 1: Middleware (must be running)

```bash
cd middleware
npm start
```

### Terminal 2: Run integration test

```bash
cd mina/escrowm-init
npm install && npm run build
npm run test:integration

# Or run individual scenarios:
npm run test:msi  # MINA Sell Initialization
npm run test:zsi  # ZEC Sell Initialization
```

## Manual Steps During Test

### When Prompted to Fund ZEC Escrow

The test will pause and display:

```
═══════════════════════════════════════════
  🪙 ACTION REQUIRED: Fund ZEC Escrow
═══════════════════════════════════════════

Trade ID: 550e8400-e29b-41d4-a716-446655440000
Escrow Address: utest1...
Amount: 0.02000000 ZEC
Memo (API Key): abc123def456...

Example command:
zcash-cli z_sendmany "YOUR_SHIELDED_ADDR" '[{
  "address": "utest1...",
  "amount": 0.02,
  "memo": "..."
}]'

Press ENTER when funding is complete...
```

**Your Actions**:

1. Copy the escrow address
2. Run the provided `zcash-cli` command (with your shielded address)
3. Wait for transaction to be included in a block (~5 minutes)
4. Bind the funding by calling the `/funding/shielded` endpoint
5. Press ENTER to continue test

The script will automatically verify funding before proceeding.

## Expected Timeline

| Stage              | Time           | Notes               |
| ------------------ | -------------- | ------------------- |
| Setup & Spawn      | 10s            | Spawns escrowdv2    |
| MINA Deposit       | 30s            | Zeko L2 transaction |
| Settlement Proof   | 5-6 min        | Automated           |
| ZEC Funding (USER) | 5-10 min       | Manual step         |
| Middleware Lock    | 15-30s         | Auto-detected       |
| MINA Claim         | 30s            | User claims         |
| ZEC Send           | 10s            | Middleware sends    |
| **Total**          | **~12-18 min** | End-to-end          |

## Troubleshooting

### Middleware can't spawn escrowdv2

- Verify cargo is in PATH: `which cargo`
- Check escrowdv2 builds: `cd zcash/escrowdv2 && cargo build --release`

### ZEC funding not verified

- Check lightwalletd connection: `grpcurl -plaintext 127.0.0.1:9067 list`
- Verify memo format (hex encoded API key)
- Ensure sufficient confirmations (6 blocks)

### Middleware doesn't lock automatically

- Check middleware logs for errors
- Verify polling interval (default 15s)
- Check both sides funded: MINA deposit settled + ZEC verified

## Success Criteria

Test passes if:

1. ✅ escrowdv2 spawns successfully
2. ✅ MINA deposit confirmed on-chain
3. ✅ ZEC funding verified by escrowdv2
4. ✅ Middleware locks both sides atomically
5. ✅ MINA claim succeeds
6. ✅ ZEC sent to correct address
7. ✅ Trade removed from on-chain state
8. ✅ escrowdv2 process exits cleanly

````

---

## Summary of Changes

### New Files

1. `/mina/escrowm-init/src/scripts/shared/real-zec.ts` - Real ZEC integration
2. `/mina/escrowm-init/src/scripts/shared/middleware-client.ts` - Middleware API client
3. `/mina/escrowm-init/src/scripts/run-integration-test.ts` - Test orchestrator
4. `/REAL_INTEGRATION_TEST_GUIDE.md` - User documentation

### Modified Files

1. `/mina/escrowm-init/src/scripts/shared/state-manager.ts`
   - Add escrowdPort, escrowdApiKey, escrowdAddress, escrowdStatus fields

2. `/mina/escrowm-init/src/scripts/mina_sell_initialization/0_msi_setup.ts`
   - Add middleware spawn call
   - Store escrowd details in state

3. `/mina/escrowm-init/src/scripts/mina_sell_initialization/2_msi_verify_deposit.ts`
   - Add ZEC funding prompt section

4. `/mina/escrowm-init/src/scripts/mina_sell_initialization/3_msi_lock.ts`
   - Remove all mock code (lines 78-143)
   - Replace with real escrowdv2 status checks

5. `/mina/escrowm-init/src/scripts/zec_sell_initialization/0_zsi_setup.ts`
   - Add middleware spawn call
   - Add ZEC funding prompt (before MINA deposit)

6. `/mina/escrowm-init/src/scripts/zec_sell_initialization/3_zsi_lock.ts`
   - Remove all mock code
   - Replace with real escrowdv2 status checks

7. `/mina/escrowm-init/package.json`
   - Add scripts:
     ```json
     "scripts": {
       "test:integration": "node build/src/scripts/run-integration-test.js",
       "test:msi": "node build/src/scripts/run-integration-test.js msi",
       "test:zsi": "node build/src/scripts/run-integration-test.js zsi"
     }
     ```

---

## Execution Flow Diagram

### MSI (MINA Sell) Flow

````

┌─────────────┐
│ 0. Setup │ → Spawn escrowdv2 → Store port/address
└──────┬──────┘
▼
┌─────────────┐
│ 1. Deposit │ → Alice deposits MINA → Settlement proof (5-6 min)
└──────┬──────┘
▼
┌─────────────┐
│ 2. Verify │ → PAUSE → USER FUNDS ZEC → Verify funding
└──────┬──────┘
▼
[Middleware Detects Both Funded]
│
▼
[Middleware Locks Both Sides]
│
▼
┌─────────────┐
│ 3. Lock │ → Verify lock status
└──────┬──────┘
▼
┌─────────────┐
│ 4. Claim │ → Bob claims MINA
└──────┬──────┘
▼
[Middleware Detects Claim]
│
▼
[Middleware Sends ZEC to Alice]
│
▼
┌─────────────┐
│ 5. Settle │ → Settle final state
└──────┬──────┘
▼
┌─────────────┐
│ 6. Verify │ → Verify trade deleted
└─────────────┘

SUCCESS ✅

```

### ZSI (ZEC Sell) Flow

```

┌─────────────┐
│ 0. Setup │ → Spawn escrowdv2 → PAUSE → USER FUNDS ZEC
└──────┬──────┘
▼
┌─────────────┐
│ 1. Deposit │ → Alice deposits MINA → Settlement proof
└──────┬──────┘
▼
[Middleware Detects Both Funded]
│
▼
[Middleware Locks Both Sides]
│
▼
┌─────────────┐
│ 2. Verify │ → Verify deposit
└──────┬──────┘
▼
┌─────────────┐
│ 3. Lock │ → Verify lock status
└──────┬──────┘
▼
┌─────────────┐
│ 4. Claim │ → Alice claims MINA (self-refund)
└──────┬──────┘
▼
[Middleware Detects Claim]
│
▼
[Middleware Sends ZEC to Alice]
│
▼
┌─────────────┐
│ 5. Settle │ → Settle final state
└──────┬──────┘
▼
┌─────────────┐
│ 6. Verify │ → Verify trade deleted
└─────────────┘

SUCCESS ✅

```

---

## Error Handling Strategy

### 1. escrowdv2 Spawn Failure
- **Detection**: Spawn API returns success: false
- **Recovery**: Retry spawn 3 times with 5s delay
- **Fallback**: Manual spawn instructions displayed

### 2. ZEC Funding Timeout
- **Detection**: No verified status after 5 minutes
- **Recovery**: Display status + re-prompt user
- **Fallback**: Allow skip for testing (mark as manual verification needed)

### 3. Middleware Lock Failure
- **Detection**: Middleware logs error or timeout (60s)
- **Recovery**: Middleware retries ZEC lock 5 times
- **Fallback**: Middleware calls emergencyUnlock on MINA side
- **User Action**: Can refund MINA via refund() method

### 4. Settlement Proof Failure
- **Detection**: Proof generation throws error
- **Recovery**: Retry once after 1 minute
- **Fallback**: Display error + manual intervention steps

### 5. Network Interruption
- **Detection**: HTTP timeouts or connection errors
- **Recovery**: Exponential backoff (1s, 2s, 4s, 8s, 16s)
- **Fallback**: Persist state to disk, resume from last checkpoint

---

## Testing Validation Criteria

### Pre-Test Validation
- [ ] Middleware health endpoint returns 200 OK
- [ ] zcashd RPC responds to `getblockchaininfo`
- [ ] lightwalletd gRPC accepts connections
- [ ] MinaEscrowPool contract deployed and accessible
- [ ] Test accounts have sufficient balances (5 MINA, 0.1 ZEC)

### Per-Test Validation
- [ ] escrowdv2 spawns on correct deterministic port
- [ ] escrowdv2 health endpoint returns 200 OK
- [ ] ZEC escrow address is valid unified address format
- [ ] MINA deposit transaction confirms within 60s
- [ ] Settlement proof generates within 7 minutes
- [ ] ZEC funding detected by escrowdv2 within 10 minutes
- [ ] Middleware locks both sides within 30s of detection
- [ ] MINA claim succeeds within 60s
- [ ] ZEC send completes within 60s
- [ ] Trade state cleaned up (deleted from offchain state)

### Post-Test Validation
- [ ] escrowdv2 process exits with code 0
- [ ] No orphaned processes remain
- [ ] State files cleaned up properly
- [ ] Logs contain no ERROR level messages
- [ ] Final balances match expected values

---

## Critical Files for Implementation

Below are the most critical files for implementing this plan:

1. **/mina/escrowm-init/src/scripts/shared/real-zec.ts** - Core real ZEC integration module with HTTP client for escrowdv2, status polling, and user prompt functions

2. **/mina/escrowm-init/src/scripts/shared/middleware-client.ts** - Middleware API client for spawn and status endpoints

3. **/mina/escrowm-init/src/scripts/mina_sell_initialization/3_msi_lock.ts** - Replace mock code (lines 78-143) with real escrowdv2 status checks

4. **/mina/escrowm-init/src/scripts/shared/state-manager.ts** - Add escrowdPort, escrowdApiKey, escrowdAddress, escrowdStatus fields to TradeState interface

5. **/mina/escrowm-init/src/scripts/run-integration-test.ts** - Main test orchestrator that sequences all steps and provides user guidance

---

## Notes

- **No Changes to Middleware**: The middleware is production-ready and requires no modifications
- **No Changes to escrowdv2**: The Rust daemon is production-ready and requires no modifications
- **Minimal Changes to Test Scripts**: Only removing mocks and adding API calls
- **User-Driven Testing**: Manual ZEC funding steps ensure real blockchain interaction
- **State Persistence**: All state stored in JSON files for crash recovery
- **Middleware Auto-Detection**: Polling coordinator automatically locks when both sides funded
- **Clear User Guidance**: Detailed prompts with copy-paste commands at each manual step

This plan provides a complete, implementable path to real end-to-end testing of the atomic swap system.
```
