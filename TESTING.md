# MINA ↔ ZEC Barter Swap - Comprehensive Testing Plan

## Overview
Implement comprehensive testing infrastructure for all three components (escrowd, escrowm, middleware) to validate the MINA ↔ ZEC atomic swap protocol. Backend hardening is complete ✅. This plan focuses on building test infrastructure, writing tests, and validating the full system end-to-end.

## Current State Assessment

### Escrowd (Rust)
- ✅ All 8 API endpoints fully implemented
- ✅ Security features present (operator auth, signature verification)
- ❌ **Zero test coverage** (critical gap)
- ❌ No test infrastructure
- 📊 **Readiness**: 4/10 - Functional but untested

### Escrowm (zkApp)
- ✅ Contract fully implemented (7 methods)
- ✅ Comprehensive test suite (11 test cases)
- ✅ Deployment scripts ready
- ⚠️ Settlement proof workflow not demonstrated
- 📊 **Readiness**: 8/10 - Production ready

### Middleware (TypeScript)
- ✅ Entry point and startup logic complete
- ✅ Integration configured (escrowm + escrowd)
- ❌ **Zero test infrastructure** (no Jest/Mocha)
- ❌ No test files or dependencies
- 📊 **Readiness**: 6/10 - Functional but untested

## Testing Objectives
1. Set up test infrastructure for escrowd and middleware
2. Write unit tests for all untested components
3. Write integration tests for cross-component interactions
4. Deploy contracts to Zeko devnet and verify
5. Run end-to-end atomic swap tests
6. Document testing procedures and CI/CD setup

---

## Phase 1: Test Infrastructure Setup (Priority: CRITICAL)

### 1.1 Middleware Test Infrastructure

**Status**: No test framework installed

**Actions**:
1. Install Jest and TypeScript testing dependencies
2. Create Jest configuration
3. Set up test directory structure
4. Add test scripts to package.json
5. Create mock utilities for external services

**Files to create/modify**:
- `middleware/jest.config.js` (new)
- `middleware/package.json` (modify - add test dependencies and scripts)
- `middleware/__tests__/` (new directory)
- `middleware/__tests__/unit/` (new directory)
- `middleware/__tests__/integration/` (new directory)
- `middleware/__tests__/fixtures/` (new directory for mocks)

**Dependencies to install**:
```bash
npm install --save-dev \
  jest @types/jest ts-jest \
  jest-mock-extended \
  @types/node
```

**Jest configuration** (`jest.config.js`):
```javascript
export default {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/__tests__'],
  testMatch: ['**/*.test.ts'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      useESM: true,
    }],
  },
  extensionsToTreatAsEsm: ['.ts'],
  coverageThreshold: {
    global: {
      branches: 60,
      functions: 60,
      lines: 60,
      statements: 60,
    },
  },
};
```

**Package.json scripts**:
```json
{
  "scripts": {
    "test": "NODE_OPTIONS=--experimental-vm-modules jest",
    "test:watch": "NODE_OPTIONS=--experimental-vm-modules jest --watch",
    "test:coverage": "NODE_OPTIONS=--experimental-vm-modules jest --coverage"
  }
}
```

### 1.2 Escrowd Test Infrastructure

**Status**: No test infrastructure

**Actions**:
1. Add `[dev-dependencies]` section to Cargo.toml
2. Create `tests/` directory for integration tests
3. Add unit test modules to existing source files
4. Create mock utilities for zcashd RPC

**Files to modify**:
- `escrowd/Cargo.toml` (add dev dependencies)
- `escrowd/src/lib.rs` (new - for test helpers)
- `escrowd/tests/` (new directory)

**Dev dependencies to add**:
```toml
[dev-dependencies]
tokio-test = "0.4"
mockito = "1.2"
tempfile = "3.8"
```

---

## Phase 2: Unit Tests (Priority: HIGH)

### 2.1 Middleware Unit Tests

**Test files to create** (8 files):

1. **`__tests__/unit/config.test.ts`** - Configuration parsing
   - Test environment variable parsing
   - Test validation logic
   - Test port calculation (Poseidon hash)
   - Test default values

2. **`__tests__/unit/logger.test.ts`** - Logging
   - Test log level filtering
   - Test log message formatting

3. **`__tests__/unit/port-manager.test.ts`** - Port collision detection
   - Mock fetch for /status endpoint
   - Test port available detection
   - Test port collision logging
   - Test timeout handling

4. **`__tests__/unit/oracle-client.test.ts`** - Price fetching
   - Mock Doot API responses
   - Mock CoinGecko API responses
   - Test fallback logic (Doot → CoinGecko)
   - Test price format conversion
   - Test TTL validation
   - Test error handling

