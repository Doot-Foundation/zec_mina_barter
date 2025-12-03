import { PrivateKey } from 'o1js';

/**
 * Generate deployer and operator key pairs for MinaEscrowPool deployment
 *
 * Usage:
 *   npm run keys:generate
 */

console.log('=== MinaEscrowPool Key Generation ===\n');

// Generate deployer key pair
const deployerKey = PrivateKey.random();
const deployerAddress = deployerKey.toPublicKey();

console.log('=== Deployer Account ===');
console.log('Private Key:', deployerKey.toBase58());
console.log('Address:', deployerAddress.toBase58());
console.log('');

// Generate operator key pair
const operatorKey = PrivateKey.random();
const operatorAddress = operatorKey.toPublicKey();

console.log('=== Operator Account ===');
console.log('Private Key:', operatorKey.toBase58());
console.log('Address:', operatorAddress.toBase58());
console.log('');

console.log('=== Next Steps ===');
console.log('1. Save these keys securely (they will not be shown again)');
console.log('2. Fund both accounts on Zeko L2 Devnet:');
console.log('   - Deployer: Minimum 1 MINA (for deployment fees)');
console.log('   - Operator: Minimum 5 MINA (for ongoing operations)');
console.log('3. Create .env file in escrowm directory:');
console.log('   DEPLOYER_KEY=<deployer private key>');
console.log('   OPERATOR_KEY=<operator private key>');
console.log('4. Run deployment: npm run deploy:zeko');
console.log('');
console.log('⚠️  WARNING: Keep these private keys secure and never commit them to git!');
