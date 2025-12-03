# MinaEscrowPool Settlement Service

Dedicated service for handling OffchainState settlement proofs for the MinaEscrowPool smart contract.

---

## Overview

This service runs **independently from the middleware** to handle CPU-intensive settlement proof generation without blocking the API server or coordinator.

### Why a Separate Service?

Settlement proof generation:
- Takes **5-6 minutes** per proof
- Uses **100% CPU** across multiple cores
- Consumes **4-8GB RAM** during proof generation
- Would block middleware API/coordinator if run in same process

### Architecture

```
┌─────────────────────────────────────────────┐
│  Settlement Service (Dedicated Process)     │
│                                             │
│  ┌────────────────────────────────────┐    │
│  │  Settlement Worker                 │    │
│  │  - Check every 60s                 │    │
│  │  - Query pending actions           │    │
│  │  - Generate proofs (~5-6 min)      │    │
│  │  - Submit to contract              │    │
│  └────────────────────────────────────┘    │
│                                             │
│  ┌────────────────────────────────────┐    │
│  │  Mina Client                       │    │
│  │  - Read contract state             │    │
│  │  - Submit settlement txns          │    │
│  └────────────────────────────────────┘    │
│                                             │
│  ┌────────────────────────────────────┐    │
│  │  Contract Loader                   │    │
│  │  - Import from escrowm-init/       │    │
│  │  - Compile once at startup         │    │
│  └────────────────────────────────────┘    │
└─────────────────────────────────────────────┘
         │
         ▼ GraphQL
┌─────────────────────────────────────────────┐
│  Mina/Zeko Network                          │
│  - MinaEscrowPool contract                  │
│  - OffchainState Merkle map                 │
└─────────────────────────────────────────────┘
```

---

## Installation

```bash
# Install dependencies
npm install

# Build
npm run build
```

---

## Configuration

Copy `.env.example` to `.env` and configure:

```bash
# Network
MINA_NETWORK=zeko-devnet
MINA_GRAPHQL_ENDPOINT=https://devnet.zeko.io/graphql

# Contract (from escrowm-init deployment)
MINA_POOL_ADDRESS=B62qrb...

# Operator (pays settlement fees)
OPERATOR_PRIVATE_KEY=EKE...

# Settlement worker
SETTLEMENT_INTERVAL_MS=60000       # Check every 60s
SETTLEMENT_MIN_ACTIONS=1           # Trigger on any pending action

# Logging
LOG_LEVEL=info
```

---

## Usage

### Development

```bash
# Build contracts first
cd ../escrowm-init
npm install
npm run build

# Then start settlement service
cd ../escrowm
npm install
npm run build
npm start
```

### Production (Standalone)

```bash
# Using process manager (PM2)
npm install -g pm2
pm2 start npm --name "settlement-service" -- start
pm2 save
pm2 startup

# Monitor
pm2 logs settlement-service
pm2 monit
```

### Production (Docker)

```bash
# Build image
docker build -t settlement-service .

# Run
docker run -d \
  --name settlement-service \
  --env-file .env \
  --restart unless-stopped \
  settlement-service
```

---

## How It Works

### Settlement Cycle

Every 60 seconds (configurable):

**1. Check Pending Actions**
```
Settlement Worker
  ↓
  Query contract commitments
  ↓
  Fetch actions since last settlement
  ↓
  Count pending actions
```

**2. Generate Proof (if threshold met)**
```
Settlement Worker
  ↓
  offchainState.createSettlementProof()
  ↓
  5-6 minutes of ZK proof generation
  ↓
  Proof ready
```

**3. Submit to Contract**
```
Settlement Worker
  ↓
  Create transaction: zkApp.settle(proof)
  ↓
  Generate transaction proof
  ↓
  Sign with operator key
  ↓
  Submit to network
  ↓
  Wait for confirmation
```

### Output Example

