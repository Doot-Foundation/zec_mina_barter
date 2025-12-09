import express, { Request, Response } from 'express';
import { Field, Poseidon } from 'o1js';
import { config } from './config.js';
import { logger } from './logger.js';
import { escrowdManager } from './escrowd-manager.js';
import { escrowdClient } from './escrowd-client.js';
import { minaClient } from './mina-client.js';
import { portAllocator } from './port-allocator.js';

/**
 * Wait for escrowdv2 instance to be ready by polling its HTTP endpoint
 * @param port - The port the escrowdv2 instance is running on
 * @param timeoutMs - Maximum time to wait in milliseconds (default: 540000 = 9 minutes)
 * @returns Promise that resolves when ready, rejects on timeout
 */
async function waitForEscrowdReady(port: number, timeoutMs: number = 540000): Promise<void> {
  const startTime = Date.now();
  let attempt = 0;
  let delay = 1000; // Start with 1 second

  logger.info(`[waitForEscrowdReady] Waiting for escrowdv2 on port ${port} to be ready...`);
  logger.info(`[waitForEscrowdReady] Timeout: ${timeoutMs / 1000}s (${timeoutMs / 60000} minutes)`);

  while (Date.now() - startTime < timeoutMs) {
    attempt++;
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    try {
      // Try to fetch the /address endpoint
      const response = await fetch(`http://127.0.0.1:${port}/address`, {
        signal: AbortSignal.timeout(5000), // 5s timeout per request
      });

      if (response.ok) {
        const data = await response.json();
        logger.info(`[waitForEscrowdReady] ✓ escrowdv2 ready after ${elapsed}s (${attempt} attempts)`);
        // escrowdv2 /address returns { ua: string } (unified address)
        logger.info(`[waitForEscrowdReady] Address: ${data.ua}`);
        return;
      }
    } catch (error) {
      // Connection refused or timeout - escrowdv2 still compiling
      logger.debug(`[waitForEscrowdReady] Attempt ${attempt} failed after ${elapsed}s (will retry in ${delay / 1000}s)`);
    }

    // Wait before next attempt
    await new Promise((resolve) => setTimeout(resolve, delay));

    // Exponential backoff: 1s → 2s → 4s → 8s → 10s (max)
    delay = Math.min(delay * 2, 10000);
  }

  // Timeout reached
  const totalElapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  throw new Error(
    `Timeout waiting for escrowdv2 on port ${port} to be ready after ${totalElapsed}s (${attempt} attempts)`
  );
}

/**
 * Express API server for middleware control
 */
export class ApiServer {
  private app: express.Application;
  private server: any;

  constructor() {
    this.app = express();
    this.setupMiddleware();
    this.setupRoutes();
  }

  private setupMiddleware() {
    this.app.use(express.json());

    // Request logging
    this.app.use((req, res, next) => {
      logger.debug(`${req.method} ${req.path}`);
      next();
    });

    // CORS for local development
    this.app.use((req, res, next) => {
      res.header('Access-Control-Allow-Origin', '*');
      res.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
      res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
      }
      next();
    });
  }

  private setupRoutes() {
    // Health check
    this.app.get('/health', (req: Request, res: Response) => {
      res.json({
        status: 'ok',
        service: 'mina-zec-barter-middleware',
        timestamp: new Date().toISOString(),
      });
    });

    // Spawn escrowdv2 instance
    this.app.post('/api/spawn-escrowd', async (req: Request, res: Response) => {
      try {
        const { tradeId, apiKey } = req.body;

        // Validation
        if (!tradeId) {
          return res.status(400).json({
            success: false,
            error: 'Missing required field: tradeId',
          });
        }

        if (!apiKey) {
          return res.status(400).json({
            success: false,
            error: 'Missing required field: apiKey',
          });
        }

        // Spawn instance
        logger.info(`[spawn-escrowd] Spawning escrowdv2 for trade ${tradeId}...`);
        const result = await escrowdManager.spawn(tradeId, apiKey);

        if (!result.success) {
          logger.error(`[spawn-escrowd] Failed to spawn: ${result.message}`);
          return res.json(result);
        }

        // Wait for escrowdv2 to be ready (9 minute timeout for first compile)
        logger.info(`[spawn-escrowd] Spawned on port ${result.port}, waiting for readiness...`);

        try {
          await waitForEscrowdReady(result.port!, 540000); // 9 minutes
          logger.info(`[spawn-escrowd] ✓ escrowdv2 ready on port ${result.port}`);
        } catch (error) {
          logger.error(`[spawn-escrowd] Readiness check failed: ${error}`);
          // Kill the instance since it didn't start properly
          await escrowdManager.kill(tradeId);
          return res.status(500).json({
            success: false,
            error: `escrowdv2 failed to start within timeout: ${error}`,
          });
        }

        // Register trade for tracking
        minaClient.registerTrade(tradeId);

        res.json(result);

      } catch (error) {
        logger.error(`Spawn escrowd error: ${error}`);
        res.status(500).json({
          success: false,
          error: String(error),
        });
      }
    });

    // Get escrowd instance status
    this.app.get('/api/escrowd/:tradeId/status', async (req: Request, res: Response) => {
      try {
        const { tradeId } = req.params;
        const port = portAllocator.get(tradeId);

        if (!port) {
          return res.status(404).json({
            success: false,
            error: 'Trade not found or port not allocated',
          });
        }

        // Query the instance
        const status = await escrowdClient.getStatus(tradeId);

        if (!status) {
          return res.status(404).json({
            success: false,
            error: 'Instance not found or not responding',
            port,
          });
        }

        res.json({
          success: true,
          port,
          status,
        });

      } catch (error) {
        logger.error(`Get status error: ${error}`);
        res.status(500).json({
          success: false,
          error: String(error),
        });
      }
    });

    // Kill escrowd instance
    this.app.delete('/api/escrowd/:tradeId', async (req: Request, res: Response) => {
      try {
        const { tradeId } = req.params;

        const killed = await escrowdManager.kill(tradeId);

        res.json({
          success: killed,
          message: killed ? 'Instance killed' : 'Instance not found',
        });

      } catch (error) {
        logger.error(`Kill instance error: ${error}`);
        res.status(500).json({
          success: false,
          error: String(error),
        });
      }
    });

    // List all managed instances
    this.app.get('/api/escrowd/instances', (req: Request, res: Response) => {
      const instances = escrowdManager.getInstances();
      res.json({
        success: true,
        count: instances.length,
        instances,
      });
    });

    // 404 handler
    this.app.use((req: Request, res: Response) => {
      res.status(404).json({
        success: false,
        error: 'Endpoint not found',
      });
    });
  }

  /**
   * Start the API server
   */
  start(): Promise<void> {
    return new Promise((resolve) => {
      const port = config.api?.port || 3000;
      const host = config.api?.host || '127.0.0.1';

      this.server = this.app.listen(port, host, () => {
        logger.info(`API server listening on http://${host}:${port}`);
        resolve();
      });
    });
  }

  /**
   * Stop the API server
   */
  stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.server) {
        resolve();
        return;
      }

      this.server.close((err: Error) => {
        if (err) {
          reject(err);
        } else {
          logger.info('API server stopped');
          resolve();
        }
      });
    });
  }
}

export const apiServer = new ApiServer();