5. **`__tests__/unit/escrowd-client.test.ts`** - ZEC side operations
   - Mock all 8 escrowd endpoints
   - Test status queries
   - Test set-in-transit calls
   - Test send-target calls
   - Test error handling

6. **`__tests__/unit/supabase-client.test.ts`** - Keypair lookups
   - Mock Supabase queries
   - Test fetchKeypairByMina
   - Test fetchKeypairByZcash
   - Test error handling

7. **`__tests__/unit/mina-client.test.ts`** - MINA operations (unit level)
   - Mock o1js contract compilation
   - Mock GraphQL responses
   - Test trade queries
   - Test lockTrade transaction construction
   - Test emergency unlock
   - Test pool balance queries

8. **`__tests__/fixtures/`** - Mock data
   - `mock-oracle-responses.ts`
   - `mock-escrowd-responses.ts`
   - `mock-supabase-responses.ts`
   - `mock-mina-responses.ts`

**Estimated effort**: 3-4 days

### 2.2 Escrowd Unit Tests

**Test modules to add** (7 files in `src/` with `#[cfg(test)]`):

1. **`src/config.rs`** - Configuration tests
   ```rust
   #[cfg(test)]
   mod tests {
       #[test]
       fn test_config_parsing() { /* ... */ }
       #[test]
       fn test_address_type_validation() { /* ... */ }
   }
   ```

2. **`src/state.rs`** - State management tests
   - Test bind_origin (AlreadyBound enforcement)
   - Test set_in_transit (Busy check)
   - Test SendGuard RAII pattern
   - Test persistence (save/load from JSON)

3. **`src/error.rs`** - Error handling tests
   - Test HTTP status code mapping
   - Test error message formatting

4. **`src/wallet.rs`** - Wallet operations (unit level)
   - Mock zcashd RPC responses
   - Test balance queries
   - Test address creation
   - Test sweep logic

5. **`src/zcashd.rs`** - RPC client tests
   - Mock JSON-RPC responses
   - Test operation polling
   - Test error handling

6. **`src/key.rs`** - Key management tests
   - Test key derivation
   - Test sealing/unsealing
   - Test zeroization
   - Test file permissions

7. **`src/mina.rs`** - Mina verification tests
   - Mock GraphQL responses
   - Test transaction verification
   - Test amount validation

**Estimated effort**: 4-5 days

---

## Phase 3: Integration Tests (Priority: HIGH)

### 3.1 Middleware Integration Tests

**Test files to create** (4 files in `__tests__/integration/`):

1. **`coordinator.test.ts`** - Coordinator flow
   - Mock both chains (MINA + ZEC)
   - Test trade discovery
   - Test state consolidation
   - Test lock decision logic
   - Test retry/backoff behavior
   - Test post-claim handling

2. **`settlement-worker.test.ts`** - Settlement automation
   - Mock contract actions
   - Test pending action counting
   - Test proof generation trigger
   - Test settlement transaction submission

3. **`full-flow.test.ts`** - Complete middleware flow
   - Mock MINA trade creation
   - Mock ZEC deposit
   - Test lock both sides
   - Test post-claim sweep

4. **`error-recovery.test.ts`** - Error scenarios
   - Test clean slate recovery
   - Test emergency unlock
   - Test ZEC lock retry logic
   - Test port collision handling

**Estimated effort**: 5-6 days

### 3.2 Escrowd Integration Tests

**Test files to create** (in `escrowd/tests/`):

1. **`tests/api_integration.rs`** - API endpoint tests
   - Start mock HTTP server
   - Test complete funding flows
   - Test auth validation
   - Test state transitions

2. **`tests/shielded_flow.rs`** - Shielded funding flow
   - Mock zcashd with shielded notes
   - Test memo verification
   - Test sweep to target

3. **`tests/transparent_flow.rs`** - Transparent funding flow
   - Mock zcashd with transparent UTXOs
   - Test signature verification
   - Test sweep to origin

**Estimated effort**: 4-5 days

---

## Phase 4: Escrowm Validation & Enhancement (Priority: MEDIUM)

### 4.1 Run Existing Tests

**Actions**:
```bash
cd escrowm
npm install
npm run test
```

**Verify**:
- All 11 tests pass
- No compilation errors
- Coverage is adequate

### 4.2 Add Settlement Proof Test

**File to create**: `escrowm/src/settlement.test.ts`

**Test scenario**:
1. Create multiple deposits
2. Trigger settlement proof generation
3. Verify proof can be submitted
4. Query OffchainState after settlement

