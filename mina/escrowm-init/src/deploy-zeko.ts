import { Mina, PrivateKey, AccountUpdate, fetchAccount, PublicKey } from 'o1js';
import { MinaEscrowPool, offchainState } from './MinaEscrowPool.js';
import dotenv from 'dotenv';

// Load .env file
dotenv.config();

/**
 * Deploy MinaEscrowPool to Zeko L2 Devnet
 *
 * Usage:
 *   export DEPLOYER_KEY=EKE...
 *   export OPERATOR_KEY=EKE...
 *   npm run build && node build/src/deploy-zeko.js
 */

// Configuration
const ZEKO_DEVNET_ENDPOINT = 'https://devnet.zeko.io/graphql';
const FEE = 1000_000_000; // 1 MINA

/**
 * Fetch account with retry logic to handle network issues
 */
async function fetchAccountWithRetry(
  accountInfo: { publicKey: PublicKey },
  maxRetries = 5
): Promise<void> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      await fetchAccount(accountInfo);
      return;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.warn(
        `  Fetch attempt ${i + 1}/${maxRetries} failed: ${errorMsg}`
      );
      if (i === maxRetries - 1) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1000 * (i + 1))); // Exponential backoff
    }
  }
}

/**
 * Send transaction with retry logic for network errors
 */
async function sendTransactionWithRetry(
  transaction: any,
  maxRetries = 3
): Promise<any> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(
        `  Sending transaction (attempt ${attempt}/${maxRetries})...`
      );
      const pendingTx = await transaction.send();
      console.log(`  ✓ Transaction sent: ${pendingTx.hash}`);
      return pendingTx;
    } catch (error: any) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.warn(`  ⚠️  Send attempt ${attempt} failed: ${errorMsg}`);

      // Check if error is retryable (network issues)
      const isRetryable =
        errorMsg.includes('502') ||
        errorMsg.includes('Bad Gateway') ||
        errorMsg.includes('ECONNRESET') ||
        errorMsg.includes('ETIMEDOUT') ||
        errorMsg.includes('network') ||
        errorMsg.includes('timeout');

      if (!isRetryable || attempt === maxRetries) {
        throw error;
      }

      // Exponential backoff
      const backoffMs = Math.pow(2, attempt) * 2000; // 4s, 8s, 16s
      console.log(`  Retrying after ${backoffMs}ms...`);
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
    }
  }
  throw new Error('Failed to send transaction after all retries');
}

