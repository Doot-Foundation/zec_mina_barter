# Setup Guide - MINA ↔ ZEC Barter Protocol

Complete guide for setting up and running all components of the atomic swap system.

---

## Quick Start (3 Steps)

### Prerequisites Running
✅ **Zcashd**: Already running as Docker container `zcashd-testnet` on port 18232

### Step 1: Start Lightwalletd

```bash
cd /home/botvenom/Desktop/work/web3/mina/projects/professional/Doot/protocol/apps_on_doot/zec_barter/zcash/lightwalletd

# Create data directory
mkdir -p data

# Start lightwalletd (Docker)
docker run -d \
  --name lightwalletd \
  --network host \
  -v /var/lib/docker/volumes/zcash-testnet-data/_data:/zcashd:ro \
  -v $(pwd)/data:/data \
  electriccoinco/lightwalletd:latest \
  --grpc-bind-addr 0.0.0.0:9067 \
  --http-bind-addr 0.0.0.0:9068 \
  --zcash-conf-path /zcashd/zcash.conf \
  --data-dir /data \
  --log-file /data/lightwalletd.log \
  --no-tls-very-insecure

# Check logs
docker logs -f lightwalletd

# Test it works
curl http://localhost:9068/status
```

### Step 2: Download Sapling Parameters (~53MB, one-time)

```bash
mkdir -p ~/.zcash-params
cd ~/.zcash-params

wget -c https://download.z.cash/downloads/sapling-spend.params
wget -c https://download.z.cash/downloads/sapling-output.params

ls -lh  # Should show two .params files
```

### Step 3: Run escrowdv2

```bash
cd /home/botvenom/Desktop/work/web3/mina/projects/professional/Doot/protocol/apps_on_doot/zec_barter/zcash/escrowdv2

# Create .env if it doesn't exist
cat > .env << 'EOF'
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
EOF

# Run with logs
RUST_LOG=info cargo run
```

---

## Component-Specific Setup

### 1. Zcashd (Already Running)

Your zcashd is running via Docker with these settings:

```
Network: testnet
RPC Port: 18232
RPC User: zcashrpc
RPC Password: your_secure_password_here_change_me
Container: zcashd-testnet
Data: /var/lib/docker/volumes/zcash-testnet-data/_data
```

**Test RPC Connection**:
```bash
curl --user zcashrpc:your_secure_password_here_change_me \
     --data-binary '{"jsonrpc":"1.0","id":"test","method":"getblockchaininfo","params":[]}' \
     http://127.0.0.1:18232/
```

### 2. Lightwalletd (gRPC Bridge)

Lightwalletd acts as a gRPC bridge between escrowdv2 and zcashd.

**Check Status**:
```bash
docker ps | grep lightwalletd
docker logs -f lightwalletd
curl http://localhost:9068/status
```

**Stop/Restart**:
```bash
docker stop lightwalletd && docker rm lightwalletd
# Then run the docker run command from Step 1
```

### 3. Escrowdv2 (Zcash Escrow Daemon)

**Build**:
```bash
cd zcash/escrowdv2
cargo build --release
```

**Test**:
```bash
cargo test  # Run unit tests
```

**Run**:
```bash
RUST_LOG=info cargo run  # Development
./target/release/escrowdv2  # Production binary
```

**API Endpoints**:
```bash
# Health check
curl http://localhost:8080/health

# Get escrow address
curl http://localhost:8080/address

# Check balance
curl http://localhost:8080/balance

# Check status
curl http://localhost:8080/status
```

### 4. MinaEscrowPool (MINA zkApp)

**Setup**:
```bash
cd escrowm
npm install
```

**Generate Keys**:
```bash
export DEPLOYER_KEY=$(node -e "console.log(require('o1js').PrivateKey.random().toBase58())")
export OPERATOR_KEY=$(node -e "console.log(require('o1js').PrivateKey.random().toBase58())")
```

**Get Testnet Funds**:
- Visit Zeko L2 faucet (get MINA for deployment fees)
- Fund the deployer address

