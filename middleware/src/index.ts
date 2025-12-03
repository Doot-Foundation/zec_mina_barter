import { config, validateConfig } from './config.js';
import { logger } from './logger.js';
import { coordinator } from './coordinator.js';
import { settlementWorker } from './settlement-worker.js';
import { apiServer } from './api-server.js';
import { escrowdManager } from './escrowd-manager.js';

/**
 * Main entry point for the middleware coordinator
 */
async function main() {
  logger.info('=== MINA ↔ ZEC Barter Middleware ===');
  logger.info('Stateless coordinator for atomic swaps');
  logger.info('');

  try {
    // Validate configuration
    validateConfig();
    logger.info('');

    // Initialize coordinator
    await coordinator.initialize();
    logger.info('');

    // Start API server
    await apiServer.start();
    logger.info('');

    // Start monitoring
    coordinator.start();

    // Start settlement worker
    logger.info('');
    await settlementWorker.start();

    // Handle graceful shutdown
    process.on('SIGINT', async () => {
      logger.info('');
      logger.info('Received SIGINT, shutting down...');
      coordinator.stop();
      settlementWorker.stop();
      await apiServer.stop();
      escrowdManager.cleanup();
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      logger.info('');
      logger.info('Received SIGTERM, shutting down...');
      coordinator.stop();
      settlementWorker.stop();
      await apiServer.stop();
      escrowdManager.cleanup();
      process.exit(0);
    });

    logger.info('Middleware running. Press Ctrl+C to stop.');

  } catch (error) {
    logger.error(`Fatal error: ${error}`);
    process.exit(1);
  }
}

// Run main
main().catch((error) => {
  console.error('Unhandled error:', error);
  process.exit(1);
});
