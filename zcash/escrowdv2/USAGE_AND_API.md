# Usage and API Guide - escrowdv2

How to run the escrow daemon against zcashd testnet via lightwalletd, and how to call the available endpoints.

## Prerequisites

- `zcashd` testnet running with `-experimentalfeatures` and `-lightwalletd` flags (full node, no pruning - required for lightwalletd)
- `lightwalletd` running and synced, exposing gRPC on port 9067
- RPC creds available: `ZCASHD_RPC_USER`, `ZCASHD_RPC_PASS`, `ZCASHD_RPC_URL` (default `http://127.0.0.1:18232`)
- Sapling parameters downloaded to `~/.zcash-params/`
- `escrowdv2` binary built via `cargo build --release`
- Environment values (see `.env`):
  - `API_KEY` - shared secret with funder
  - `OPERATOR_TOKEN` - **required** Bearer token for operator endpoints (protects `/set-in-transit`, `/send-target`)
  - `MINA_TO_PUBKEY` - Mina recipient public key
  - `MINA_MIN_AMOUNT` - minimum Mina payment (default `0.001` MINA)
  - `FUNDING_MIN_ZEC` - minimum ZEC funding (default `0.001`)
  - `ESCROW_ADDR_TYPE` (`shielded`|`transparent`)
  - `DATA_DIR`, `LISTEN_ADDR`
  - `LIGHTWALLETD_URL` (default `http://127.0.0.1:9067`)
  - `NETWORK` (`mainnet`|`testnet`)
  - `SAPLING_SPEND_PATH`, `SAPLING_OUTPUT_PATH`

## Architecture Differences from v1

**escrowdv2** uses the Zcash Rust SDK (`zcash_client_backend`, `zcash_client_sqlite`) instead of direct zcashd RPC:

- **Wallet sync**: Via lightwalletd gRPC (compact blocks) instead of full RPC polling
- **Local database**: SQLite wallet database in `DATA_DIR/lightwalletd/` stores notes, transactions, and sync state
- **Self-signing**: Transaction signing happens locally using the Zcash SDK, not via zcashd RPC
- **Performance**: Faster initial sync due to compact block format
- **Dependencies**: Requires lightwalletd running and accessible

## Running escrowdv2 (Single Instance)

```bash
cd zcash/escrowdv2

# Ensure .env is configured
cat .env

# Run in development mode
RUST_LOG=info cargo run

# Or run release binary
./target/release/escrowdv2
```

**Typical `.env` configuration**:

```bash
LISTEN_ADDR=127.0.0.1:8080
DATA_DIR=./data

ZCASHD_RPC_URL=http://127.0.0.1:18232
ZCASHD_RPC_USER=zcashrpc
ZCASHD_RPC_PASS=your_secure_password_here_change_me

LIGHTWALLETD_URL=http://127.0.0.1:9067
NETWORK=testnet

SAPLING_SPEND_PATH=/home/botvenom/.zcash-params/sapling-spend.params
SAPLING_OUTPUT_PATH=/home/botvenom/.zcash-params/sapling-output.params

ESCROW_ADDR_TYPE=shielded

MINA_ENDPOINT=https://api.minascan.io/archive/devnet/v1/graphql
MINA_TO_PUBKEY=B62qod2DugDjy9Jxhzd56gFS7npN8pWhanxxb36MLPzDDqtzzDyBy5z
API_KEY=change_me
FEE_CAP_MULTIPLIER=5.0
FUNDING_MIN_ZEC=0.001
MINA_MIN_AMOUNT=0.001
OPERATOR_TOKEN=test_operator_token_bf711b725d85f9095bf58b843803f95b
```

## Running Multiple Instances (Advanced)

If you need multiple escrow instances against the same zcashd/lightwalletd:

```bash
# Instance 1 (shielded, port 8081)
LISTEN_ADDR=127.0.0.1:8081 \
DATA_DIR=./data1 \
API_KEY=API1 \
OPERATOR_TOKEN=OPERATOR_TOKEN_1 \
MINA_TO_PUBKEY=MINA_TO_1 \
ESCROW_ADDR_TYPE=shielded \
RUST_LOG=info cargo run

# Instance 2 (transparent, port 8082)
LISTEN_ADDR=127.0.0.1:8082 \
DATA_DIR=./data2 \
API_KEY=API2 \
OPERATOR_TOKEN=OPERATOR_TOKEN_2 \
MINA_TO_PUBKEY=MINA_TO_2 \
ESCROW_ADDR_TYPE=transparent \
RUST_LOG=info cargo run

# Instance 3 (shielded, port 8083)
LISTEN_ADDR=127.0.0.1:8083 \
DATA_DIR=./data3 \
API_KEY=API3 \
OPERATOR_TOKEN=OPERATOR_TOKEN_3 \
MINA_TO_PUBKEY=MINA_TO_3 \
ESCROW_ADDR_TYPE=shielded \
RUST_LOG=info cargo run
```