**Estimated effort**: 1 day

---

## Phase 5: Deployment & Verification (Priority: CRITICAL)

### 5.1 Deploy Escrowm to Zeko Devnet

**Prerequisites**:
- Funded deployer account (1+ MINA)
- Funded operator account (1+ MINA)
- Environment variables set

**Actions**:
```bash
cd escrowm
export DEPLOYER_KEY=<devnet-deployer-key>
export OPERATOR_KEY=<devnet-operator-key>
npm run deploy:zeko
```

**Verification**:
- Contract address returned
- Operator initialized
- Verify on zekoscan.io

**Record**:
- Contract address → middleware .env
- Operator key → middleware .env

**Estimated effort**: 1-2 hours

### 5.2 Configure Middleware for Devnet

**File**: `middleware/.env`

**Required values**:
```bash
OPERATOR_PRIVATE_KEY=<operator-private-key>
MINA_NETWORK=zeko-devnet
MINA_GRAPHQL_ENDPOINT=https://devnet.zeko.io/graphql
MINA_POOL_ADDRESS=<deployed-contract-address>
ESCROWD_BASE_URL=http://127.0.0.1
ESCROWD_BASE_PORT=8000
ESCROWD_PORT_RANGE=10000
ESCROWD_OPERATOR_TOKEN=<generate-secure-token>
SUPABASE_URL=<your-supabase-url>
SUPABASE_SERVICE_ROLE_KEY=<your-supabase-key>
ORACLE_API_KEY=<your-doot-api-key>
ORACLE_BASE_URL=https://doot.foundation
ORACLE_SLIPPAGE_BPS=1000
ORACLE_TTL_MS=480000
POLL_INTERVAL_MS=15000
LOG_LEVEL=debug
```

### 5.3 Set Up Supabase Schema

**Table**: `keypairs`

**Schema**:
```sql
CREATE TABLE keypairs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  mina_public_key TEXT UNIQUE NOT NULL,
  zcash_public_key TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_mina_pk ON keypairs(mina_public_key);
CREATE INDEX idx_zcash_pk ON keypairs(zcash_public_key);
```

**Estimated effort**: 1 hour

---

## Phase 6: End-to-End Testing (Priority: CRITICAL)

### 6.1 Manual E2E Test Scenario

**Prerequisites**:
- Escrowm deployed to Zeko devnet
- Middleware configured and running
- Escrowd built (not started yet)
- Supabase configured
- Zcash testnet node accessible

**Test Scenario** (Alice sells ZEC, Bob buys ZEC with MINA):

**Step 1: Alice creates trade on MINA**
```bash
# Alice deposits 100 MINA to escrowm
# tradeId: generated UUID
# refundAddress: Alice's MINA address
```

**Step 2: Generate Alice's keypair**
```bash
# Add to Supabase:
# alice_mina_pk ↔ alice_zec_pk
```

**Step 3: Start escrowd instance for trade**
```bash
cd escrowd
export ESCROWD_ADDRESS_TYPE=Shielded
export ZCASHD_RPC_URL=http://testnet-node:8232
export MINA_ENDPOINT=https://devnet.zeko.io/graphql
export MINA_TO_PUBKEY=<escrowm-contract-address>
export MINA_MIN_AMOUNT=100000000000  # 100 MINA in nanomina
export OPERATOR_TOKEN=<secure-token>
export API_KEY=<alice-api-key>
export DATA_DIR=./data/trade-<trade-id>
cargo run --release
```

**Step 4: Alice deposits ZEC to escrowd**
```bash
# Send ZEC to escrowd address with memo
zcash-cli z_sendmany <alice-addr> '[{"address": "<escrowd-addr>", "amount": 1.0, "memo": "<trade-id-hex>"}]'
```

**Step 5: Wait for middleware to detect both sides funded**
- Middleware polls every 15s
- Should detect: MINA deposited + ZEC verified
- Locks both sides atomically

**Step 6: Alice claims MINA**
```bash
# Using ZEC secret (revealed from shielded note)
# Calls escrowm.claim(tradeId)
```

**Step 7: Middleware detects claim, sweeps ZEC to Alice**
- Calls escrowd /send-target with Alice's ZEC address
- Trade complete

**Verification**:
- Alice receives MINA
- Bob receives ZEC
- Both escrowm and escrowd in completed state
- No funds locked

**Estimated effort**: 2-3 days (setup + execution + debugging)

### 6.2 Automated E2E Test

**File to create**: `e2e/test-full-swap.sh`

