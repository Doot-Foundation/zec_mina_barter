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
    // Import from built escrowm-init package
    const module = await import('../../mina/escrowm-init/build/src/index.js');

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
    logger.info('Contracts already compiled');
    return;
  }

  const modules = await loadContracts();

  logger.info('Compiling contracts...');
  const startTime = Date.now();

  try {
    // CRITICAL ORDER: offchainState FIRST, then MinaEscrowPool
    logger.info('Step 1/2: Compiling offchainState...');
    await modules.offchainState.compile();

    logger.info('Step 2/2: Compiling MinaEscrowPool...');
    await modules.MinaEscrowPool.compile();

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
  logger.info('  [createContractInstance] Loading contracts...');
  const modules = await loadContracts();
  logger.info('  [createContractInstance] Creating MinaEscrowPool instance...');
  const zkApp = new modules.MinaEscrowPool(address);
  logger.info('  [createContractInstance] Setting offchainState contract instance...');
  zkApp.offchainState.setContractInstance(zkApp); // REQUIRED
  logger.info('  [createContractInstance] ✓ Instance ready');
  return zkApp;
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
