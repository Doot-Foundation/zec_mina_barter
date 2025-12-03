import {
  SmartContract,
  state,
  State,
  method,
  PublicKey,
  UInt64,
  Field,
  Bool,
  Struct,
  Provable,
  AccountUpdate,
  Permissions,
  UInt32,
  Experimental,
} from 'o1js';

const { OffchainState, OffchainStateCommitments } = Experimental;

/**
 * Trade data structure stored in OffchainState
 * Represents a single MINA escrow deposit awaiting ZEC counterparty
 */
export class TradeData extends Struct({
  tradeId: Field,              // UUID as Field (hashed from UUID string)
  depositor: PublicKey,        // Original MINA depositor (Alice)
  amount: UInt64,              // MINA amount locked (in nanomina)
  inTransit: Bool,             // Locked by operator when ZEC side funded
  claimant: PublicKey,         // ZEC seller who can claim MINA (Bob's MINA address)
  refundAddress: PublicKey,    // Where to refund if trade fails (usually == depositor)
  depositBlockHeight: UInt32,  // Block height when deposited
  expiryBlockHeight: UInt32,   // After this block height, refund allowed
  completed: Bool,             // Trade completed (claimed or refunded)
}) {
  /**
   * Creates a new trade with default empty claimant
   */
  static create(
    tradeId: Field,
    depositor: PublicKey,
    amount: UInt64,
    refundAddress: PublicKey,
    depositBlockHeight: UInt32,
    expiryBlocks: number = 960  // ~2 days at 3min/block
  ): TradeData {
    return new TradeData({
      tradeId,
      depositor,
      amount,
      inTransit: Bool(false),
      claimant: PublicKey.empty(),
      refundAddress,
      depositBlockHeight,
      expiryBlockHeight: depositBlockHeight.add(expiryBlocks),
      completed: Bool(false),
    });
  }

  /**
   * Creates an empty/deleted trade marker
   */
  static empty(): TradeData {
    return new TradeData({
      tradeId: Field(0),
      depositor: PublicKey.empty(),
      amount: UInt64.zero,
      inTransit: Bool(false),
      claimant: PublicKey.empty(),
      refundAddress: PublicKey.empty(),
      depositBlockHeight: UInt32.zero,
      expiryBlockHeight: UInt32.zero,
      completed: Bool(true),
    });
  }
}

/**
 * OffchainState configuration for the escrow pool
 * Maps tradeId (Field) → TradeData
 */
export const offchainState = OffchainState(
  {
    trades: OffchainState.Map(Field, TradeData),
  },
  {
    logTotalCapacity: 30,       // 2^30 = ~1 billion trades max capacity
    maxActionsPerUpdate: 5,      // Batch up to 5 actions before settlement
  }
);

export class TradeProof extends offchainState.Proof {}

/**
 * MinaEscrowPool - Shared pool zkApp for MINA ↔ ZEC atomic swaps
 *
 * Architecture:
 * - Users deposit MINA with UUID memo to this pool
 * - Operator locks deposits when ZEC counterparty funded
 * - ZEC sellers claim MINA from pool
 * - Original depositors can refund if trade expires/fails
 *
 * All trade state stored in OffchainState for scalability
 */
export class MinaEscrowPool extends SmartContract {
  // On-chain state: only OffchainState commitments and operator key
  @state(OffchainState.Commitments) offchainStateCommitments =
    offchainState.emptyCommitments();
  @state(PublicKey) operator = State<PublicKey>();

  // Initialize offchain state
  offchainState = offchainState.init(this);

  /**
   * Initialize contract with proper permissions
   */
  init() {
    super.init();

    // Set permissions
    this.account.permissions.set({
      ...Permissions.default(),
      send: Permissions.proofOrSignature(),  // Proofs can send MINA
      setPermissions: Permissions.impossible(), // Lock permissions forever
    });
  }

  /**
   * Initialize operator (one-time, first caller becomes operator)
   * Operator is the middleware that coordinates trades
   */
  @method async initOperator() {
    // Must be uninitialized
    const currentOperator = this.operator.getAndRequireEquals();
    currentOperator.assertEquals(PublicKey.empty());

    // Set caller as operator
    const sender = this.sender.getAndRequireSignature();
    this.operator.set(sender);
  }

  /**
   * User deposits MINA to pool with trade UUID
   *
   * @param tradeId - UUID as Field (hash of UUID string)
   * @param amount - MINA amount in nanomina
   * @param refundAddress - Where to refund if trade fails
   */
  @method async deposit(
    tradeId: Field,
    amount: UInt64,
    refundAddress: PublicKey
  ) {
    // Require user signature
    const depositor = this.sender.getAndRequireSignature();

    // Transfer MINA from user to pool
    const payerUpdate = AccountUpdate.createSigned(depositor);
    payerUpdate.send({ to: this.address, amount });

    // Check trade doesn't already exist
    const existingTrade = await this.offchainState.fields.trades.get(tradeId);
    existingTrade.isSome.assertFalse(); // Trade must not exist

    // Get current block height for expiry calculation
    const currentHeight = this.network.blockchainLength.getAndRequireEquals();

    // Create trade record
    const trade = TradeData.create(
      tradeId,
      depositor,
      amount,
      refundAddress,
      currentHeight
    );

    // Store in OffchainState using update pattern
    this.offchainState.fields.trades.update(tradeId, {
      from: existingTrade,
      to: trade,
    });
  }