Each instance:

- Creates its own escrow address and wallet database in `DATA_DIR/lightwalletd/`
- Syncs independently via lightwalletd
- Exposes `/address` endpoint with its unique address
- Maintains separate state in `DATA_DIR/state.json`
- Listens on its own port

## API Endpoints

All requests are JSON over HTTP. Operator endpoints (`/set-in-transit`, `/send-target`) are localhost-only and **require `Authorization: Bearer <OPERATOR_TOKEN>` header**.

### Public Endpoints

#### `GET /health`

Health check endpoint.

**Response**:

```json
{
  "status": "ok"
}
```

#### `GET /address`

Get the escrow address to fund.

**Response**:

```json
{
  "address": "ztestsapling1...",
  "type": "shielded"
}
```

or

```json
{
  "address": "tmXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
  "type": "transparent"
}
```

#### `GET /balance`

Get current escrow balance (requires wallet sync).

**Response**:

```json
{
  "balance": "0.001",
  "unverified_balance": "0.000"
}
```

#### `GET /status`

Get current escrow state.

**Response**:

```json
{
  "verified": false,
  "in_transit": false,
  "origin": null,
  "mina_tx_hash": null
}
```

When bound:

```json
{
  "verified": true,
  "in_transit": false,
  "origin": {
    "origin_type": "Shielded",
    "origin_address": "ztestsapling1..."
  },
  "mina_tx_hash": null
}
```

After `/set-in-transit`:

```json
{
  "verified": true,
  "in_transit": true,
  "origin": {
    "origin_type": "Shielded",
    "origin_address": "ztestsapling1..."
  },
  "mina_tx_hash": "5JuGW..."
}
```

### Funding Endpoints

#### `POST /funding/shielded`

Bind shielded funding with on-chain verification.

**Request**:

```json
{
  "api_key": "change_me",
  "memo": "change_me",
  "origin_address": "ztestsapling1..."
}
```

**Flow**:

1. Verifies `api_key` matches `API_KEY`
2. Queries wallet database for received notes with matching memo
3. Verifies amount >= `FUNDING_MIN_ZEC`
4. Binds `origin_address` as refund target
5. Sets `verified=true`

**Success Response** (200):

```json
{
  "message": "Funding verified and origin bound"
}
```

**Errors**:

- `401 Unauthorized`: Invalid `api_key` or memo mismatch
- `402 Payment Required (FundingNotFound)`: No matching note found on-chain with amount >= `FUNDING_MIN_ZEC`
- `409 Conflict (AlreadyBound)`: Origin already bound (single-tenant enforcement)

#### `POST /funding/transparent`

Bind transparent funding with signature and on-chain verification.

**Request**:

```json
{
  "api_key": "change_me",
  "funding_address": "tmXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
  "signed_message": "<base64 signature>"
}
```

**Signed Message Format**:

```
I approve these funds for the Barter Swap. api_key: <API_KEY> escrow_addr: <ESCROW_ADDRESS>
```

**Flow**:

1. Verifies `api_key` matches `API_KEY`
2. Verifies signature against `funding_address`
3. Queries wallet balance at escrow address
4. Verifies balance >= `FUNDING_MIN_ZEC`
5. Binds `funding_address` as origin
6. Sets `verified=true`

**Success Response** (200):

```json
{
  "message": "Funding verified and origin bound"
}
```

**Errors**:

- `401 Unauthorized`: Invalid `api_key` or signature verification failure
- `402 Payment Required (InsufficientFunds)`: Balance below `FUNDING_MIN_ZEC`
- `409 Conflict (AlreadyBound)`: Origin already bound

### Operator Endpoints (Localhost + Bearer Token Required)

#### `POST /set-in-transit`

Mark Mina payment as received and lock escrow for forward sweep.

**Headers**:

```
Authorization: Bearer <OPERATOR_TOKEN>
```

**Request**:

```json
{
  "mina_tx_hash": "5JuGW..."
}
```