**Deploy to Zeko L2**:
```bash
npm run build
npm run deploy:zeko
# Save the output contract address
```

**Test**:
```bash
npm test
npm run testw  # Watch mode
```

### 5. Middleware (Coordinator)

**Setup**:
```bash
cd middleware
npm install
```

**Configure**:
```bash
cp .env.example .env
# Edit .env with:
# - OPERATOR_PRIVATE_KEY (from deployment)
# - MINA_POOL_ADDRESS (deployed contract address)
# - SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
# - ESCROWD_* settings
```

**Environment Variables**:
```bash
# Operator
OPERATOR_PRIVATE_KEY=EKE...

# Mina network
MINA_NETWORK=zeko-devnet
MINA_GRAPHQL_ENDPOINT=https://devnet.zeko.io/graphql
MINA_POOL_ADDRESS=B62q...  # From deploy output

# Escrowd instances
ESCROWD_BASE_URL=http://127.0.0.1
ESCROWD_BASE_PORT=8000
ESCROWD_PORT_RANGE=10000
ESCROWD_OPERATOR_TOKEN=your-secure-token

# Polling
POLL_INTERVAL_MS=15000

# Supabase (keypairs table with Mina_PublicKey, Zcash_PublicKey columns)
SUPABASE_URL=https://<project>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=...
```

**Run**:
```bash
npm run build
npm start      # Production
npm run dev    # Development
```

---

## Port Reference

| Service | Port | Protocol | Purpose |
|---------|------|----------|---------|
| zcashd RPC | 18232 | HTTP/JSON-RPC | Blockchain queries |
| zcashd P2P | 18233 | TCP | Testnet peers |
| lightwalletd gRPC | 9067 | gRPC | Wallet sync |
| lightwalletd HTTP | 9068 | HTTP | Status checks |
| escrowdv2 API | 8080 | HTTP | Escrow service |
| escrowd instances | 8000+ | HTTP | Per-trade escrows |

---

## Status Checks

```bash
# Check all services
docker ps | grep -E "zcashd|lightwalletd"

# Test endpoints
curl http://localhost:18232/  # zcashd (will show error - that's ok)
curl http://localhost:9068/status  # lightwalletd
curl http://localhost:8080/health  # escrowdv2

# Check zcashd blockchain info
curl --user zcashrpc:your_secure_password_here_change_me \
     --data-binary '{"jsonrpc":"1.0","id":"test","method":"getblockchaininfo","params":[]}' \
     http://127.0.0.1:18232/ | jq
```

---

## Troubleshooting

### Issue: "Connection refused" to lightwalletd

```bash
# Check if running
docker ps | grep lightwalletd

# Check logs
docker logs lightwalletd

# Restart
docker stop lightwalletd && docker rm lightwalletd
# Then run docker run command from Step 1
```

### Issue: "Failed to load Sapling parameters"

```bash
# Verify files exist
ls -lh ~/.zcash-params/sapling-*.params

# Re-download if missing
cd ~/.zcash-params
wget https://download.z.cash/downloads/sapling-spend.params
wget https://download.z.cash/downloads/sapling-output.params
```

### Issue: "RPC authentication failed"

```bash
# Check zcashd credentials
docker exec zcashd-testnet cat /root/.zcash/zcash.conf | grep rpcuser
docker exec zcashd-testnet cat /root/.zcash/zcash.conf | grep rpcpassword

# Update .env file with correct credentials
```

### Issue: escrowdv2 won't start

```bash
# Check environment variables
cat zcash/escrowdv2/.env

# Check if ports are available
lsof -i :8080

# Check Rust/Cargo installation
cargo --version

# Rebuild
cd zcash/escrowdv2
cargo clean
cargo build --release
```

### Issue: Lightwalletd sync taking forever

```bash
# Check sync progress
curl http://localhost:9068/status | jq

# Lightwalletd needs to sync compact blocks from zcashd
# Can take 10-30 minutes on first run depending on birth height
```

