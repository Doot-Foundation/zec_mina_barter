# MinaEscrowPool Deployment Guide - Zeko L2 Devnet

Complete guide for deploying the MinaEscrowPool contract to Zeko L2 Devnet.

---

## Prerequisites

1. **Node.js** >= 18.14.0
2. **MINA tokens** on Zeko L2 Devnet
3. **Two accounts**:
   - Deployer account (pays deployment fees)
   - Operator account (middleware coordinator)

---

## Step 1: Generate Keys

### Option A: Using o1js

```typescript
import { PrivateKey } from 'o1js';

const deployerKey = PrivateKey.random();
const operatorKey = PrivateKey.random();

console.log('Deployer Private Key:', deployerKey.toBase58());
console.log('Deployer Address:', deployerKey.toPublicKey().toBase58());
console.log('');
console.log('Operator Private Key:', operatorKey.toBase58());
console.log('Operator Address:', operatorKey.toPublicKey().toBase58());
```

### Option B: Use the Helper Script

```bash
cd escrowm
npm run build
node build/scripts/generate-keys.js
```

**Save these keys securely!** You'll need them for deployment and middleware operation.

---

## Step 2: Fund Accounts

### Get Zeko L2 Devnet MINA

You need to fund both accounts with MINA on Zeko L2 Devnet:

- **Deployer**: Minimum 1 MINA (for deployment fees)
- **Operator**: Minimum 5 MINA (for ongoing operations)

**Funding Options:**

1. **Bridge from Mina Devnet** (if you have Mina Devnet MINA):
   - Use Zeko bridge: https://bridge.zeko.io
   - Bridge MINA from Mina Devnet to Zeko L2

2. **Faucet** (if available):
   - Check Zeko Discord for devnet faucet
   - Request MINA for both addresses

3. **Transfer from existing Zeko account**:
   ```bash
   # Using zeko-cli or auro wallet
   ```

### Verify Balances

```bash
# Check deployer balance
curl -X POST https://devnet.zeko.io/graphql \
  -H "Content-Type: application/json" \
  -d '{
    "query": "query { account(publicKey: \"YOUR_DEPLOYER_ADDRESS\") { balance { total } } }"
  }'

# Check operator balance
curl -X POST https://devnet.zeko.io/graphql \
  -H "Content-Type: application/json" \
  -d '{
    "query": "query { account(publicKey: \"YOUR_OPERATOR_ADDRESS\") { balance { total } } }"
  }'
```

---

## Step 3: Set Environment Variables

Create a `.env` file in the `escrowm` directory:

```bash
cd escrowm
cat > .env << 'EOL'
DEPLOYER_KEY=EKE... # Your deployer private key
OPERATOR_KEY=EKE... # Your operator private key
EOL
```

**⚠️ SECURITY WARNING:**
- Never commit `.env` to git
- Keep private keys secure
- Use separate keys for mainnet

---

## Step 4: Install Dependencies

```bash
npm install
```

---

## Step 5: Build the Project

```bash
npm run build
```

This compiles the TypeScript code and prepares for deployment.

---

## Step 6: Deploy to Zeko L2

```bash
npm run deploy:zeko
```

**Expected Output:**

```
=== MinaEscrowPool Deployment to Zeko L2 Devnet ===

Deployer: B62q...
Operator: B62q...

Connecting to Zeko L2 Devnet...
✓ Connected

Fetching deployer account...
Deployer balance: 10.5 MINA

zkApp address: B62qm...

Compiling MinaEscrowPool...
✓ Compiled in 45.23s
Verification key hash: 12345...

Deploying contract...
Proving deployment transaction...
Signing and sending...
✓ Deployed in 2.15s
Transaction hash: CkpZ...

Waiting for transaction confirmation...
✓ Transaction confirmed

Initializing operator...
Transaction hash: CkpY...
✓ Operator initialized

Verifying deployment...
Contract deployed: B62qm...
Operator set to: B62qo...

=== Middleware Configuration ===
Add to middleware/.env:

MINA_NETWORK=zeko-devnet
MINA_GRAPHQL_ENDPOINT=https://devnet.zeko.io/graphql
MINA_POOL_ADDRESS=B62qm...
OPERATOR_PRIVATE_KEY=EKE...

✅ Deployment complete!

=== Deployment Summary ===
Contract Address: B62qm...
Operator Address: B62qo...
Deployer Address: B62qp...

=== Explorer Links ===
Contract: https://zekoscan.io/testnet/account/B62qm...
Operator: https://zekoscan.io/testnet/account/B62qo...

=== Next Steps ===
1. Copy the middleware configuration above to middleware/.env
2. Fund the operator account with some MINA for transaction fees
3. Start the middleware: cd middleware && npm run build && npm start
4. Monitor trades on ZekoScan explorer

💡 Tip: Save these addresses and keys securely!
```

---

## Step 7: Verify Deployment

### Check Contract on ZekoScan

Visit: `https://zekoscan.io/testnet/account/YOUR_CONTRACT_ADDRESS`

**Verify:**
- ✅ Account exists
- ✅ Verification key matches
- ✅ Permissions set correctly
- ✅ Operator state initialized

### Query Contract Directly

```bash
# Get operator
curl -X POST https://devnet.zeko.io/graphql \
  -H "Content-Type: application/json" \
  -d '{
    "query": "query { account(publicKey: \"YOUR_CONTRACT_ADDRESS\") { zkappState } }"
  }'
```

---

## Step 8: Configure Middleware

Copy the deployment output configuration to `middleware/.env`:

```bash
cd ../middleware
cat >> .env << 'EOL'
# MinaEscrowPool Configuration (from deployment)
MINA_NETWORK=zeko-devnet
MINA_GRAPHQL_ENDPOINT=https://devnet.zeko.io/graphql
MINA_POOL_ADDRESS=B62qm... # Your deployed contract address
OPERATOR_PRIVATE_KEY=EKE... # Your operator private key
EOL
```

