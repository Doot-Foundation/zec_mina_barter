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
 */
export async function compileContracts() {
  if (isCompiled) {
    logger.debug('Contracts already compiled');
    return;
  }

  logger.info('Compiling MinaEscrowPool...');
  const startTime = Date.now();

  const modules = await loadContracts();

  // Compile contract and offchain state
  await modules.MinaEscrowPool.compile();
  await modules.offchainState.compile();

  const duration = ((Date.now() - startTime) / 1000).toFixed(2);
  logger.info(`✓ Compiled in ${duration}s`);

  isCompiled = true;
}

/**
 * Create contract instance
 */
export async function createContractInstance(address: PublicKey) {
  const modules = await loadContracts();
  const zkApp = new modules.MinaEscrowPool(address);
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
