import { Mina, PrivateKey, AccountUpdate, fetchAccount } from 'o1js';
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
const FEE = 400_000_000; // 0.4 MINA

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
    await fetchAccount({ publicKey: deployerAddress });
    const deployerBalance = Mina.getBalance(deployerAddress);
    console.log(`Deployer balance: ${Number(deployerBalance.toBigInt()) / 1e9} MINA`);

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
  await offchainState.compile();  // FIRST
  const { verificationKey } = await MinaEscrowPool.compile();  // SECOND
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

  console.log('Signing and sending...');
  const sentTx = await deployTxn.sign([deployerKey, zkAppKey]).send();

  const deployTime = ((Date.now() - startDeploy) / 1000).toFixed(2);
  console.log(`✓ Deployed in ${deployTime}s`);
  console.log('Transaction hash:', sentTx.hash);
  console.log('');

  // Wait for transaction
  console.log('Waiting for Zeko L2 confirmation (20s)...');
  await new Promise(resolve => setTimeout(resolve, 20000));
  console.log('✓ Transaction confirmed');
  console.log('');

  // Initialize operator
  console.log('Initializing operator...');
  const initTxn = await Mina.transaction(
    { sender: operatorAddress, fee: FEE },
    async () => {
      await zkApp.initOperator();
    }
  );

  await initTxn.prove();
  const initSentTx = await initTxn.sign([operatorKey]).send();
  console.log('Transaction hash:', initSentTx.hash);

  await new Promise(resolve => setTimeout(resolve, 20000));
  console.log('✓ Operator initialized');
  console.log('');

  // Verify deployment
  console.log('Verifying deployment...');
  await fetchAccount({ publicKey: zkAppAddress });
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
  console.log(`Contract: https://zekoscan.io/testnet/account/${zkAppAddress.toBase58()}`);
  console.log(`Operator: https://zekoscan.io/testnet/account/${operatorAddress.toBase58()}`);
  console.log('');
  console.log('=== Next Steps ===');
  console.log('1. Copy the middleware configuration above to middleware/.env');
  console.log('2. Fund the operator account with some MINA for transaction fees');
  console.log('3. Start the middleware: cd middleware && npm run build && npm start');
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
