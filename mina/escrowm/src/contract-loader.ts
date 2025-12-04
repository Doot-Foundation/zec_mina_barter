import { PublicKey } from 'o1js';
import { logger } from './logger.js';

/**
 * Dynamic contract loader
 * Imports MinaEscrowPool from escrowm-init/
 */

let contractModules: any = null;
let isCompiled = false;

/**
 * Load contract modules from escrowm-init
 */
export async function loadContracts() {
  if (contractModules) {
    return contractModules;
  }

  logger.debug('Loading contracts from escrowm-init...');

  // Import from sibling directory
  const module = await import('../../escrowm-init/build/src/index.js');

  contractModules = {
    MinaEscrowPool: module.MinaEscrowPool,
    offchainState: module.offchainState,
    TradeData: module.TradeData,
    TradeProof: module.TradeProof,
  };

  logger.debug('✓ Contracts loaded');
  return contractModules;
}

/**
 * Compile contracts (do once at startup)
 * CRITICAL ORDER: offchainState FIRST, then MinaEscrowPool
 */
export async function compileContracts() {
  if (isCompiled) {
    logger.debug('Contracts already compiled');
    return;
  }

  logger.info('Compiling contracts (this takes ~50-60 seconds)...');
  const startTime = Date.now();

  const modules = await loadContracts();

  // CRITICAL ORDER: offchainState must be compiled BEFORE MinaEscrowPool
  logger.debug('Step 1/2: Compiling offchainState...');
  const offchainStartTime = Date.now();
  await modules.offchainState.compile();
  const offchainDuration = ((Date.now() - offchainStartTime) / 1000).toFixed(2);
  logger.debug(`✓ OffchainState compiled in ${offchainDuration}s`);

  logger.debug('Step 2/2: Compiling MinaEscrowPool...');
  await modules.MinaEscrowPool.compile();

  const totalDuration = ((Date.now() - startTime) / 1000).toFixed(2);
  logger.info(`✓ Compilation complete in ${totalDuration}s`);

  isCompiled = true;
}

/**
 * Create contract instance with offchainState binding
 */
export async function createContractInstance(address: PublicKey) {
  const modules = await loadContracts();
  const zkApp = new modules.MinaEscrowPool(address);

  // CRITICAL: Bind offchainState to contract instance
  // Without this, offchainState cannot access contract commitments
  zkApp.offchainState.setContractInstance(zkApp);

  return zkApp;
}

/**
 * Check if contracts are compiled
 */
export function isContractsCompiled(): boolean {
  return isCompiled;
}

/**
 * Get loaded contract modules
 */
export function getContractModules() {
  if (!contractModules) {
    throw new Error('Contracts not loaded. Call loadContracts() first.');
  }
  return contractModules;
}
