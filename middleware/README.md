# MINA ↔ ZEC Barter Middleware

Stateless coordinator for atomic swaps between MINA and Zcash (ZEC).

## Overview

The middleware provides:

1. **Stateless Coordination**: Polls both chains to detect funded trades and orchestrates atomic locks
2. **API Server**: REST API for spawning and managing escrowdv2 instances
3. **Settlement Worker**: Generates and submits settlement proofs for off-chain state
4. **Port Management**: Deterministic port allocation using Poseidon hash

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Middleware                             │
│                                                             │
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────┐     │
│  │ API Server   │   │ Coordinator  │   │  Settlement  │     │
│  │  (Express)   │   │   (Polling)  │   │    Worker    │     │
│  └──────┬───────┘   └──────┬───────┘   └──────┬───────┘     │
│         │                  │                  │             │
│         │                  │                  │             │
│  ┌──────▼──────────────────▼──────────────────▼─────────┐   │
│  │           Escrowd Manager (Process Spawning)         │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
         │                  │                  │
         ▼                  ▼                  ▼
   Escrowdv2           Mina Chain         MINA Pool
   Instances          (via GraphQL)       zkApp State
```

## Features

### 1. API Server

Exposes REST endpoints for:

- **Spawning escrowdv2 instances** (`POST /api/spawn-escrowd`)
- **Querying instance status** (`GET /api/escrowd/:tradeId/status`)
- **Killing instances** (`DELETE /api/escrowd/:tradeId`)
- **Listing all instances** (`GET /api/escrowd/instances`)

See [API.md](./API.md) for full documentation.

### 2. Coordinator

Stateless polling-based coordinator that:

- Queries MINA chain for active trades (every 15s by default)
- Checks corresponding ZEC escrowdv2 instances
- Locks both sides when both funded (with Doot oracle + CoinGecko fallback pricing)
- Sweeps ZEC after MINA claim
- **Clean Slate Recovery**: On startup, emergency unlocks any stuck MINA locks
- **Multi-Lock Prevention**: Caches MINA lock tx hashes to prevent duplicate locks
- **Retry Logic**: 5 attempts with 60s backoff for ZEC locks, then emergency unlock
- **Transient Error Handling**: Skips "root mismatch" errors during settlement

### 3. Settlement Worker

- Monitors pending OffchainState actions every 60 seconds
- Generates ZK proofs for off-chain state changes (~5-6 minutes)
- Submits settlement transactions to MINA chain
- Ensures off-chain state integrity
- **Non-Blocking**: Runs in background while coordinator handles new trades
- **Lock Prevention**: Uses `isSettling` flag to prevent concurrent settlements

### 4. Process Management

- Spawns escrowdv2 instances on **sequential ports** (9000, 9001, 9002, ...)
- Tracks process lifecycle
- Cleans up on shutdown
- **Port Allocation**: Simple sequential counter, NOT hash-based derivation

## Installation

```bash
npm install
```

## Configuration

Copy `.env.example` to `.env` and configure:

### Required Variables

```bash
# Operator (pays MINA transaction fees)
OPERATOR_PRIVATE_KEY=EKE...

# Mina Network
MINA_GRAPHQL_ENDPOINT=https://devnet.zeko.io/graphql
MINA_POOL_ADDRESS=B62q...

# Escrowd
ESCROWD_OPERATOR_TOKEN=this_is_escrowd_operator_token  # POC unified token

# Supabase (keypair store)
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJh...

# Oracle (Doot)
ORACLE_API_KEY=your-doot-api-key
```

### Optional Variables

```bash
# API Server
API_HOST=127.0.0.1
API_PORT=3000

# Escrowd Configuration
ESCROWD_BASE_PORT=9000  # Sequential allocation starting point
ESCROWD_BINARY_PATH=cargo
ESCROWD_WORKING_DIR=../zcash/escrowdv2

# Polling & Settlement
POLL_INTERVAL_MS=15000         # Coordinator polling (default: 15s)
SETTLEMENT_INTERVAL_MS=60000   # Settlement worker (default: 60s)

# Oracle (Doot Foundation)
ORACLE_API_KEY=your-doot-api-key
ORACLE_BASE_URL=https://doot.foundation
ORACLE_SLIPPAGE_BPS=1000      # 10% slippage tolerance
ORACLE_TTL_MS=480000          # Price TTL (8 minutes)

# Logging
LOG_LEVEL=info
```

## Usage

### Build

```bash
npm run build
```

### Run

```bash
npm start
```

This starts:

1. API server on `http://127.0.0.1:3000`
2. Coordinator (polling every 15s)
3. Settlement worker