**Test automation** (bash script):
1. Deploy contract (if not deployed)
2. Fund test accounts
3. Create trade
4. Start escrowd
5. Make deposits
6. Wait for lock
7. Execute claim
8. Verify balances
9. Cleanup

**Estimated effort**: 2 days

---

## Implementation Order & Timeline

### Week 1: Infrastructure & Unit Tests
**Days 1-2**: Phase 1 - Test infrastructure setup
- Set up Jest for middleware
- Set up cargo test for escrowd
- Create mock utilities

**Days 3-5**: Phase 2.1 - Middleware unit tests
- Write 8 unit test files
- Achieve 60%+ coverage

**Days 6-7**: Phase 2.2 - Escrowd unit tests (start)
- Add test modules to 4 source files

### Week 2: Unit Tests & Integration Tests
**Days 8-10**: Phase 2.2 - Escrowd unit tests (finish)
- Complete remaining 3 source files
- Achieve 60%+ coverage

**Days 11-14**: Phase 3 - Integration tests
- Middleware integration tests (4 files)
- Escrowd integration tests (3 files)

### Week 3: Deployment & E2E Testing
**Day 15**: Phase 4 - Escrowm validation
- Run existing tests
- Add settlement proof test

**Days 16-17**: Phase 5 - Deployment
- Deploy to Zeko devnet
- Configure middleware
- Set up Supabase

**Days 18-21**: Phase 6 - E2E testing
- Manual E2E test
- Debug issues
- Automated E2E test

**Total estimated time**: ~21 days (3 weeks)

---

## Success Criteria

### Phase 1: Infrastructure ✓
- [ ] Jest configured and running in middleware
- [ ] Cargo test working in escrowd
- [ ] Mock utilities created
- [ ] Test scripts in package.json

### Phase 2: Unit Tests ✓
- [ ] Middleware: 8 test files, 60%+ coverage
- [ ] Escrowd: 7 test modules, 60%+ coverage
- [ ] All tests passing
- [ ] No compilation errors

### Phase 3: Integration Tests ✓
- [ ] Middleware: 4 integration test files passing
- [ ] Escrowd: 3 integration test files passing
- [ ] Error scenarios covered
- [ ] Mock integration points working

### Phase 4: Escrowm Validation ✓
- [ ] All 11 existing tests passing
- [ ] Settlement proof test added and passing
- [ ] Contract ready for deployment

### Phase 5: Deployment ✓
- [ ] Escrowm deployed to Zeko devnet
- [ ] Contract verified on zekoscan.io
- [ ] Middleware configured with contract address
- [ ] Supabase schema created and tested

### Phase 6: E2E Testing ✓
- [ ] Manual E2E test executed successfully
- [ ] Full trade lifecycle verified (deposit → lock → claim → sweep)
- [ ] Automated E2E test script working
- [ ] No funds stuck or lost

### Overall ✓
- [ ] All components have test coverage
- [ ] All tests passing
- [ ] System deployed to devnet
- [ ] Full swap cycle verified end-to-end
- [ ] Documentation updated with testing procedures

---

## Critical Files Reference

### Files to Read Before Implementation

**Escrowd**:
1. `/home/botvenom/Desktop/work/web3/mina/projects/professional/Doot/protocol/apps_on_doot/zec_barter/escrowd/src/api.rs` - API endpoints
2. `/home/botvenom/Desktop/work/web3/mina/projects/professional/Doot/protocol/apps_on_doot/zec_barter/escrowd/src/state.rs` - State management
3. `/home/botvenom/Desktop/work/web3/mina/projects/professional/Doot/protocol/apps_on_doot/zec_barter/escrowd/USAGE_AND_API.md` - API documentation

**Escrowm**:
4. `/home/botvenom/Desktop/work/web3/mina/projects/professional/Doot/protocol/apps_on_doot/zec_barter/escrowm/src/MinaEscrowPool.ts` - Contract
5. `/home/botvenom/Desktop/work/web3/mina/projects/professional/Doot/protocol/apps_on_doot/zec_barter/escrowm/src/MinaEscrowPool.test.ts` - Existing tests
6. `/home/botvenom/Desktop/work/web3/mina/projects/professional/Doot/protocol/apps_on_doot/zec_barter/escrowm/src/deploy-zeko.ts` - Deployment script

**Middleware**:
7. `/home/botvenom/Desktop/work/web3/mina/projects/professional/Doot/protocol/apps_on_doot/zec_barter/middleware/src/coordinator.ts` - Main coordinator
8. `/home/botvenom/Desktop/work/web3/mina/projects/professional/Doot/protocol/apps_on_doot/zec_barter/middleware/src/mina-client.ts` - MINA integration
9. `/home/botvenom/Desktop/work/web3/mina/projects/professional/Doot/protocol/apps_on_doot/zec_barter/middleware/src/escrowd-client.ts` - ZEC integration
10. `/home/botvenom/Desktop/work/web3/mina/projects/professional/Doot/protocol/apps_on_doot/zec_barter/middleware/src/oracle-client.ts` - Oracle integration