---

## Complete Startup Sequence

```bash
# 1. Zcashd (Already Running ✅)
docker ps | grep zcashd-testnet

# 2. Start Lightwalletd
cd zcash/lightwalletd
docker run -d --name lightwalletd --network host \
  -v /var/lib/docker/volumes/zcash-testnet-data/_data:/zcashd:ro \
  -v $(pwd)/data:/data \
  electriccoinco/lightwalletd:latest \
  --grpc-bind-addr 0.0.0.0:9067 \
  --http-bind-addr 0.0.0.0:9068 \
  --zcash-conf-path /zcashd/zcash.conf \
  --data-dir /data \
  --log-file /data/lightwalletd.log \
  --no-tls-very-insecure

# Wait for sync (30-60 seconds)
sleep 60
curl http://localhost:9068/status

# 3. Start escrowdv2
cd zcash/escrowdv2
RUST_LOG=info cargo run --release

# 4. Start middleware (in separate terminal)
cd middleware
npm start
```

---

## Stop Services

```bash
# Stop escrowdv2: Press CTRL+C in terminal

# Stop middleware: Press CTRL+C in terminal

# Stop lightwalletd
docker stop lightwalletd && docker rm lightwalletd

# Stop zcashd (if needed)
docker stop zcashd-testnet && docker rm zcashd-testnet
```

---

## Development Workflow

### Making Changes to escrowdv2

```bash
cd zcash/escrowdv2

# Run tests
cargo test

# Check code
cargo clippy

# Format code
cargo fmt

# Run with debug logs
RUST_LOG=debug cargo run
```

### Making Changes to MinaEscrowPool

```bash
cd escrowm

# Run tests
npm test

# Watch mode
npm run testw

# Rebuild
npm run build

# Redeploy (local)
npm run deploy:local
```

### Making Changes to Middleware

```bash
cd middleware

# Watch mode (auto-rebuild)
npm run watch

# Type check
npx tsc --noEmit

# Lint
npx eslint src/
```

---

## Testing the Full System

See `TESTING.md` for comprehensive testing documentation.

**Quick Integration Test**:

1. Deploy MinaEscrowPool to Zeko L2
2. Start all services (zcashd, lightwalletd, escrowdv2, middleware)
3. Execute a test trade flow (see PROJECT.md for trade flow details)
4. Verify both MINA and ZEC transfers complete

---

## Production Deployment Checklist

- [ ] Zcashd running on mainnet (not testnet)
- [ ] Lightwalletd synced to latest block
- [ ] escrowdv2 built with `--release` flag
- [ ] MinaEscrowPool deployed to Mina L1 (not Zeko devnet)
- [ ] Middleware configured with production credentials
- [ ] All API keys and passwords secured (use secrets manager)
- [ ] Firewall configured (only localhost for escrowd)
- [ ] Monitoring and alerting configured
- [ ] Backup procedures established
- [ ] Emergency recovery procedures documented

---

## Security Considerations

1. **Operator Keys**: Keep private keys secure (hardware wallet recommended)
2. **Escrowd Isolation**: Run each escrowd instance under separate user
3. **Firewall**: Escrowd should only accept localhost connections
4. **RPC Credentials**: Use strong passwords for zcashd RPC
5. **Operator Token**: Use cryptographically random tokens
6. **Data Directory**: Secure permissions (0700 for escrowd data dirs)
7. **Logs**: Ensure logs don't leak private keys or sensitive data

---

## Resources

- **Zcash Docs**: https://zcash.readthedocs.io/
- **Mina Docs**: https://docs.minaprotocol.com/
- **o1js Docs**: https://docs.minaprotocol.com/zkapps/o1js
- **Zeko L2**: https://zeko.io/
- **Lightwalletd**: https://github.com/zcash/lightwalletd

---

**Need Help?**
- Check PROJECT.md for architecture and trade flow details
- Check TESTING.md for comprehensive testing guide
- Review error logs in each service
- Verify all environment variables are set correctly
