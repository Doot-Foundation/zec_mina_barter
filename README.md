# About

This project enables atomic swaps between Mina and Zcash bridging a programmable smart
contract chain with the most private cryptocurrency that doesn't support smart contracts.

## Privacy-First Escrow for Zcash

Zcash lacks programmable logic for escrow. Traditional solutions require wrapped tokens (wZEC) with
trusted custodians or centralized exchanges that destroy privacy. This system uses ephemeral escrow
instances (escrowdv2) that preserve Zcash's shielded architecture:

- Sealed keys per-trade: Each swap gets a dedicated instance (port 9000+) with keys never exposed to
  zcashd
- LightWalletd-only detection: Escrow addresses never touch zcashd funds detected via encrypted shielded
  notes
- Minimal metadata leakage: Only encrypted memo field on-chain, no addresses or amounts visible

The middleware coordinates atomically: both MINA deposit (on-chain zkApp) and ZEC funding (off-chain
verification) must succeed before locking. No bridges, no wrapped tokens, no custody risk.

Mina + Zcash: The Perfect Privacy-Programmability Alliance

Mina is the world's most advanced ZK-native blockchain the entire chain is a single ~22KB recursive
proof. This makes it uniquely positioned to handle privacy-preserving cross-chain logic that other smart
contract platforms can't match.

# This bridge enables both ecosystems to benefit

For Mina Users: Finally access real privacy without centralized exchanges. Trade MINA → ZEC and hold funds
in Zcash's battle-tested shielded pools. Mina's zkApps provide the programmable guarantees, Zcash
provides the transaction privacy together they offer what neither can alone.

For Zcash Users: Access Mina's rich zkApp ecosystem (DeFi, NFTs, identity protocols) without abandoning
privacy. Exit to shielded ZEC anytime via atomic swaps. This is Zcash's gateway to programmable
smart contracts while maintaining shielded transactions.

Why This Matters: Mina's zero-knowledge foundations let it spread its wings into privacy-enabled
transactions not just privacy in computation (zkApps already do this), but privacy in cross-chain value
transfer. This is Mina proving it can bridge the gap between transparency (DeFi) and opacity (Zcash)
better than any EVM chain.

# POC Simplifications vs. Production Potential

Current POC uses shortcuts for rapid testing:

- Unified operator token (this_is_escrowd_operator_token) across all trades
- Simple sequential port allocation
- Single middleware instance

Production-ready architecture would enable:

- Per-trade cryptographic API keys (derived from trade commitment)
- Distributed middleware (anyone can run polling coordinator)
- Multi-signature operator controls
- Enhanced memo encryption schemes

With proper implementation, this could become the leading escrow service for Zcash offering
smart contract guarantees (timeouts, refunds, conditional claims) to a chain that fundamentally can't
support them natively.

# Beyond Mina: Blockchain-Agnostic Design

While built with love for Mina's zero-knowledge architecture, the middleware is fundamentally
blockchain-agnostic. Any chain exposing queryable endpoints or RPCs can integrate:

// From middleware/src/mina-client.ts - swap this for any blockchain client
async getTradeState(tradeId: string) {
const response = await fetch(GRAPHQL_ENDPOINT, { query: tradeQuery });
return response.data.trade.status; // Deposited | Locked | Claimed
}

Replace mina-client.ts with Ethereum RPC, Solana JSON-RPC, Bitcoin electrum servers the escrowdv2 ZEC
side remains unchanged. This is a privacy-preserving escrow protocol, not a Mina-only bridge.
