import { config } from './config.js';
import { logger } from './logger.js';

/**
 * Simple Port Allocator
 *
 * Starts at 9000 and increments for each new instance.
 * No reuse, no tracking - just a simple counter.
 */
export class PortAllocator {
  private nextPort: number;
  private allocatedPorts: Map<string, number>; // tradeId -> port (for lookup only)

  constructor() {
    this.nextPort = config.escrowd.basePort; // 9000
    this.allocatedPorts = new Map();
  }

  /**
   * Allocate the next available port
   * If trade already has a port, return the existing one
   */
  allocate(tradeId: string): number {
    // Check if trade already has a port
    const existing = this.allocatedPorts.get(tradeId);
    if (existing !== undefined) {
      logger.debug(`Port ${existing} already allocated for trade ${tradeId}`);
      return existing;
    }

    // Assign next port and increment
    const port = this.nextPort;
    this.allocatedPorts.set(tradeId, port);
    this.nextPort++;

    logger.info(`Allocated port ${port} for trade ${tradeId}`);
    return port;
  }

  /**
   * Get port for a trade (without allocating)
   */
  get(tradeId: string): number | undefined {
    return this.allocatedPorts.get(tradeId);
  }

  /**
   * Remove port mapping when instance exits
   */
  free(tradeId: string): void {
    const port = this.allocatedPorts.get(tradeId);
    if (port !== undefined) {
      this.allocatedPorts.delete(tradeId);
      logger.info(`Freed port ${port} for trade ${tradeId}`);
    }
  }

  /**
   * Get all allocated ports
   */
  getAllocated(): Map<string, number> {
    return new Map(this.allocatedPorts);
  }
}

/**
 * Singleton instance
 */
export const portAllocator = new PortAllocator();