---

## Step 9: Start Middleware

```bash
cd middleware
npm install
npm run build
npm start
```

The middleware will:
1. Connect to Zeko L2
2. Compile contracts
3. Start API server on http://127.0.0.1:3000
4. Begin polling for trades every 15s
5. Start settlement worker

---

## Troubleshooting

### Deployment Fails: "Account not found"

**Cause**: Deployer account not funded on Zeko L2

**Solution**:
1. Verify deployer address
2. Fund account with at least 1 MINA
3. Wait 1-2 minutes for transaction confirmation
4. Retry deployment

### Compilation Takes Too Long

**Cause**: Contract compilation is compute-intensive

**Expected Time**: 30-60 seconds (first time)

**Solution**: Be patient, this is normal for zkApps

### Transaction Fails: "Insufficient balance"

**Cause**: Not enough MINA for fees

**Solution**:
1. Check deployer balance
2. Fund with at least 1 MINA
3. Retry deployment

### Operator Initialization Fails

**Cause**: Multiple possible issues

**Solutions**:
1. Verify operator key is correct
2. Check operator account has balance
3. Ensure contract deployed successfully
4. Check GraphQL endpoint is responsive

---

## Network Configuration

### Zeko L2 Devnet

- **GraphQL Endpoint**: https://devnet.zeko.io/graphql
- **Archive Endpoint**: https://devnet.zeko.io/graphql (same)
- **Explorer**: https://zekoscan.io/testnet
- **Block Time**: ~10-25 seconds
- **Finality**: Fast (compared to Mina L1)

### Fee Recommendations

- **Deployment**: 0.1 MINA (sufficient)
- **Lock Trade**: 0.1 MINA
- **Claim**: 0.1 MINA
- **Refund**: 0.1 MINA
- **Settlement**: 0.1 MINA

**Buffer**: Always keep operator account funded with 5+ MINA for ongoing operations.

---

## Post-Deployment Checklist

- [ ] Contract deployed successfully
- [ ] Operator initialized
- [ ] Contract address verified on ZekoScan
- [ ] Middleware configured with contract address
- [ ] Operator account funded (5+ MINA)
- [ ] Middleware running and connected
- [ ] API server accessible (http://127.0.0.1:3000/health)
- [ ] Settlement worker active
- [ ] Private keys backed up securely

---

## Maintenance

### Monitoring

**Check Contract Balance:**
```bash
curl -X POST https://devnet.zeko.io/graphql \
  -H "Content-Type: application/json" \
  -d '{
    "query": "query { account(publicKey: \"CONTRACT_ADDRESS\") { balance { total } } }"
  }'
```

**Check Operator Balance:**
```bash
curl -X POST https://devnet.zeko.io/graphql \
  -H "Content-Type: application/json" \
  -d '{
    "query": "query { account(publicKey: \"OPERATOR_ADDRESS\") { balance { total } } }"
  }'
```

**Monitor Trades:**
- Use middleware logs
- Check ZekoScan explorer
- Query OffchainState via middleware API

### Refunding Operator

If operator runs low on MINA, transfer more from deployer or another account.

---

## Security Best Practices

1. **Private Key Security**:
   - Store in secure key management system
   - Never commit to git
   - Use environment variables
   - Consider hardware wallet integration (future)

2. **Operator Account**:
   - Dedicated account for middleware only
   - Monitor balance regularly
   - Set up alerts for low balance

3. **Contract Permissions**:
   - Verify permissions are locked (`setPermissions: impossible`)
   - Cannot be upgraded after deployment
   - Operator cannot be changed

4. **Monitoring**:
   - Log all operations
   - Monitor for anomalies
   - Set up alerts for failures

---

## Upgrading

**⚠️ Note**: Contract permissions are set to `impossible` for `setPermissions`, meaning the contract **cannot be upgraded** after deployment.

**To deploy a new version:**
1. Deploy new contract with different address
2. Update middleware configuration
3. Migrate liquidity (if needed)
4. Deprecate old contract

---

## Support

- **Zeko Discord**: https://discord.gg/zeko
- **Mina Discord**: https://discord.gg/minaprotocol
- **GitHub Issues**: (your repo)
- **Documentation**: ../middleware/README.md

---

## Appendix: Manual Deployment Steps

If you prefer manual deployment or need to debug, here are the steps:

### 1. Connect to Network

```typescript
import { Mina } from 'o1js';

const network = Mina.Network({
  mina: 'https://devnet.zeko.io/graphql',
  archive: 'https://devnet.zeko.io/graphql',
});
Mina.setActiveInstance(network);
```

### 2. Compile Contract

```typescript
import { MinaEscrowPool, offchainState } from './MinaEscrowPool.js';

await MinaEscrowPool.compile();
await offchainState.compile();
```

### 3. Deploy Transaction

```typescript
const zkAppKey = PrivateKey.random();
const zkApp = new MinaEscrowPool(zkAppKey.toPublicKey());

const deployTxn = await Mina.transaction(
  { sender: deployerAddress, fee: 100_000_000 },
  async () => {
    AccountUpdate.fundNewAccount(deployerAddress);
    await zkApp.deploy();
  }
);

await deployTxn.prove();
await deployTxn.sign([deployerKey, zkAppKey]).send();
```

### 4. Initialize Operator

```typescript
const initTxn = await Mina.transaction(
  { sender: operatorAddress, fee: 100_000_000 },
  async () => {
    await zkApp.initOperator();
  }
);

await initTxn.prove();
await initTxn.sign([operatorKey]).send();
```

---

## License

MIT