---

## Risk Mitigation

### High Risk Areas

1. **OffchainState Settlement Timing**
   - Risk: 5-6 minute settlement delay blocks queries
   - Mitigation: Test settlement worker thoroughly, add monitoring

2. **Port Collision in Production**
   - Risk: UUID collisions cause trade failures
   - Mitigation: Port collision detection implemented, test with multiple instances

3. **Oracle Price Staleness**
   - Risk: Outdated prices cause incorrect exchange rates
   - Mitigation: CoinGecko fallback implemented, TTL validation in place

4. **Zcashd RPC Failures**
   - Risk: Network issues break escrowd operations
   - Mitigation: Add retry logic, test timeout scenarios

5. **Supabase Downtime**
   - Risk: Cannot resolve cross-chain addresses
   - Mitigation: Add caching layer, test graceful degradation

### Testing Focus Areas

- **Concurrency**: Test multiple trades simultaneously
- **Error Recovery**: Test all failure modes (network, state, funds)
- **Security**: Test auth, signatures, operator permissions
- **Performance**: Test under load (10-20 concurrent trades)
- **Data Integrity**: Test state persistence and recovery

---

## Next Steps After Testing

Once all tests pass and E2E verification is complete:

1. **Performance Optimization**
   - Profile bottlenecks
   - Optimize polling frequency
   - Cache compilation results

2. **Monitoring & Observability**
   - Add structured logging (JSON)
   - Implement Prometheus metrics
   - Set up health check endpoints

3. **UI Development**
   - User interface for trade creation
   - Real-time trade status dashboard
   - Admin panel for operator

4. **Mainnet Preparation**
   - Security audit
   - Gas optimization
   - Migration scripts
   - Disaster recovery procedures

---

**Plan Complete - Ready for Implementation**
     try {
       // Step 1: Fetch fresh account state FIRST
       const account = await fetchAccount({
         publicKey: config.mina.poolAddress
       });

       if (!account.account) {
         logger.warn('Account not found on-chain');
         return 0;
       }

       // Step 2: Create zkApp instance AFTER fetch
       const zkApp = await createContractInstance(config.mina.poolAddress);

       // Step 3: Get fresh commitments
       const commitments = zkApp.offchainStateCommitments.get();

       // Step 4: Fetch actions since last settlement
       const actions = await Mina.fetchActions(
         config.mina.poolAddress,
         { fromActionState: commitments.actionState }
       );

       if ('error' in actions) {
         logger.warn(`Fetch actions error: ${actions.error.statusText}`);
         return 0;
       }

       // Step 5: Count all actions across blocks/accounts
       const count = actions.reduce((blockSum, block) => {
         const blockCount = block.actions.reduce(
           (acctSum, acct) => acctSum + acct.length,
           0
         );
         return blockSum + blockCount;
       }, 0);

       logger.debug(
         `Pending actions: ${count} (from actionState: ${commitments.actionState})`
       );
       return count;

     } catch (error) {
       logger.error(`getPendingActionsCount failed: ${error}`);
       return 0;
     }
   }
   ```

2. **Lower settlement threshold** (line 47):
   ```typescript
   // Change from 3 to 1 for immediate settlement
   private minActionsThreshold = 1;
   ```

3. **Add settlement state logging** (line 65-75):
   ```typescript
   if (pendingActionsCount >= this.minActionsThreshold) {
     logger.info(
       `Found ${pendingActionsCount} pending actions, triggering settlement...`
     );
     await this.triggerSettlement(zkApp, modules);
   } else {
     logger.debug(`Only ${pendingActionsCount} pending actions (threshold: ${this.minActionsThreshold})`);
   }
   ```

**Key Insight from Exploration:**
- Zeko devnet uses SAME URL for archive and active nodes: `https://devnet.zeko.io/graphql`
- `Mina.fetchActions()` internally handles GraphQL queries
- Actions are returned as 2D array: `Block[] → Action[][]`
- Pending actions = all actions after `offchainStateCommitments.actionState`

---

## 2. Oracle Fallback Implementation

### Current State
- `middleware/src/oracle-client.ts` only uses Doot API
- No fallback when Doot is down
- User wants CoinGecko as backup

