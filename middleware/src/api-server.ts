import express, { Request, Response } from 'express';
import { config, getEscrowdPort } from './config.js';
import { logger } from './logger.js';
import { escrowdManager } from './escrowd-manager.js';
import { escrowdClient } from './escrowd-client.js';
import { minaClient } from './mina-client.js';

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
        const result = await escrowdManager.spawn(tradeId, apiKey);

        // Register trade for tracking if spawn succeeded
        if (result.success) {
          minaClient.registerTrade(tradeId);
        }

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
        const port = getEscrowdPort(tradeId);

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