  /**
   * Operator locks trade when ZEC side is funded
   * Sets inTransit=true and assigns claimant (ZEC seller)
   *
   * @param tradeId - Trade UUID as Field
   * @param claimant - ZEC seller's MINA address (Bob)
   */
  @method async lockTrade(
    tradeId: Field,
    claimant: PublicKey
  ) {
    // Only operator can lock trades
    const sender = this.sender.getAndRequireSignature();
    const operator = this.operator.getAndRequireEquals();
    sender.assertEquals(operator);

    // Get trade from OffchainState
    const trade = await this.offchainState.fields.trades.get(tradeId);
    trade.isSome.assertTrue(); // Trade must exist
    const tradeData = trade.value;

    // Can only lock if not already locked
    tradeData.inTransit.assertFalse();

    // Claimant must not be empty
    claimant.equals(PublicKey.empty()).assertFalse();

    // Update trade: set inTransit and claimant
    const updatedTrade = new TradeData({
      tradeId: tradeData.tradeId,
      depositor: tradeData.depositor,
      amount: tradeData.amount,
      inTransit: Bool(true),
      claimant,
      refundAddress: tradeData.refundAddress,
      depositBlockHeight: tradeData.depositBlockHeight,
      expiryBlockHeight: tradeData.expiryBlockHeight,
      completed: tradeData.completed,
    });

    this.offchainState.fields.trades.update(tradeId, {
      from: trade,
      to: updatedTrade,
    });
  }

  /**
   * ZEC seller (Bob) claims MINA from pool
   *
   * @param tradeId - Trade UUID as Field
   */
  @method async claim(tradeId: Field) {
    const claimant = this.sender.getAndRequireSignature();

    // Get trade from OffchainState
    const trade = await this.offchainState.fields.trades.get(tradeId);
    trade.isSome.assertTrue(); // Trade must exist
    const tradeData = trade.value;

    // Validate: must be locked, caller must be claimant
    tradeData.inTransit.assertTrue();
    tradeData.claimant.assertEquals(claimant);

    // Send MINA to claimant
    this.send({ to: claimant, amount: tradeData.amount });

    // Mark trade as completed (use empty marker)
    this.offchainState.fields.trades.update(tradeId, {
      from: trade,
      to: TradeData.empty(),
    });
  }

  /**
   * Original depositor (Alice) refunds MINA if trade fails/expires
   * Can only refund if not locked (inTransit=false)
   *
   * @param tradeId - Trade UUID as Field
   */
  @method async refund(tradeId: Field) {
    const sender = this.sender.getAndRequireSignature();

    // Get trade from OffchainState
    const trade = await this.offchainState.fields.trades.get(tradeId);
    trade.isSome.assertTrue(); // Trade must exist
    const tradeData = trade.value;

    // Validate: caller must be depositor
    tradeData.depositor.assertEquals(sender);

    // Trade must not be locked
    tradeData.inTransit.assertFalse();

    // Optional: check expiry (allow refund anytime if not locked)
    // Uncomment to enforce expiry period:
    // const currentHeight = this.network.blockchainLength.getAndRequireEquals();
    // currentHeight.assertGreaterThanOrEqual(tradeData.expiryBlockHeight);

    // Send MINA back to refund address
    this.send({ to: tradeData.refundAddress, amount: tradeData.amount });

    // Mark trade as completed (use empty marker)
    this.offchainState.fields.trades.update(tradeId, {
      from: trade,
      to: TradeData.empty(),
    });
  }

  /**
   * Emergency unlock - unlocks a locked trade (operator only)
   * Used when ZEC lock fails after MINA lock succeeds
   * Sets inTransit back to false, allowing refunds
   *
   * @param tradeId - Trade UUID as Field
   */
  @method async emergencyUnlock(tradeId: Field) {
    // Only operator can emergency unlock
    const sender = this.sender.getAndRequireSignature();
    const operator = this.operator.getAndRequireEquals();
    sender.assertEquals(operator);

    // Get trade from OffchainState
    const trade = await this.offchainState.fields.trades.get(tradeId);
    trade.isSome.assertTrue(); // Trade must exist
    const tradeData = trade.value;

    // Can only unlock if currently locked
    tradeData.inTransit.assertTrue();

    // Update trade: set inTransit back to false
    const updatedTrade = new TradeData({
      tradeId: tradeData.tradeId,
      depositor: tradeData.depositor,
      amount: tradeData.amount,
      inTransit: Bool(false),
      claimant: PublicKey.empty(), // Clear claimant
      refundAddress: tradeData.refundAddress,
      depositBlockHeight: tradeData.depositBlockHeight,
      expiryBlockHeight: tradeData.expiryBlockHeight,
      completed: tradeData.completed,
    });

    this.offchainState.fields.trades.update(tradeId, {
      from: trade,
      to: updatedTrade,
    });
  }

  /**
   * Settlement method - commits OffchainState changes on-chain
   * Anyone can call this to finalize pending state changes
   * Takes ~5-6 minutes to generate proof
   *
   * @param proof - OffchainState settlement proof
   */
  @method async settle(proof: TradeProof) {
    await this.offchainState.settle(proof);
  }
}