### Requirements
- Primary: Doot Foundation API (requires API key)
- Fallback: CoinGecko API (free, no auth)
- UI should show alert when using fallback
- Support both MINA and ZEC tokens

### Implementation Plan

**File:** `middleware/src/oracle-client.ts`

**Changes Required:**

1. **Add CoinGecko token mapping** (after imports):
   ```typescript
   const COINGECKO_TOKEN_IDS: Record<'mina' | 'zec', string> = {
     mina: 'mina-protocol',
     zec: 'zcash'
   };
   ```

2. **Add CoinGecko fetch function** (new function):
   ```typescript
   async function fetchFromCoinGecko(token: 'mina' | 'zec'): Promise<OraclePrice> {
     const cgId = COINGECKO_TOKEN_IDS[token];
     const url = `https://api.coingecko.com/api/v3/simple/price?ids=${cgId}&vs_currencies=usd`;

     const resp = await fetch(url, {
       method: 'GET',
       headers: { 'Content-Type': 'application/json' }
     });

     if (!resp.ok) {
       throw new Error(`CoinGecko HTTP ${resp.status}: ${await resp.text()}`);
     }

     const data = await resp.json();
     const priceUSD = data[cgId]?.usd;

     if (!priceUSD || priceUSD <= 0) {
       throw new Error(`Invalid CoinGecko price: ${priceUSD}`);
     }

     // Transform to match Doot format
     const DECIMALS = 1e9;
     const scaledPrice = Math.floor(priceUSD * DECIMALS);

     return {
       price: scaledPrice.toString(),
       decimals: DECIMALS,
       aggregationTimestamp: Date.now(),
       signature: {
         signature: 'coingecko-fallback',
         publicKey: 'coingecko',
         data: 'fallback-source'
       }
     };
   }
   ```

3. **Modify existing fetchPrice to use fallback** (replace current function):
   ```typescript
   async function fetchPrice(token: 'mina' | 'zec'): Promise<OraclePrice> {
     try {
       // Try Doot first (primary source)
       const url = `${config.oracle.baseUrl}/api/get/price?token=${token}`;
       const resp = await fetch(url, {
         method: 'GET',
         headers: {
           Authorization: `Bearer ${config.oracle.apiKey}`,
         },
       });

       if (!resp.ok) {
         throw new Error(`Doot HTTP ${resp.status}`);
       }

       const json = (await resp.json()) as OracleResponse;
       if (!json.status || !json.data?.price_data) {
         throw new Error(`Doot response missing price_data for ${token}`);
       }

       return json.data.price_data;

     } catch (dootError) {
       // Doot failed, try CoinGecko
       console.warn(`⚠️  Doot oracle failed for ${token}, using CoinGecko fallback: ${dootError.message}`);

       try {
         const fallbackPrice = await fetchFromCoinGecko(token);
         console.info(`✓ CoinGecko fallback successful for ${token}`);
         return fallbackPrice;
       } catch (fallbackError) {
         throw new Error(
           `All oracle sources failed for ${token}. Doot: ${dootError.message}, CoinGecko: ${fallbackError.message}`
         );
       }
     }
   }
   ```

4. **Add health check function** (new export):
   ```typescript
   export async function isDootHealthy(): Promise<boolean> {
     try {
       const resp = await fetch(`${config.oracle.baseUrl}/api/health`, {
         method: 'GET',
         timeout: 5000
       });
       return resp.ok;
     } catch {
       return false;
     }
   }
   ```

**Key Insights from Exploration:**
- CoinGecko free tier: 10-50 calls/min (sufficient)
- No API key required
- Response format: `{ "mina-protocol": { "usd": 0.45 } }`
- Doot uses 10^9 decimals scaling factor
- Signatures will be placeholders (acceptable for fallback)

---

## 3. Port Collision Handling

### Current State
- Deterministic port derivation: `basePort + Poseidon(UUID) % portRange`
- Port range: 10,000 (8000-18000)
- No collision detection or handling
- Expected max concurrent: 100-200 trades

### Strategy
- Check if port is occupied before processing trade
- If occupied, log warning and skip trade (let user regenerate UUID)
- Add monitoring for collision frequency

### Implementation Plan

**File:** `middleware/src/port-manager.ts` (NEW FILE)

**Create new utility module:**

```typescript
import { config, getEscrowdUrl } from './config.js';
import { logger } from './logger.js';

