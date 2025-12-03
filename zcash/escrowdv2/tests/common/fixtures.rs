// Test data fixtures and constants
//
// Provides deterministic test data for:
// - Seeds and keys
// - Addresses (transparent, Sapling, Orchard, Unified)
// - Transaction data
// - API keys and tokens

/// Fixed 64-byte test seed for deterministic key generation
pub const TEST_SEED: [u8; 64] = [
    0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08,
    0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f, 0x10,
    0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17, 0x18,
    0x19, 0x1a, 0x1b, 0x1c, 0x1d, 0x1e, 0x1f, 0x20,
    0x21, 0x22, 0x23, 0x24, 0x25, 0x26, 0x27, 0x28,
    0x29, 0x2a, 0x2b, 0x2c, 0x2d, 0x2e, 0x2f, 0x30,
    0x31, 0x32, 0x33, 0x34, 0x35, 0x36, 0x37, 0x38,
    0x39, 0x3a, 0x3b, 0x3c, 0x3d, 0x3e, 0x3f, 0x40,
];

/// Test API key
pub const TEST_API_KEY: &str = "test_api_key_12345";

/// Test operator token
pub const TEST_OPERATOR_TOKEN: &str = "test_operator_token_67890";

/// Valid testnet transparent address
pub const TEST_TRANSPARENT_ADDRESS: &str = "tmBsTi2xWTjUdEXnuTceL7fecEQKeWaPDJd";

/// Test unified address (placeholder - will be generated from TEST_SEED)
pub const TEST_UNIFIED_ADDRESS: &str = "utest1234567890abcdefghijklmnopqrstuvwxyz";

/// Test Mina address for binding
pub const TEST_MINA_ADDRESS: &str = "B62qod2DugDjy9Jxhzd56gFS7npN8pWhanxxb36MLPzDDqtzzDyBy5z";

/// Test Mina signature (base64)
pub const TEST_MINA_SIGNATURE: &str = "7mXGPi4VcJz8WmZ9RkNqEzWxHgFHqLqvKGPtFDKBPEHvzAjKx5QmRnYpBvL3TcD2";

/// Test transaction hex (minimal valid structure)
pub const TEST_TX_HEX: &str = "0400008085202f8900000000000000000000";

/// Test transaction ID
pub const TEST_TXID: &str = "abcd1234567890abcd1234567890abcd1234567890abcd1234567890abcd1234";

/// Test memo prefix for escrow identification
pub const TEST_MEMO_PREFIX: &str = "test:mina:";

/// Minimum funding amount (0.01 ZEC in zatoshis)
pub const MIN_FUNDING_AMOUNT: u64 = 1_000_000;

/// Standard test funding amount (0.1 ZEC in zatoshis)
pub const TEST_FUNDING_AMOUNT: u64 = 10_000_000;

/// Test block height
pub const TEST_BLOCK_HEIGHT: u64 = 1_000_000;

/// Test timestamp (Unix epoch)
pub const TEST_TIMESTAMP: i64 = 1_600_000_000;
