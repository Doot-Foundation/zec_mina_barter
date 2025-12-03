import { PublicKey } from 'o1js';
import { logger } from './logger.js';

/**
 * Contract imports and compilation management
 *
 * Note: Imports are done dynamically to handle compilation timing
 */

let contractModules: any = null;
let isCompiled = false;

/**
 * Load contract modules from escrowm
 */
export async function loadContracts() {
  if (contractModules) {
    return contractModules;
  }

  try {
    // Import from built escrowm package
    const module = await import('../../escrowm/build/src/index.js');

    contractModules = {
      MinaEscrowPool: module.MinaEscrowPool,
      TradeData: module.TradeData,
      offchainState: module.offchainState,
      TradeProof: module.TradeProof,
      uuidToField: module.uuidToField,
    };

    logger.info('✓ Contract modules loaded');
    return contractModules;
  } catch (error) {
    logger.error(`Failed to load contract modules: ${error}`);
    throw new Error('Contract modules not found. Run "npm run build" in escrowm/ first.');
  }
}

/**
 * Compile MinaEscrowPool contract and offchain state
 * Should be called once at middleware startup
 */
export async function compileContracts() {
  if (isCompiled) {
    logger.debug('Contracts already compiled');
    return;
  }

  const modules = await loadContracts();

  logger.info('Compiling MinaEscrowPool contract...');
  const startTime = Date.now();

  try {
    // Compile the main contract
    await modules.MinaEscrowPool.compile();

    // Compile offchain state
    await modules.offchainState.compile();

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    logger.info(`✓ Contracts compiled in ${duration}s`);

    isCompiled = true;
  } catch (error) {
    logger.error(`Compilation failed: ${error}`);
    throw error;
  }
}

/**
 * Create contract instance
 */
export async function createContractInstance(address: PublicKey) {
  const modules = await loadContracts();
  return new modules.MinaEscrowPool(address);
}

/**
 * Get contract modules (must be loaded first)
 */
export function getContractModules() {
  if (!contractModules) {
    throw new Error('Contract modules not loaded. Call loadContracts() first.');
  }
  return contractModules;
}

/**
 * Check if contracts are compiled
 */
export function isContractsCompiled(): boolean {
  return isCompiled;
}