export class PortManager {
  /**
   * Check if a port is occupied by an active escrowd instance
   */
  async isPortAvailable(tradeId: string): Promise<boolean> {
    try {
      const url = getEscrowdUrl(tradeId, '/status');

      // Try to connect with short timeout
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2000);

      try {
        const response = await fetch(url, {
          method: 'GET',
          signal: controller.signal,
          headers: { 'Content-Type': 'application/json' },
        });

        clearTimeout(timeout);

        // If we got any response (even error), port is occupied
        logger.debug(`Port for trade ${tradeId} is occupied (HTTP ${response.status})`);
        return false;

      } catch (fetchError) {
        clearTimeout(timeout);

        // Connection refused or timeout = port is free
        logger.debug(`Port for trade ${tradeId} is available`);
        return true;
      }

    } catch (error) {
      // Assume available on unexpected errors
      logger.warn(`Port check failed for ${tradeId}: ${error}`);
      return true;
    }
  }

  /**
   * Log collision statistics
   */
  logCollision(tradeId: string, port: number): void {
    logger.warn(
      `⚠️  PORT COLLISION: Trade ${tradeId} maps to occupied port ${port}. ` +
      `Trade will be skipped until user regenerates UUID or escrowd instance exits.`
    );
  }
}

export const portManager = new PortManager();
```

**File:** `middleware/src/coordinator.ts`

**Add port check in processTrade method** (line 119, before lockBothSides):

```typescript
import { portManager } from './port-manager.js';

// In processTrade method, add after getting combined state:
private async processTrade(minaTrade: MinaTrade) {
  logger.debug(`Processing trade ${minaTrade.tradeId}`);

  try {
    // NEW: Check port availability FIRST
    const isPortAvailable = await portManager.isPortAvailable(minaTrade.tradeId);

    if (!isPortAvailable) {
      const port = getEscrowdPort(minaTrade.tradeId);
      portManager.logCollision(minaTrade.tradeId, port);
      return; // Skip this trade, retry in next poll cycle
    }

    // Get combined state from both chains
    const state = await this.getCombinedState(minaTrade.tradeId);

    // ... rest of existing logic
  } catch (error) {
    logger.error(`Failed to process trade ${minaTrade.tradeId}: ${error}`);
  }
}
```

**Key Insights from Exploration:**
- `/status` endpoint already exists in escrowd API
- Connection refused = port free
- HTTP response (any status) = port occupied
- Trade UUID is immutable on-chain, can't regenerate automatically
- Let normal polling retry handle transient collisions

---

## 4. Environment Configuration Update

### Current State
- `.env.example` missing Supabase and Oracle config
- New integrations require documentation

### Implementation Plan

**File:** `middleware/.env.example`

**Add missing configuration sections:**

```bash
# Middleware Configuration

# Operator private key (pays for lockTrade transactions on MINA)
OPERATOR_PRIVATE_KEY=EKE...

# Mina Network
MINA_NETWORK=zeko-devnet
MINA_GRAPHQL_ENDPOINT=https://devnet.zeko.io/graphql

# MinaEscrowPool contract address (deployed zkApp)
MINA_POOL_ADDRESS=B62q...

# Escrowd Configuration (ZEC side)
# Base URL for escrowd instances (without trailing slash)
# Each trade gets a dedicated escrowd instance at a unique port
ESCROWD_BASE_URL=http://127.0.0.1
ESCROWD_BASE_PORT=8000
ESCROWD_PORT_RANGE=10000

# Operator token for authenticating with escrowd instances
ESCROWD_OPERATOR_TOKEN=your-secure-token-here

# === NEW: Supabase Configuration ===
# Supabase project URL
SUPABASE_URL=https://your-project.supabase.co

# Supabase service role key (has admin access, keep secure)
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

# === NEW: Oracle (Doot) Configuration ===
# Doot Foundation API key for price feeds
ORACLE_API_KEY=your-doot-api-key-here

# Doot API base URL (default: https://doot.foundation)
ORACLE_BASE_URL=https://doot.foundation

# Slippage tolerance in basis points (default: 1000 = 10%)
# This is the tolerance between consecutive 10-minute oracle updates
ORACLE_SLIPPAGE_BPS=1000

# Oracle price TTL in milliseconds (default: 480000 = 8 minutes)
ORACLE_TTL_MS=480000

# Polling Configuration
POLL_INTERVAL_MS=15000  # Check for new trades every 15 seconds

# Logging
LOG_LEVEL=info  # debug, info, warn, error
```

---

## 5. Clean Slate Crash Recovery

### Current State
- No automatic cleanup on middleware restart
- Locked trades might be stuck if middleware crashes

### Strategy
- On startup, detect any trades in inconsistent state
- Auto-unlock trades where MINA locked but ZEC not locked
- Clear in-memory caches

### Implementation Plan

**File:** `middleware/src/coordinator.ts`

**Add recovery method:**

```typescript
/**
 * Clean slate recovery: unlock any stuck trades on startup
 */