**Flow**:

1. Validates operator token and localhost origin
2. Requires `verified=true`
3. Validates Mina transaction via GraphQL:
   - `to == MINA_TO_PUBKEY`
   - `amount >= MINA_MIN_AMOUNT`
   - `canonical == true`
4. Stores `mina_tx_hash` and sets `in_transit=true`

**Success Response** (200):

```json
{
  "message": "In-transit state set",
  "mina_tx_hash": "5JuGW..."
}
```

**Errors**:

- `403 Forbidden`: Missing/invalid operator token or non-localhost request
- `412 Precondition Failed`: Mina tx validation failed or escrow not verified

#### `POST /send-target`

Sweep escrow balance to target address (forward path).

**Headers**:

```
Authorization: Bearer <OPERATOR_TOKEN>
```

**Request**:

```json
{
  "target_address": "ztestsapling1..."
}
```

**Flow**:

1. Validates operator token and localhost origin
2. Requires `verified=true` and `in_transit=true`
3. Creates transaction sending full balance to `target_address`
4. Signs and broadcasts transaction using Zcash SDK
5. Clears `in_transit` and `mina_tx_hash`
6. Schedules graceful shutdown after 60s

**Success Response** (200):

```json
{
  "txid": "abc123..."
}
```

**Errors**:

- `403 Forbidden`: Missing/invalid operator token or non-localhost request
- `412 Precondition Failed (TransitMismatch)`: Called when `in_transit=false`
- `412 Precondition Failed (NotVerified)`: Escrow not verified

### Refund Endpoint

#### `POST /send-back`

Sweep escrow balance back to origin address (refund path).

**Request (Shielded)**:

```json
{
  "api_key": "change_me"
}
```

**Request (Transparent)**:

```json
{
  "api_key": "change_me",
  "signed_message": "<base64 signature>"
}
```

**Flow**:

1. Verifies `api_key` matches `API_KEY`
2. Requires `verified=true` and `in_transit=false`
3. For transparent origin, verifies signed message
4. Creates transaction sending full balance to bound `origin_address`
5. Signs and broadcasts transaction
6. Schedules graceful shutdown after 60s

**Success Response** (200):

```json
{
  "txid": "abc123..."
}
```

**Errors**:

- `401 Unauthorized`: Invalid `api_key` or signature failure (transparent)
- `412 Precondition Failed (TransitMismatch)`: Called when `in_transit=true`
- `412 Precondition Failed (NotVerified)`: Called when `verified=false`
- `412 Precondition Failed (NoOrigin)`: No origin bound

### Admin Endpoint (Localhost Only)

#### `POST /bind-origin`

Manual origin binding without on-chain verification (testing/recovery only).

**Request**:

```json
{
  "api_key": "change_me",
  "origin_address": "ztestsapling1...",
  "origin_type": "Shielded"
}
```

**Flow**:

1. Validates `api_key`
2. Binds `origin_address` with specified type
3. Sets `verified=true` **without on-chain checks**
4. Localhost only (no operator token required)

**Warning**: Use `/funding/*` endpoints for normal flows. This endpoint bypasses security checks.

## Sequence of Events (Common UI Flow)

### 1. Start escrowdv2

```bash
cd zcash/escrowdv2
RUST_LOG=info cargo run
```

Daemon will:

- Initialize wallet database in `DATA_DIR/lightwalletd/`
- Generate escrow address (or recover if database exists)
- Sync with lightwalletd (may take 1-30 minutes first time)
- Start HTTP server on `LISTEN_ADDR`

### 2. Display escrow info to user

```bash
# Get escrow address
curl http://localhost:8080/address

# Show to funder along with api_key
```

### 3. Funder sends funds

**Shielded**:

- Send to escrow address with memo exactly matching `api_key`
- Example using zcash-cli:
  ```bash
  zcash-cli -testnet z_sendmany "ztestsapling1..." \
    '[{"address":"<escrow_address>","amount":0.001,"memo":"'$(echo -n "change_me" | xxd -p)'"}]'
  ```

**Transparent**:

- Send to escrow address (any amount >= `FUNDING_MIN_ZEC`)
- Sign message with funding address:
  ```bash
  zcash-cli -testnet signmessage "tmXXX..." \
    "I approve these funds for the Barter Swap. api_key: change_me escrow_addr: <escrow_addr>"
  ```

### 4. Bind funding (after confirmation)

Wait for transaction to confirm (1-2 blocks), then:

**Shielded**:

```bash
curl -X POST http://localhost:8080/funding/shielded \
  -H "Content-Type: application/json" \
  -d '{
    "api_key": "change_me",
    "memo": "change_me",
    "origin_address": "ztestsapling1..."
  }'
```

**Transparent**:

```bash
curl -X POST http://localhost:8080/funding/transparent \
  -H "Content-Type: application/json" \
  -d '{
    "api_key": "change_me",
    "funding_address": "tmXXX...",
    "signed_message": "<base64 signature>"
  }'
```

Verify binding:

```bash
curl http://localhost:8080/status
# Should show: verified=true, origin=...
```

### 5. Mark in-transit (after Mina payment)

When Mina payment to `MINA_TO_PUBKEY` is confirmed:

```bash
curl -X POST http://localhost:8080/set-in-transit \
  -H "Authorization: Bearer test_operator_token_bf711b725d85f9095bf58b843803f95b" \
  -H "Content-Type: application/json" \
  -d '{
    "mina_tx_hash": "5JuGW..."
  }'
```

Verify:

```bash
curl http://localhost:8080/status
# Should show: in_transit=true, mina_tx_hash="5JuGW..."
```

### 6. Execute

**Refund path** (if in_transit=false):

```bash
# Shielded origin
curl -X POST http://localhost:8080/send-back \
  -H "Content-Type: application/json" \
  -d '{"api_key": "change_me"}'

# Transparent origin (requires signature)
curl -X POST http://localhost:8080/send-back \
  -H "Content-Type: application/json" \
  -d '{
    "api_key": "change_me",
    "signed_message": "<base64 signature>"
  }'
```

**Forward path** (if in_transit=true):

```bash
curl -X POST http://localhost:8080/send-target \
  -H "Authorization: Bearer test_operator_token_bf711b725d85f9095bf58b843803f95b" \
  -H "Content-Type: application/json" \
  -d '{
    "target_address": "ztestsapling1..."
  }'
```

### 7. Teardown

After successful sweep:

- Process exits after 60 seconds
- Wallet database preserved in `DATA_DIR/`
- Start new instance for next trade

## Recovery

### Wallet Database Recovery

**Location**: `DATA_DIR/lightwalletd/wallet.db`

**If database corrupted**:

1. Stop escrowdv2
2. Delete `DATA_DIR/lightwalletd/`
3. Restart escrowdv2
4. New wallet created, but **cannot spend old escrow funds**
5. Backup `wallet.db` regularly!

**If lightwalletd unavailable**:

- escrowdv2 cannot sync or create transactions
- Wait for lightwalletd to come back online
- Existing state preserved in `DATA_DIR/state.json`

### State Recovery

**Location**: `DATA_DIR/state.json`

**Manual state editing** (use with caution):

```bash
# View current state
cat data/state.json | jq '.'

# To reset in_transit flag (if stuck):
jq '.in_transit = false | .mina_tx_hash = null' data/state.json > data/state.json.tmp
mv data/state.json.tmp data/state.json
```

**Backup strategy**:

```bash
# Backup before critical operations
cp -r data/ data.backup.$(date +%s)/

# Restore if needed
rm -rf data/
cp -r data.backup.1733XXXXXX/ data/
```

### Crash Recovery

**After unexpected shutdown**:

1. Restart escrowdv2
2. Wallet database loaded from `DATA_DIR/lightwalletd/`
3. State loaded from `DATA_DIR/state.json`
4. Same escrow address restored
5. Check `/status` to verify state

**If transaction was in-flight**:

- Check wallet transaction history via `/balance` or direct DB query
- Transaction may have been broadcast (check blockchain)
- If not broadcast, retry the operation

### Checking Wallet Transactions

**Using SQLite directly**:

```bash
sqlite3 data/lightwalletd/wallet.db

# List all transactions
SELECT * FROM transactions;

# List sent notes
SELECT * FROM sent_notes;

# List received notes
SELECT * FROM received_notes;
```

## Troubleshooting

### Issue: "wallet migration failed: SeedNotRelevant"

**Cause**: Corrupted wallet database from multiple failed starts.

**Fix**:

```bash
rm -rf data/lightwalletd/
RUST_LOG=info cargo run
```

### Issue: "GetTreeState: z_gettreestate did not return treestate"

**Cause**:

- Zcashd not fully synced
- Zcashd missing `-experimentalfeatures` and `-lightwalletd` flags

**Fix**:

1. Check zcashd sync: `curl --user zcashrpc:pass --data-binary '{"method":"getblockchaininfo"}' http://127.0.0.1:18232/`
2. Verify flags: `docker logs zcashd-testnet | grep -E "experimentalfeatures|lightwalletd"`
3. Wait for zcashd to sync more blocks

### Issue: "Connection refused" to lightwalletd

**Cause**: Lightwalletd not running.

**Fix**:

```bash
# Check lightwalletd status
docker ps | grep lightwalletd

# Start if needed
docker start lightwalletd

# Check logs
docker logs -f lightwalletd
```

### Issue: Wallet not syncing

**Symptoms**: `/balance` shows 0 despite confirmed funding.

**Diagnosis**:

```bash
# Check lightwalletd status
curl http://localhost:9068/status

# Check escrowdv2 logs
# Should see "Syncing blocks..." messages
```

**Fix**:

- Wait for initial sync to complete (can take 10-30 minutes)
- Verify lightwalletd is synced with zcashd
- Check `LIGHTWALLETD_URL` in `.env` is correct

### Issue: "OPERATOR_TOKEN not set"

**Cause**: Missing `OPERATOR_TOKEN` environment variable.

**Fix**:

```bash
# Add to .env
echo 'OPERATOR_TOKEN=test_operator_token_bf711b725d85f9095bf58b843803f95b' >> .env

# Restart
RUST_LOG=info cargo run
```

### Issue: Transaction broadcast fails

**Symptoms**: `/send-target` or `/send-back` returns error.

**Diagnosis**:

```bash
# Check wallet balance
curl http://localhost:8080/balance

# Check wallet sync state
tail -f data/lightwalletd/wallet.db.log
```

**Fix**:

- Ensure wallet fully synced
- Check balance is sufficient (>= `FUNDING_MIN_ZEC`)
- Verify lightwalletd is responsive

## Security Considerations

### Key Storage

- **Wallet database**: `DATA_DIR/lightwalletd/wallet.db` contains spending keys
  - Set permissions: `chmod 600 data/lightwalletd/wallet.db`
  - Backup securely
  - Never commit to git

### Operator Token

- **OPERATOR_TOKEN**: Protects operator endpoints
  - Use cryptographically random tokens (32+ chars)
  - Keep secret from funders
  - Rotate regularly

### API Key

- **API_KEY**: Shared with funder for binding
  - Generate unique per escrow instance
  - Transmit securely (not via unencrypted channels)

### Localhost Enforcement

- Operator endpoints only accept localhost connections
- Deploy firewall rules to restrict external access to `LISTEN_ADDR`

### Data Directory Permissions

```bash
# Recommended permissions
chmod 700 data/
chmod 600 data/state.json
chmod 600 data/lightwalletd/wallet.db
```

## Testing

### Quick Integration Test

```bash
# 1. Start services (zcashd, lightwalletd, escrowdv2)
cd zcash/escrowdv2
RUST_LOG=info cargo run

# 2. Get escrow address
ESCROW_ADDR=$(curl -s http://localhost:8080/address | jq -r '.address')
echo "Escrow address: $ESCROW_ADDR"

# 3. Fund from testnet faucet or existing wallet
# (Wait for confirmation)

# 4. Bind funding
curl -X POST http://localhost:8080/funding/shielded \
  -H "Content-Type: application/json" \
  -d '{
    "api_key": "change_me",
    "memo": "change_me",
    "origin_address": "ztestsapling1..."
  }'

# 5. Check status
curl http://localhost:8080/status | jq '.'

# 6. Test refund
curl -X POST http://localhost:8080/send-back \
  -H "Content-Type: application/json" \
  -d '{"api_key": "change_me"}'
```

### Running Tests

```bash
# Unit tests
cargo test

# Integration tests (requires running services)
cargo test --test integration -- --nocapture
```

### If start fails

```bash
rm -rf data/lightwalletd/ && set -a && source .env && set +a && RUST_LOG=info cargo run
```

## Resources

- **Zcash Rust SDK**: https://github.com/zcash/librustzcash
- **Lightwalletd**: https://github.com/zcash/lightwalletd
- **Zcashd Docker**: `../ZCASH_DOCKER.md`
- **Setup Guide**: `../SETUP.md`
- **Project Overview**: `../../PROJECT.md`

---

**Last Updated**: 2025-12-02
**escrowdv2 Version**: 0.2.0 (with self-signing capability)
**Network**: Testnet
