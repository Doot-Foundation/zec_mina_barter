import { config } from './config.js';
import { logger } from './logger.js';
import { settlementWorker } from './settlement-worker.js';
import { minaClient } from './mina-client.js';

/**
 * MinaEscrowPool Settlement Service
 *
 * Dedicated service for handling OffchainState settlement proofs.
 * Runs independently from the main middleware to avoid blocking API/coordinator.
 *
 * Architecture:
 * - Monitors pending OffchainState actions
 * - Generates settlement proofs (~5-6 minutes, CPU-intensive)
 * - Submits proofs to MinaEscrowPool contract
 * - Runs on separate process/container for resource isolation
 */

async function main() {
  logger.info('=== MinaEscrowPool Settlement Service ===');
  logger.info(`Network: ${config.mina.network}`);
  logger.info(`Pool Address: ${config.mina.poolAddress}`);
  logger.info('');

  try {
    // Initialize Mina client
    logger.info('Initializing Mina client...');
    await minaClient.initialize();
    await minaClient.compile();
    logger.info('✓ Mina client initialized');
    logger.info('');

    // Start settlement worker
    logger.info('Starting settlement worker...');
    await settlementWorker.start();
    logger.info('✓ Settlement service running');
    logger.info('');

    logger.info('Press Ctrl+C to stop');

    // Graceful shutdown
    process.on('SIGINT', async () => {
      logger.info('');
      logger.info('Shutting down settlement service...');
      settlementWorker.stop();
      logger.info('✓ Settlement service stopped');
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      logger.info('');
      logger.info('Received SIGTERM, shutting down...');
      settlementWorker.stop();
      process.exit(0);
    });

  } catch (error) {
    logger.error(`Failed to start settlement service: ${error}`);
    process.exit(1);
  }
}

main().catch((error) => {
  logger.error(`Unhandled error: ${error}`);
  process.exit(1);
});