async cleanSlate() {
  logger.info('Performing clean slate recovery...');

  try {
    // Get all active trades from MINA
    const minaTrades = await minaClient.getActiveTrades();

    let unlockedCount = 0;

    for (const trade of minaTrades) {
      // Check if MINA is locked but ZEC is not
      if (trade.inTransit) {
        const zecState = await escrowdClient.getStatus(trade.tradeId);

        if (!zecState || !zecState.in_transit) {
          // Inconsistent state: MINA locked but ZEC not locked
          logger.warn(
            `Trade ${trade.tradeId} in inconsistent state (MINA locked, ZEC not locked). ` +
            `Triggering emergency unlock...`
          );

          try {
            await minaClient.emergencyUnlock(trade.tradeId);
            unlockedCount++;
            logger.info(`✓ Emergency unlocked trade ${trade.tradeId}`);
          } catch (unlockError) {
            logger.error(`Failed to emergency unlock ${trade.tradeId}: ${unlockError}`);
          }
        }
      }
    }

    if (unlockedCount > 0) {
      logger.info(`Clean slate recovery complete: unlocked ${unlockedCount} trades`);
    } else {
      logger.info('Clean slate recovery complete: no stuck trades found');
    }

  } catch (error) {
    logger.error(`Clean slate recovery failed: ${error}`);
  }
}
```

**Update initialize method** (line 28-36):

```typescript
async initialize() {
  logger.info('Initializing coordinator...');

  // Initialize Mina client
  await minaClient.initialize();
  await minaClient.compile();

  // NEW: Perform clean slate recovery
  await this.cleanSlate();

  logger.info('✓ Coordinator initialized');
}
```

**Clear in-memory caches on stop** (line 66-80):

```typescript
stop() {
  if (!this.isRunning) {
    return;
  }

  logger.info('Stopping coordinator...');
  this.isRunning = false;

  if (this.pollInterval) {
    clearInterval(this.pollInterval);
    this.pollInterval = null;
  }

  // NEW: Clear in-memory state
  this.lockedTrades.clear();
  this.lockRetryState.clear();

  logger.info('✓ Coordinator stopped');
}
```

---

## Critical Files to Modify

### New Files
1. `middleware/src/port-manager.ts` - Port collision detection utility

### Modified Files
1. `middleware/src/settlement-worker.ts` - Fix getPendingActionsCount()
2. `middleware/src/oracle-client.ts` - Add CoinGecko fallback
3. `middleware/src/coordinator.ts` - Add port checks and clean slate recovery
4. `middleware/.env.example` - Add missing configuration

---

## Implementation Order

1. **Settlement Worker** (highest priority)
   - Fixes immediate functionality gap
   - Required for OffchainState to stay current
   - ~30 lines of changes

2. **Environment Configuration**
   - Documents required setup
   - Prevents deployment errors
   - ~20 lines of additions

3. **Oracle Fallback**
   - Improves reliability
   - No new dependencies
   - ~80 lines of new code

4. **Port Collision Handling**
   - Adds monitoring/detection
   - Creates new utility module
   - ~100 lines total

5. **Clean Slate Recovery**
   - Crash resilience
   - Builds on existing methods
   - ~50 lines of changes

---

## Testing Strategy

After implementation, test each component:

1. **Settlement Worker**
   - Trigger multiple deposits
   - Verify settlement proofs generated
   - Check action count logging

2. **Oracle Fallback**
   - Simulate Doot downtime
   - Verify CoinGecko fallback triggers
   - Check price format consistency

3. **Port Collision**
   - Start escrowd on specific port
   - Try to process trade with colliding UUID
   - Verify warning logged and trade skipped

4. **Clean Slate Recovery**
   - Lock MINA but leave ZEC unlocked
   - Restart middleware
   - Verify emergency unlock triggered

5. **Integration Test**
   - Full swap cycle end-to-end
   - Monitor all logs
   - Verify no errors

---

## Success Criteria

- ✅ Settlement worker generates proofs for pending actions
- ✅ Oracle falls back to CoinGecko when Doot is down
- ✅ Port collisions detected and logged (trades retried)
- ✅ Clean slate recovery unlocks inconsistent trades on startup
- ✅ All configuration documented in .env.example
- ✅ No TypeScript compilation errors
- ✅ All components integrated and tested

---

## Next Steps After This Plan

1. Execute implementation in order listed
2. Run smoke tests for each component
3. Build comprehensive integration tests
4. Prepare for UI development phase
