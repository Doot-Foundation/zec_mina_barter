import { Mina, PrivateKey, AccountUpdate } from 'o1js';
import { MinaEscrowPool, offchainState } from './MinaEscrowPool.js';

/**
 * Deploy MinaEscrowPool to local blockchain for testing
 *
 * Usage:
 *   npm run build && node build/src/deploy-local.js
 */

async function main() {
  console.log('=== MinaEscrowPool Local Deployment ===\n');

  // Setup local blockchain
  console.log('Setting up local blockchain...');
  const Local = await Mina.LocalBlockchain({ proofsEnabled: true });
  Mina.setActiveInstance(Local);

  // Get test accounts
  const [deployer, operator] = Local.testAccounts;
  console.log('Deployer:', deployer.toBase58());
  console.log('Operator:', operator.toBase58());
  console.log('');

  // Generate zkApp key
  const zkAppKey = PrivateKey.random();
  const zkAppAddress = zkAppKey.toPublicKey();
  console.log('zkApp address:', zkAppAddress.toBase58());
  console.log('');

  // Compile
  console.log('Compiling MinaEscrowPool...');
  const startCompile = Date.now();
  await MinaEscrowPool.compile();
  await offchainState.compile();
  const compileTime = ((Date.now() - startCompile) / 1000).toFixed(2);
  console.log(`✓ Compiled in ${compileTime}s\n`);

  // Create instance
  const zkApp = new MinaEscrowPool(zkAppAddress);

  // Deploy
  console.log('Deploying...');
  const deployTxn = await Mina.transaction(deployer, async () => {
    AccountUpdate.fundNewAccount(deployer);
    await zkApp.deploy();
  });
  await deployTxn.prove();
  await deployTxn.sign([deployer.key, zkAppKey]).send();
  console.log('✓ Deployed\n');

  // Initialize operator
  console.log('Initializing operator...');
  const initTxn = await Mina.transaction(operator, async () => {
    await zkApp.initOperator();
  });
  await initTxn.prove();
  await initTxn.sign([operator.key]).send();
  console.log('✓ Operator initialized\n');

  // Verify
  const operatorState = zkApp.operator.get();
  console.log('Contract:', zkAppAddress.toBase58());
  console.log('Operator:', operatorState.toBase58());
  console.log('');

  console.log('✅ Local deployment complete!');
  console.log('');
  console.log('You can now run tests against this local instance.');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Deployment failed:', error);
    process.exit(1);
  });
