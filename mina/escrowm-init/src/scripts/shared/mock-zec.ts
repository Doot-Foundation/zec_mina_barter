import crypto from 'crypto';

// ==============================================================================
// MOCK ZEC DATA STRUCTURES
// ==============================================================================

export interface MockZecTradeData {
  sellerAddress: string;      // ZEC address selling ZEC
  buyerAddress: string;        // ZEC address receiving ZEC
  amount: bigint;              // Amount in zatoshis
  txHash?: string;             // Transaction hash (set after "confirmation")
  confirmations?: number;      // Mock confirmation count
}

/**
 * Mock escrowdv2 state - simulates the ZEC-side escrow contract state
 * This represents what a real ZEC escrow contract would track
 */
export interface MockEscrowdv2State {
  deposited: boolean;          // ZEC was deposited to escrow
  confirmed: boolean;          // Transaction has sufficient confirmations (6+)
  locked: boolean;             // Escrow is locked (in-transit, trade committed)
  refunded: boolean;           // ZEC was refunded to depositor (trade failed)
  forwarded: boolean;          // ZEC was forwarded to recipient (trade succeeded)
  confirmationCount: number;   // Number of blockchain confirmations
  depositTxHash?: string;      // Deposit transaction hash
}

// ==============================================================================
// MOCK ZEC ADDRESS GENERATORS
// ==============================================================================

/**
 * Generate mock Zcash testnet transparent address (t-address)
 * Format: t1 + 32 random alphanumeric characters
 */
export function generateMockZecAddress(): string {
  const randomSuffix = crypto
    .randomBytes(17)
    .toString('base64')
    .replace(/[^a-zA-Z0-9]/g, '')
    .slice(0, 32);
  return `t1${randomSuffix}`;
}

/**
 * Generate mock Zcash shielded address (z-address)
 * Format: zs1 + random characters
 */
export function generateMockZecShieldedAddress(): string {
  const randomSuffix = crypto
    .randomBytes(40)
    .toString('base64')
    .replace(/[^a-zA-Z0-9]/g, '')
    .slice(0, 75);
  return `zs1${randomSuffix}`;
}

// ==============================================================================
// MOCK ZEC TRANSACTION HASH
// ==============================================================================

/**
 * Generate mock Zcash transaction hash (64 hex characters)
 */
export function generateMockZecTxHash(): string {
  return crypto.randomBytes(32).toString('hex');
}

// ==============================================================================
// AMOUNT CONVERSIONS
// ==============================================================================

/**
 * Convert ZEC to zatoshis (1 ZEC = 100,000,000 zatoshis)
 */
export function zecToZatoshis(zec: number): bigint {
  return BigInt(Math.floor(zec * 1e8));
}

/**
 * Convert zatoshis to ZEC
 */
export function zatoshisToZec(zatoshis: bigint | string): number {
  const amount = typeof zatoshis === 'string' ? BigInt(zatoshis) : zatoshis;
  return Number(amount) / 1e8;
}

// ==============================================================================
// MOCK TRADE GENERATORS
// ==============================================================================

/**
 * Generate complete mock ZEC trade data
 * @param zecAmount - Amount of ZEC to trade
 * @returns Mock ZEC trade data structure
 */
export function generateMockZecTrade(zecAmount: number): MockZecTradeData {
  return {
    sellerAddress: generateMockZecAddress(),
    buyerAddress: generateMockZecAddress(),
    amount: zecToZatoshis(zecAmount),
    confirmations: 0,
  };
}

/**
 * Simulate ZEC transaction confirmation
 * Adds transaction hash and sets confirmations to 6
 */
export function confirmMockZecTrade(trade: MockZecTradeData): MockZecTradeData {
  return {
    ...trade,
    txHash: generateMockZecTxHash(),
    confirmations: 6, // Standard safe confirmation count
  };
}

// ==============================================================================
// LOGGING HELPERS
// ==============================================================================

/**
 * Log mock ZEC trade details with clear "MOCK" labeling
 */
export function logMockZecTrade(trade: MockZecTradeData, label: string): void {
  console.log(`\n🪙 MOCK ZEC Trade (${label}):`);
  console.log(`  Seller: ${trade.sellerAddress}`);
  console.log(`  Buyer: ${trade.buyerAddress}`);
  console.log(`  Amount: ${zatoshisToZec(trade.amount).toFixed(8)} ZEC`);
  console.log(`  Amount (zatoshis): ${trade.amount.toString()}`);

  if (trade.txHash) {
    console.log(`  Tx Hash: ${trade.txHash}`);
    console.log(`  Confirmations: ${trade.confirmations}`);
  } else {
    console.log(`  Status: Pending confirmation`);
  }

  console.log(`  ⚠️  This is MOCKED ZEC data for testing purposes`);
}

