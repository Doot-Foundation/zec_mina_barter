import { config, getEscrowdUrl, getEscrowdPort } from './config.js';
import { logger } from './logger.js';

/**
 * Port Manager
 *
 * Handles port collision detection for escrowd instances.
 * Each trade maps to a deterministic port via Poseidon hash.
 * If port is already occupied, trade should be skipped until
 * either escrowd instance exits or user regenerates UUID.
 */
export class PortManager {
  /**
   * Check if a port is occupied by an active escrowd instance
   *
   * Strategy: Try to connect to escrowd /status endpoint
   * - If we get ANY response (even 404 or error), port is occupied
   * - If connection is refused or times out, port is free
   */
  async isPortAvailable(tradeId: string): Promise<boolean> {
    try {
      const url = getEscrowdUrl(tradeId, '/status');

      // Try to connect with short timeout
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2000);

      try {
        const response = await fetch(url, {
          method: 'GET',
          signal: controller.signal,
          headers: { 'Content-Type': 'application/json' },
        });

        clearTimeout(timeout);

        // If we got any response (even error), port is occupied
        logger.debug(`Port for trade ${tradeId} is occupied (HTTP ${response.status})`);
        return false;

      } catch (fetchError) {
        clearTimeout(timeout);

        // Connection refused or timeout = port is free
        logger.debug(`Port for trade ${tradeId} is available`);
        return true;
      }

    } catch (error) {
      // Assume available on unexpected errors
      logger.warn(`Port check failed for ${tradeId}: ${error}`);
      return true;
    }
  }

  /**
   * Log collision statistics
   */
  logCollision(tradeId: string, port: number): void {
    logger.warn(
      `⚠️  PORT COLLISION: Trade ${tradeId} maps to occupied port ${port}. ` +
      `Trade will be skipped until user regenerates UUID or escrowd instance exits.`
    );
  }
}

/**
 * Create and export singleton port manager
 */
export const portManager = new PortManager();