### Development

```bash
# Watch mode
npm run watch

# In another terminal
npm start
```

## API Usage Examples

### Spawn an escrowdv2 instance

```bash
curl -X POST http://127.0.0.1:3000/api/spawn-escrowd \
  -H "Content-Type: application/json" \
  -d '{
    "tradeId": "550e8400-e29b-41d4-a716-446655440000",
    "apiKey": "test-api-key"
  }'
```

Response:

```json
{
  "success": true,
  "port": 8123,
  "message": "Instance spawned successfully"
}
```

### Check instance status

```bash
curl http://127.0.0.1:3000/api/escrowd/550e8400-e29b-41d4-a716-446655440000/status
```

### List all instances

```bash
curl http://127.0.0.1:3000/api/escrowd/instances
```

## Integration Flow

### Mina-Initiated Barter (Selling MINA for ZEC)

1. **User creates listing** → MINA deposited to pool contract
2. **Buyer clicks "Buy"** → UI calls `/api/spawn-escrowd`
3. **UI fetches ZEC address** → Buyer sends ZEC to escrow
4. **Middleware detects both funded** → Locks both sides
5. **Buyer claims from pool** → MINA sent to seller
6. **Middleware detects claim** → Sweeps ZEC to buyer

### ZEC-Initiated Barter (Selling ZEC for MINA)

1. **User spawns escrowdv2** → Deposits ZEC to escrow
2. **Buyer deposits MINA** → Middleware detects and locks
3. **Seller claims from escrow** → ZEC sent to seller
4. **Middleware sweeps MINA** → MINA sent to buyer

## Port Allocation

Ports are allocated **sequentially** (NOT hash-based):

```typescript
// Simple sequential allocation
port = nextAvailablePort; // Starting from ESCROWD_BASE_PORT (default: 9000)
nextAvailablePort++;
```

**Example:**

- First trade: Port `9000`
- Second trade: Port `9001`
- Third trade: Port `9002`
- ...and so on

This ensures:

- Simple, predictable port allocation
- No port collisions within middleware session
- Easy to track and debug
- **POC Simplification**: Production would use hash-based derivation for distributed coordinators

## Testing

```bash
# Run all tests
npm test

# Unit tests only
npm run test:unit

# Integration tests only
npm run test:integration

# Watch mode
npm run test:watch

# Coverage
npm run test:coverage
```

## Logging

The middleware uses structured logging with levels:

- `debug`: Detailed execution traces
- `info`: Normal operations (default)
- `warn`: Warning conditions
- `error`: Error conditions

Set `LOG_LEVEL` environment variable to control output.

## Security

### Localhost Only

By default, the API server binds to `127.0.0.1` (localhost only).

**Production Considerations:**

- Add authentication/authorization
- Use rate limiting
- Enable HTTPS
- Network isolation

### Process Management

- Spawned escrowdv2 processes are tracked and cleaned up on shutdown
- Processes run with limited permissions
- SIGTERM/SIGINT handlers ensure graceful shutdown

## Troubleshooting

### API server not responding

```bash
# Check if port is in use
lsof -i :3000

# Check middleware logs
tail -f logs/middleware.log
```

### Escrowdv2 instance fails to spawn

```bash
# Verify escrowdv2 can compile
cd ../zcash/escrowdv2
cargo build --release

# Check working directory
echo $ESCROWD_WORKING_DIR

# Verify binary path
which cargo
```

### Coordinator not detecting trades

```bash
# Verify GraphQL endpoint
curl $MINA_GRAPHQL_ENDPOINT

# Check pool address
echo $MINA_POOL_ADDRESS

# Increase log level
LOG_LEVEL=debug npm start
```

### "Root mismatch" or "Cannot read properties of undefined"

These are transient OffchainState errors during settlement:

- **Cause**: Settlement worker is generating proofs (~5-6 minutes)
- **Resolution**: Automatic - middleware skips affected polls and retries
- **Action**: Wait for settlement to complete
- **Not an error**: Normal behavior during OffchainState commitment updates

### Oracle pricing failures

Check Doot oracle health and fallback:

```bash
# Check Doot API
curl -H "Authorization: Bearer $ORACLE_API_KEY" \
  https://doot.foundation/api/get/price?token=mina

# CoinGecko fallback is automatic on Doot failure
# Check logs for: "⚠️  Doot oracle failed, using CoinGecko fallback"
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make changes with tests
4. Submit pull request

## License

MIT
