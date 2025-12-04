import { spawn, ChildProcess } from 'child_process';
import { config, getEscrowdPort } from './config.js';
import { logger } from './logger.js';
import { escrowdClient } from './escrowd-client.js';

/**
 * Manages spawning and lifecycle of escrowdv2 instances
 */
export class EscrowdManager {
  private instances = new Map<string, ChildProcess>();

  /**
   * Spawn a new escrowdv2 instance for a trade
   */
  async spawn(tradeId: string, apiKey: string): Promise<{ success: boolean; port: number; message: string }> {
    const port = getEscrowdPort(tradeId);

    // Check if already running
    if (this.instances.has(tradeId)) {
      logger.warn(`Escrowd instance already running for trade ${tradeId} on port ${port}`);
      return {
        success: true,
        port,
        message: 'Instance already running',
      };
    }

    // Check if something is already on that port
    const existing = await escrowdClient.getStatus(tradeId);
    if (existing) {
      logger.warn(`Escrowd instance already exists for trade ${tradeId} on port ${port}`);
      return {
        success: true,
        port,
        message: 'Instance already exists',
      };
    }

    logger.info(`Spawning escrowdv2 instance for trade ${tradeId} on port ${port}`);

    try {
      // Spawn escrowdv2 process
      const escrowdPath = config.escrowd.binaryPath || 'cargo';
      const args = escrowdPath === 'cargo'
        ? ['run', '--release']
        : [];

      const child = spawn(escrowdPath, args, {
        cwd: config.escrowd.workingDir || process.cwd(),
        env: {
          ...process.env,
          // Per-trade configuration
          LISTEN_ADDR: `127.0.0.1:${port}`,
          API_KEY: apiKey,
          DATA_DIR: `./data/${tradeId}`,
          TRADE_ID: tradeId,
          // Logging
          RUST_LOG: 'info',
          // Network configuration (inherit from parent env or use defaults)
          NETWORK: process.env.NETWORK || 'testnet',
          LIGHTWALLETD_URL: process.env.LIGHTWALLETD_URL || 'http://127.0.0.1:9067',
          ZCASHD_RPC_URL: process.env.ZCASHD_RPC_URL || 'http://127.0.0.1:18232',
          ZCASHD_RPC_USER: process.env.ZCASHD_RPC_USER || 'zcashrpc',
          ZCASHD_RPC_PASS: process.env.ZCASHD_RPC_PASS || 'changeme',
          // Mina integration
          MINA_ENDPOINT: process.env.MINA_ENDPOINT || 'https://api.minascan.io/archive/devnet/v1/graphql',
          MINA_TO_PUBKEY: process.env.MINA_TO_PUBKEY || '',
          // Operational parameters
          ESCROW_ADDR_TYPE: process.env.ESCROW_ADDR_TYPE || 'shielded',
          FEE_CAP_MULTIPLIER: process.env.FEE_CAP_MULTIPLIER || '5.0',
          FUNDING_MIN_ZEC: process.env.FUNDING_MIN_ZEC || '0.001',
          MINA_MIN_AMOUNT: process.env.MINA_MIN_AMOUNT || '0.001',
          OPERATOR_TOKEN: process.env.OPERATOR_TOKEN || '',
          // Zcash params paths
          SAPLING_SPEND_PATH: process.env.SAPLING_SPEND_PATH || `${process.env.HOME}/.zcash-params/sapling-spend.params`,
          SAPLING_OUTPUT_PATH: process.env.SAPLING_OUTPUT_PATH || `${process.env.HOME}/.zcash-params/sapling-output.params`,
        },
        detached: false,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      // Store process reference
      this.instances.set(tradeId, child);

      // Log output
      child.stdout?.on('data', (data) => {
        logger.debug(`[escrowd:${tradeId}] ${data.toString().trim()}`);
      });

      child.stderr?.on('data', (data) => {
        logger.warn(`[escrowd:${tradeId}] ${data.toString().trim()}`);
      });

      // Handle process exit
      child.on('exit', (code) => {
        logger.info(`Escrowd instance for ${tradeId} exited with code ${code}`);
        this.instances.delete(tradeId);
      });

      child.on('error', (error) => {
        logger.error(`Escrowd instance for ${tradeId} error: ${error}`);
        this.instances.delete(tradeId);
      });

      // Wait a bit to check if it started successfully
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Verify it's running
      const status = await escrowdClient.getStatus(tradeId);
      if (!status) {
        throw new Error('Instance failed to start - no response from health check');
      }

      logger.info(`✓ Escrowdv2 instance spawned successfully for trade ${tradeId} on port ${port}`);

      return {
        success: true,
        port,
        message: 'Instance spawned successfully',
      };

    } catch (error) {
      logger.error(`Failed to spawn escrowd instance for ${tradeId}: ${error}`);
      this.instances.delete(tradeId);

      return {
        success: false,
        port,
        message: `Failed to spawn: ${error}`,
      };
    }
  }

  /**
   * Kill an escrowdv2 instance
   */
  async kill(tradeId: string): Promise<boolean> {
    const instance = this.instances.get(tradeId);
    if (!instance) {
      logger.warn(`No instance found for trade ${tradeId}`);
      return false;
    }

    logger.info(`Killing escrowd instance for trade ${tradeId}`);
    instance.kill('SIGTERM');
    this.instances.delete(tradeId);

    return true;
  }

  /**
   * Get status of all managed instances
   */
  getInstances(): Array<{ tradeId: string; pid: number | undefined }> {
    return Array.from(this.instances.entries()).map(([tradeId, process]) => ({
      tradeId,
      pid: process.pid,
    }));
  }

  /**
   * Cleanup all instances on shutdown
   */
  cleanup() {
    logger.info('Cleaning up escrowd instances...');
    for (const [tradeId, instance] of this.instances.entries()) {
      logger.info(`Killing instance for ${tradeId}`);
      instance.kill('SIGTERM');
    }
    this.instances.clear();
  }
}

export const escrowdManager = new EscrowdManager();
