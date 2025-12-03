/**
 * Escrowd API response types
 */

export interface EscrowdStatusResponse {
  status?: 'inactive' | 'active';
  verified: boolean;
  in_transit: boolean;
  origin_address?: string;
  origin_type?: 'Shielded' | 'Transparent';
  origin?: {
    origin_type: 'Shielded' | 'Transparent';
    origin_address: string;
  };
  target_address?: string;
  expected_amount_zec?: string;
  received_amount_zec?: string;
  memo?: string;
}

export interface EscrowdAddressResponse {
  transparent: string;
  shielded: string;
}

/**
 * Trade state from Mina OffchainState
 */
export interface MinaTrade {
  tradeId: string;            // Original UUID string
  tradeIdField: string;       // Field representation (for contract calls)
  depositor: string;          // Base58 public key
  amount: string;             // Nanomina as string
  inTransit: boolean;
  claimant: string;           // Base58 public key (empty if not locked)
  refundAddress: string;      // Base58 public key
  depositBlockHeight: string;
  expiryBlockHeight: string;
}

/**
 * Combined trade state from both chains
 */
export interface CombinedTradeState {
  tradeId: string;
  minaState: MinaTrade | null;
  zecState: EscrowdStatusResponse | null;
  readyToLock: boolean;       // Both sides funded, neither locked
}

export interface KeypairRecord {
  minaPublicKey: string;
  zcashPublicKey: string;
}

export interface OracleSnapshot {
  mina_usd: string;
  zec_usd: string;
  decimals: number;
  aggregationTimestamp: number;
  signatures: {
    mina: {
      signature: string;
      publicKey: string;
      data: string;
    };
    zec: {
      signature: string;
      publicKey: string;
      data: string;
    };
  };
}