```
[2024-01-15T10:30:00.000Z] [INFO] === MinaEscrowPool Settlement Service ===
[2024-01-15T10:30:00.001Z] [INFO] Network: zeko-devnet
[2024-01-15T10:30:00.001Z] [INFO] Pool Address: B62qrb...
[2024-01-15T10:30:00.001Z] [INFO]
[2024-01-15T10:30:00.002Z] [INFO] Initializing Mina client...
[2024-01-15T10:30:00.003Z] [INFO] ✓ Connected to zeko-devnet
[2024-01-15T10:30:00.004Z] [INFO] Compiling MinaEscrowPool...
[2024-01-15T10:30:50.234Z] [INFO] ✓ Compiled in 50.23s
[2024-01-15T10:30:50.235Z] [INFO] ✓ Mina client initialized
[2024-01-15T10:30:50.236Z] [INFO]
[2024-01-15T10:30:50.237Z] [INFO] Starting settlement worker...
[2024-01-15T10:30:50.238Z] [INFO] Settlement worker started (interval: 60000ms, threshold: 1 actions)
[2024-01-15T10:30:50.239Z] [INFO] ✓ Settlement service running
[2024-01-15T10:30:50.240Z] [INFO]
[2024-01-15T10:30:50.241Z] [INFO] Press Ctrl+C to stop
[2024-01-15T10:30:50.242Z] [DEBUG] --- Settlement check start ---
[2024-01-15T10:30:50.500Z] [DEBUG] Pending actions: 0 (from actionState: ...)
[2024-01-15T10:30:50.501Z] [DEBUG] Pending actions: 0 (threshold: 1) - skipping settlement
[2024-01-15T10:30:50.502Z] [DEBUG] --- Settlement check end ---

# ... 60 seconds later ...

[2024-01-15T10:31:50.242Z] [DEBUG] --- Settlement check start ---
[2024-01-15T10:31:50.500Z] [DEBUG] Pending actions: 3 (from actionState: ...)
[2024-01-15T10:31:50.501Z] [INFO] Found 3 pending actions (threshold: 1)
[2024-01-15T10:31:50.502Z] [INFO] Triggering settlement...
[2024-01-15T10:31:50.503Z] [INFO] === SETTLEMENT PROOF GENERATION STARTING ===
[2024-01-15T10:31:50.504Z] [INFO] This will take approximately 5-6 minutes...
[2024-01-15T10:31:50.505Z] [INFO]
[2024-01-15T10:31:50.506Z] [INFO] [1/2] Generating settlement proof...

# ... 5-6 minutes pass ...

[2024-01-15T10:37:23.456Z] [INFO] ✓ Settlement proof generated in 332.95s
[2024-01-15T10:37:23.457Z] [INFO]
[2024-01-15T10:37:23.458Z] [INFO] [2/2] Submitting settlement proof...
[2024-01-15T10:37:23.459Z] [INFO] Submitting settlement proof...
[2024-01-15T10:37:23.460Z] [DEBUG] Proving settlement transaction...
[2024-01-15T10:37:35.123Z] [DEBUG] Signing and sending...
[2024-01-15T10:37:36.456Z] [INFO] ✓ Settlement transaction sent: CkpZ...
[2024-01-15T10:37:36.457Z] [DEBUG] Waiting for confirmation...
[2024-01-15T10:37:48.789Z] [INFO] ✓ Settlement confirmed: CkpZ...
[2024-01-15T10:37:48.790Z] [INFO] ✓ Proof submitted in 25.33s
[2024-01-15T10:37:48.791Z] [INFO]
[2024-01-15T10:37:48.792Z] [INFO] === SETTLEMENT COMPLETE ===
[2024-01-15T10:37:48.793Z] [INFO] Total time: 358.29s
[2024-01-15T10:37:48.794Z] [INFO] Transaction: CkpZ...
[2024-01-15T10:37:48.795Z] [INFO]
[2024-01-15T10:37:48.796Z] [DEBUG] --- Settlement check end ---
```

---

## Resource Requirements

### Minimum

- **CPU**: 2 cores
- **RAM**: 4GB
- **Disk**: 1GB (for compiled contracts)
- **Network**: Stable connection to Mina/Zeko GraphQL endpoint

### Recommended

- **CPU**: 4 cores (faster proof generation)
- **RAM**: 8GB (comfortable headroom)
- **Disk**: 2GB
- **Network**: Low-latency connection

### During Settlement Proof Generation

- **CPU**: 100% utilization across all cores
- **RAM**: 4-8GB peak usage
- **Duration**: 5-6 minutes

---

## Monitoring

### Health Checks

```bash
# Check if process is running
ps aux | grep "node build/src/index.js"

# Check logs
tail -f /path/to/logs/settlement.log

# With PM2
pm2 status
pm2 logs settlement-service
pm2 monit
```

### Key Metrics

- **Pending actions count**: Should stay low (<10)
- **Settlement frequency**: Every 60-120 seconds (if active trades)
- **Proof generation time**: 5-6 minutes
- **Transaction confirmation time**: 10-30 seconds (Zeko L2)

---

## Troubleshooting

### Settlement proofs taking too long

**Cause**: Low CPU resources

**Solution**: Allocate more CPU cores or upgrade hardware

### "Account not found" error

**Cause**: Contract address incorrect or not deployed

**Solution**: Verify `MINA_POOL_ADDRESS` matches deployed contract

### "Insufficient balance" error

**Cause**: Operator account has < 0.1 MINA

**Solution**: Fund operator account with at least 1 MINA

### Settlement fails with "Invalid proof"

**Cause**: Contract state changed during proof generation

**Solution**: Proof will retry on next cycle (this is normal)

---

## Integration with Middleware

The settlement service is **independent** from the middleware:

```
┌─────────────────────────┐       ┌─────────────────────────┐
│  Middleware             │       │  Settlement Service     │
│  - API Server           │       │  - Settlement Worker    │
│  - Coordinator          │       │  - Proof Generation     │
│  - Escrowd Manager      │       │                         │
└────────┬────────────────┘       └────────┬────────────────┘
         │                                 │
         │                                 │
         └─────────────┬───────────────────┘
                       │
                       ▼
            ┌──────────────────────┐
            │  MinaEscrowPool      │
            │  (Zeko L2)           │
            └──────────────────────┘
```

**Middleware writes**:
- `lockTrade()` - Locks MINA side
- `emergencyUnlock()` - Unlocks MINA if ZEC lock fails

**Settlement service writes**:
- `settle(proof)` - Commits OffchainState changes

Both services share the same operator key but run independently.

---

## Development

### Project Structure

```
escrowm/
├── src/
│   ├── index.ts                # Service entry point
│   ├── config.ts               # Configuration
│   ├── logger.ts               # Logging
│   ├── mina-client.ts          # Mina network client
│   ├── settlement-worker.ts    # Settlement logic
│   └── contract-loader.ts      # Import from escrowm-init/
├── build/                       # Compiled output
├── package.json
├── tsconfig.json
├── .env.example
└── README.md
```

### Testing Locally

```bash
# Terminal 1: Build contracts
cd escrowm-init
npm install
npm run build

# Terminal 2: Start settlement service
cd ../escrowm
npm install
npm run build
npm start

# Trigger a settlement by creating pending actions
# (e.g., via middleware lockTrade operations)
```

---

## License

Apache-2.0