/**
 * Calculate equivalent ZEC amount based on mock exchange rate
 * For testing, we use a simple 50:1 MINA:ZEC ratio
 * (1 MINA = 0.02 ZEC)
 */
export function calculateMockZecAmount(minaAmount: number): number {
  const MOCK_EXCHANGE_RATE = 0.02; // 1 MINA = 0.02 ZEC
  return minaAmount * MOCK_EXCHANGE_RATE;
}

/**
 * Log mock exchange rate information
 */
export function logMockExchangeRate(minaAmount: number): void {
  const zecAmount = calculateMockZecAmount(minaAmount);

  console.log(`\n💱 MOCK Exchange Rate:`);
  console.log(`  1 MINA = 0.02 ZEC (50:1 ratio)`);
  console.log(`  ${minaAmount} MINA = ${zecAmount.toFixed(8)} ZEC`);
  console.log(`  ⚠️  This is a MOCKED exchange rate for testing`);
}

// ==============================================================================
// MOCK ESCROWDV2 STATE VERIFICATION
// ==============================================================================

/**
 * Generate mock escrowdv2 state for a valid, confirmed deposit
 * This simulates querying a ZEC-side escrow contract
 *
 * In a real implementation, this would query the actual ZEC escrow contract
 * to verify the deposit status before locking the MINA side
 */
export function generateMockEscrowdv2State(
  depositTxHash: string,
  confirmations: number = 6
): MockEscrowdv2State {
  return {
    deposited: true,              // ZEC deposited to escrow
    confirmed: confirmations >= 6, // Safe confirmation threshold
    locked: false,                // Not yet locked (happens after MINA lock)
    refunded: false,              // Not refunded
    forwarded: false,             // Not yet forwarded
    confirmationCount: confirmations,
    depositTxHash,
  };
}

/**
 * Log mock escrowdv2 state with clear "MOCK" labeling
 * This represents what an operator would verify before locking MINA
 */
export function logMockEscrowdv2State(state: MockEscrowdv2State, label: string): void {
  console.log(`\n🔒 MOCK escrowdv2 State Check (${label}):`);
  console.log(`  Deposited: ${state.deposited ? '✅' : '❌'}`);
  console.log(`  Confirmations: ${state.confirmationCount}/${6} ${state.confirmed ? '✅' : '⏳'}`);
  console.log(`  Locked: ${state.locked ? '✅' : '⏳'}`);
  console.log(`  Refunded: ${state.refunded ? '❌ (Trade Failed)' : '✅'}`);
  console.log(`  Forwarded: ${state.forwarded ? '✅' : '⏳'}`);

  if (state.depositTxHash) {
    console.log(`  Deposit Tx: ${state.depositTxHash}`);
  }

  console.log(`  ⚠️  This is a MOCKED escrowdv2 state for testing`);
  console.log(`  ⚠️  Real implementation would query actual ZEC escrow contract`);
}

/**
 * Verify that escrowdv2 state is valid for locking the MINA side
 * Operator should only lock MINA if ZEC escrow is in the correct state
 */
export function verifyMockEscrowdv2StateForLock(state: MockEscrowdv2State): {
  valid: boolean;
  reason?: string;
} {
  // Check 1: ZEC must be deposited
  if (!state.deposited) {
    return {
      valid: false,
      reason: 'ZEC not deposited to escrowdv2',
    };
  }

  // Check 2: ZEC must have sufficient confirmations
  if (!state.confirmed || state.confirmationCount < 6) {
    return {
      valid: false,
      reason: `Insufficient confirmations (${state.confirmationCount}/6)`,
    };
  }

  // Check 3: ZEC must not be refunded
  if (state.refunded) {
    return {
      valid: false,
      reason: 'ZEC already refunded (trade failed)',
    };
  }

  // Check 4: ZEC must not be forwarded yet
  if (state.forwarded) {
    return {
      valid: false,
      reason: 'ZEC already forwarded (invalid state)',
    };
  }

  // All checks passed
  return { valid: true };
}
