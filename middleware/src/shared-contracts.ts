import { PublicKey, fetchAccount } from 'o1js';
import { logger } from './logger.js';
// Import contracts DIRECTLY from local src folder
import { MinaEscrowPool, TradeData, offchainState, TradeProof } from './contracts/MinaEscrowPool.js';
import { uuidToField, isValidUUID } from './contracts/utils.js';

/**
 * Global shared contract instances
 * Compiled once in main thread in ONE SINGLE PLACE, reused everywhere
 */

// Contract modules (already imported, just export them)
export const contractModules = {
  MinaEscrowPool,
  TradeData,
  offchainState,
  TradeProof,
  uuidToField,
  isValidUUID,
};

// zkApp instance (created during compilation)
export let globalZkApp: any = null;

// Compilation flag
export let isCompiled = false;

/**
 * Fetch account with retry logic to handle network issues
 */
export async function fetchAccountWithRetry(
  accountInfo: { publicKey: PublicKey },
  maxRetries = 5
): Promise<any> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const result = await fetchAccount(accountInfo);
      return result;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.warn(`[fetchAccountWithRetry] Attempt ${i + 1}/${maxRetries} failed: ${errorMsg}`);
      if (i === maxRetries - 1) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1000 * (i + 1))); // Exponential backoff
    }
  }
}

/**
 * SINGLE FUNCTION TO DO EVERYTHING
 * Compile offchainState + MinaEscrowPool + create instance + attach
 * ALL IN ONE PLACE IN MAIN THREAD
 */
export async function compileAndCreateContracts(address: PublicKey) {
  if (isCompiled && globalZkApp) {
    logger.info('[SharedContracts] Contracts already compiled and zkApp ready');
    return;
  }

  try {
    logger.info('[SharedContracts] Contract modules imported directly from local src');

    // COMPILE EVERYTHING IN ONE PLACE
    logger.info('[SharedContracts] Compiling contracts (this will take ~50-60 seconds)...');
    const startCompile = Date.now();

    // Step 1: Compile offchainState FIRST
    await offchainState.compile();

    // Step 2: Compile MinaEscrowPool SECOND
    const { verificationKey } = await MinaEscrowPool.compile();

    const compileTime = ((Date.now() - startCompile) / 1000).toFixed(2);
    logger.info(`[SharedContracts] ✓ Compiled in ${compileTime}s`);
    logger.info(`[SharedContracts] Verification key hash: ${verificationKey.hash.toString()}`);

    // Step 3: Create contract instance IMMEDIATELY AFTER COMPILATION
    logger.info('[SharedContracts] Creating zkApp instance...');
    const zkApp = new MinaEscrowPool(address);

    // Step 4: Attach offchainState to zkApp IMMEDIATELY
    zkApp.offchainState.setContractInstance(zkApp);

    globalZkApp = zkApp;
    isCompiled = true;

    logger.info('[SharedContracts] ✓ zkApp instance ready with offchainState attached');
    logger.info('');

  } catch (error) {
    logger.error(`[SharedContracts] Compilation/creation failed: ${error}`);
    throw error;
  }
}

/**
 * Get compiled contract modules
 */
export function getContractModules() {
  return contractModules;
}

/**
 * Get global zkApp instance
 */
export function getGlobalZkApp() {
  if (!globalZkApp) {
    throw new Error('Global zkApp not initialized. Call compileAndCreateContracts() first.');
  }
  return globalZkApp;
}
