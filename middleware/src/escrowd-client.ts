import { config, getEscrowdUrl } from './config.js';
import { logger, colors } from './logger.js';
import { EscrowdStatusResponse, EscrowdAddressResponse } from './types.js';
import { portAllocator } from './port-allocator.js';

/**
 * Client for interacting with escrowd instances (ZEC side)
 */
export class EscrowdClient {
  /**
   * Get status of an escrowd instance
   */
  async getStatus(tradeId: string): Promise<EscrowdStatusResponse | null> {
    try {
      const allocatedPort = portAllocator.get(tradeId);
      const url = allocatedPort
        ? `${config.escrowd.baseUrl}:${allocatedPort}/status`
        : getEscrowdUrl(tradeId, '/status');
      logger.debug(`[EscrowdClient] Fetching status for ${tradeId}: ${url}`);

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        if (response.status === 404) {
          logger.debug(`Escrowd instance not found for trade ${tradeId}`);
          return null;
        }
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json() as EscrowdStatusResponse;
      logger.debug(
        `[EscrowdClient] Status for ${tradeId}: verified=${data.verified} in_transit=${data.in_transit} rawStatus=${data.status}`,
      );
      if (data.origin && !data.origin_address) {
        data.origin_address = data.origin.origin_address;
        data.origin_type = data.origin.origin_type;
      }
      return data;
    } catch (error) {
      logger.debug(
        `[EscrowdClient] Failed to fetch status for ${tradeId}: ${error}`,
      );
      return null;
    }
  }

  /**
   * Mark escrowd as in-transit (locked)
   */
  async setInTransit(
    tradeId: string,
    minaTxHash: string,
    expectedMinaAmount: string,
    oracleSnapshot: {
      mina_usd: string;
      zec_usd: string;
      decimals: number;
      aggregationTimestamp: number;
    }
  ): Promise<boolean> {
    try {
      const allocatedPort = portAllocator.get(tradeId);
      const url = allocatedPort
        ? `${config.escrowd.baseUrl}:${allocatedPort}/set-in-transit`
        : getEscrowdUrl(tradeId, '/set-in-transit');
      logger.info(
        `${colors.zec}Locking escrowd for trade ${tradeId} on ${url} with MINA tx ${minaTxHash}`
      );

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.escrowd.operatorToken}`,
        },
        body: JSON.stringify({
          mina_tx_hash: minaTxHash,
          expected_mina_amount: expectedMinaAmount,
          mina_usd: oracleSnapshot.mina_usd,
          zec_usd: oracleSnapshot.zec_usd,
          decimals: oracleSnapshot.decimals,
          aggregationTimestamp: oracleSnapshot.aggregationTimestamp,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }

      logger.info(`${colors.zec}✓ Escrowd locked for trade ${tradeId}`);
      return true;
    } catch (error) {
      logger.error(`${colors.zec}Failed to lock escrowd for ${tradeId}: ${error}`);
      return false;
    }
  }

  /**
   * Send ZEC to target address (final claim step)
   */
  async sendToTarget(tradeId: string, targetAddress: string): Promise<boolean> {
    try {
      const allocatedPort = portAllocator.get(tradeId);
      const url = allocatedPort
        ? `${config.escrowd.baseUrl}:${allocatedPort}/send-target`
        : getEscrowdUrl(tradeId, '/send-target');
      logger.info(`${colors.zec}Sending ZEC to ${targetAddress} for trade ${tradeId} via ${url}`);

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.escrowd.operatorToken}`,
        },
        body: JSON.stringify({
          target_address: targetAddress,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }

      logger.info(`${colors.zec}✓ ZEC sent for trade ${tradeId}`);
      return true;
    } catch (error) {
      logger.error(`${colors.zec}Failed to send ZEC for ${tradeId}: ${error}`);
      return false;
    }
  }

  /**
   * Get escrowd addresses
   */
  async getAddresses(tradeId: string): Promise<EscrowdAddressResponse | null> {
    try {
      const allocatedPort = portAllocator.get(tradeId);
      const url = allocatedPort
        ? `${config.escrowd.baseUrl}:${allocatedPort}/address`
        : getEscrowdUrl(tradeId, '/address');

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json() as EscrowdAddressResponse;
      return data;
    } catch (error) {
      logger.debug(`Failed to fetch escrowd addresses for ${tradeId}: ${error}`);
      return null;
    }
  }
}

export const escrowdClient = new EscrowdClient();