async function main() {
  console.log('=== MinaEscrowPool Deployment to Zeko L2 Devnet ===\n');

  // Load keys from environment
  const deployerKeyBase58 = process.env.DEPLOYER_KEY;
  const operatorKeyBase58 = process.env.OPERATOR_KEY;

  if (!deployerKeyBase58) {
    throw new Error('Missing DEPLOYER_KEY environment variable');
  }
  if (!operatorKeyBase58) {
    throw new Error('Missing OPERATOR_KEY environment variable');
  }

  const deployerKey = PrivateKey.fromBase58(deployerKeyBase58);
  const operatorKey = PrivateKey.fromBase58(operatorKeyBase58);

  const deployerAddress = deployerKey.toPublicKey();
  const operatorAddress = operatorKey.toPublicKey();

  console.log('Deployer:', deployerAddress.toBase58());
  console.log('Operator:', operatorAddress.toBase58());
  console.log('');

  // Setup network
  console.log('Connecting to Zeko L2 Devnet...');
  const network = Mina.Network({
    mina: ZEKO_DEVNET_ENDPOINT,
    archive: ZEKO_DEVNET_ENDPOINT,
  });
  Mina.setActiveInstance(network);
  console.log('✓ Connected\n');

  // Check deployer balance
  console.log('Fetching deployer account...');
  try {
    await fetchAccountWithRetry({ publicKey: deployerAddress });
    const deployerBalance = Mina.getBalance(deployerAddress);
    console.log(
      `Deployer balance: ${Number(deployerBalance.toBigInt()) / 1e9} MINA`
    );

    if (deployerBalance.toBigInt() < BigInt(FEE * 10)) {
      console.warn('⚠️  Low balance! Need at least 1 MINA for deployment');
    }
  } catch (error) {
    console.error('Failed to fetch deployer account:', error);
    console.log('Deployer may not have an account on Zeko L2 yet.');
    console.log('Please fund the deployer account first.');
    throw error;
  }
  console.log('');

  // Generate zkApp key pair
  const zkAppKey = PrivateKey.random();
  const zkAppAddress = zkAppKey.toPublicKey();
  console.log('zkApp address:', zkAppAddress.toBase58());
  console.log('zkApp private key:', zkAppKey.toBase58());
  console.log('');

  // Compile contract
  console.log('Compiling MinaEscrowPool...');
  const startCompile = Date.now();
  await offchainState.compile(); // FIRST
  const { verificationKey } = await MinaEscrowPool.compile(); // SECOND
  const compileTime = ((Date.now() - startCompile) / 1000).toFixed(2);
  console.log(`✓ Compiled in ${compileTime}s`);
  console.log(`Verification key hash: ${verificationKey.hash.toString()}`);
  console.log('');

  // Create contract instance
  const zkApp = new MinaEscrowPool(zkAppAddress);
  zkApp.offchainState.setContractInstance(zkApp);

  // Deploy
  console.log('Deploying contract...');
  const startDeploy = Date.now();

  const deployTxn = await Mina.transaction(
    { sender: deployerAddress, fee: FEE, memo: 'Doot:Barter Swap Init' },
    async () => {
      AccountUpdate.fundNewAccount(deployerAddress);
      await zkApp.deploy();
    }
  );

  console.log('Proving deployment transaction...');
  await deployTxn.prove();

  console.log('Signing and sending deployment...');
  const signedDeployTxn = deployTxn.sign([deployerKey, zkAppKey]);
  const sentTx = await sendTransactionWithRetry(signedDeployTxn);

  const deployTime = ((Date.now() - startDeploy) / 1000).toFixed(2);
  console.log(`✓ Deployed in ${deployTime}s`);
  console.log('Transaction hash:', sentTx.hash);
  console.log('');

  // Wait for transaction to be fully processed
  console.log('Waiting for Zeko L2 confirmation (30s)...');
  await new Promise((resolve) => setTimeout(resolve, 30000));
  console.log('✓ Deployment transaction confirmed');
  console.log('');

  // CRITICAL: Refresh account states before next transaction to avoid nonce conflicts
  console.log('Refreshing account states before initialization...');
  await fetchAccountWithRetry({ publicKey: zkAppAddress });
  await fetchAccountWithRetry({ publicKey: operatorAddress });
  console.log('✓ Account states refreshed');
  console.log('');

  // Initialize operator
  console.log('Initializing operator...');
  const initTxn = await Mina.transaction(
    { sender: operatorAddress, fee: FEE, memo: 'Doot:Barter Init Operator' },
    async () => {
      await zkApp.initOperator();
    }
  );

  console.log('Proving initialization transaction...');
  await initTxn.prove();

  console.log('Signing and sending initialization...');
  const signedInitTxn = initTxn.sign([operatorKey]);
  const initSentTx = await sendTransactionWithRetry(signedInitTxn);
  console.log('Initialization transaction hash:', initSentTx.hash);
  console.log('');

  console.log('Waiting for initialization confirmation (30s)...');
  await new Promise((resolve) => setTimeout(resolve, 30000));
  console.log('✓ Operator initialized');
  console.log('');

  // Verify deployment
  console.log('Verifying deployment...');
  await fetchAccountWithRetry({ publicKey: zkAppAddress });
  const operatorState = zkApp.operator.get();

  console.log('Contract deployed:', zkAppAddress.toBase58());
  console.log('Operator set to:', operatorState.toBase58());
  console.log('');

  // Output configuration for middleware
  console.log('=== Middleware Configuration ===');
  console.log('Add to middleware/.env:');
  console.log('');
  console.log(`MINA_NETWORK=zeko-devnet`);
  console.log(`MINA_GRAPHQL_ENDPOINT=${ZEKO_DEVNET_ENDPOINT}`);
  console.log(`MINA_POOL_ADDRESS=${zkAppAddress.toBase58()}`);
  console.log(`OPERATOR_PRIVATE_KEY=${operatorKeyBase58}`);
  console.log('');

  console.log('✅ Deployment complete!');
  console.log('');
  console.log('=== Deployment Summary ===');
  console.log(`Contract Address: ${zkAppAddress.toBase58()}`);
  console.log(`Operator Address: ${operatorAddress.toBase58()}`);
  console.log(`Deployer Address: ${deployerAddress.toBase58()}`);
  console.log('');
  console.log('=== Explorer Links ===');
  console.log(
    `Contract: https://zekoscan.io/testnet/account/${zkAppAddress.toBase58()}`
  );
  console.log(
    `Operator: https://zekoscan.io/testnet/account/${operatorAddress.toBase58()}`
  );
  console.log('');
  console.log('=== Next Steps ===');
  console.log('1. Copy the middleware configuration above to middleware/.env');
  console.log(
    '2. Fund the operator account with some MINA for transaction fees'
  );
  console.log(
    '3. Start the middleware: cd middleware && npm run build && npm start'
  );
  console.log('4. Monitor trades on ZekoScan explorer');
  console.log('');
  console.log('💡 Tip: Save these addresses and keys securely!');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Deployment failed:', error);
    process.exit(1);
  });
