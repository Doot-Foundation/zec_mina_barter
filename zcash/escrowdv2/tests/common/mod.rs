// Test utilities and common helpers for escrowdv2 integration tests
//
// This module provides shared test infrastructure including:
// - Test configuration generation
// - Mock service implementations
// - Test data fixtures
// - Helper functions for common test scenarios

use escrowdv2::{
    config::Config,
    AppError,
};
use tempfile::TempDir;

pub mod fixtures;
pub mod mocks;

/// Creates a test configuration with isolated temporary directories
///
/// This ensures each test has its own isolated environment with:
/// - Unique data directory
/// - Test network endpoints
pub fn create_test_config() -> (Config, TempDir) {
    let temp_dir = TempDir::new().expect("Failed to create temp directory");

    // Note: Config will be loaded from actual config file in tests
    // This is a placeholder for now
    let config = Config::default_test();

    (config, temp_dir)
}

// TODO: Uncomment and implement these helpers once Config structure is finalized
/*
/// Creates a test KeyManager with a deterministic seed
pub fn create_test_key_manager(config: &Config) -> Result<KeyManager, AppError> {
    KeyManager::init(config)?;
    KeyManager::load(config)
}

/// Creates a test AppState with isolated storage
pub fn create_test_state(config: &Config) -> Result<AppState, AppError> {
    todo!("Implement after Config finalizes")
}

/// Creates a test Axum app with all routes configured
pub fn create_test_app(state: AppState) -> axum::Router {
    escrowdv2::api::build_router(state)
}

/// Helper to create a full test setup
pub fn create_full_test_setup() -> Result<(Config, TempDir, KeyManager, AppState), AppError> {
    todo!("Implement after Config finalizes")
}
*/

/// Converts a byte slice to hex string for debugging
pub fn bytes_to_hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{:02x}", b)).collect()
}

/// Converts hex string to bytes for test data construction
pub fn hex_to_bytes(hex: &str) -> Result<Vec<u8>, AppError> {
    (0..hex.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&hex[i..i + 2], 16))
        .collect::<Result<Vec<u8>, _>>()
        .map_err(|e| AppError::Wallet(format!("Invalid hex: {}", e)))
}

/// Creates a minimal valid Zcash testnet address for testing
pub fn create_test_address() -> String {
    // Valid testnet transparent address for testing
    "tmBsTi2xWTjUdEXnuTceL7fecEQKeWaPDJd".to_string()
}

/// Creates a minimal valid unified address for testing
pub fn create_test_unified_address() -> String {
    // This will be populated with actual test vectors
    fixtures::TEST_UNIFIED_ADDRESS.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_create_test_config() {
        let (config, temp_dir) = create_test_config();

        assert_eq!(config.api_key, "test_api_key_12345");
        assert_eq!(config.operator_token, Some("test_operator_token_67890".to_string()));
        assert!(temp_dir.path().exists());
    }

    #[test]
    fn test_bytes_hex_conversion() {
        let bytes = vec![0xde, 0xad, 0xbe, 0xef];
        let hex = bytes_to_hex(&bytes);
        assert_eq!(hex, "deadbeef");

        let decoded = hex_to_bytes(&hex).unwrap();
        assert_eq!(decoded, bytes);
    }

    #[test]
    fn test_create_test_address() {
        let addr = create_test_address();
        assert!(addr.starts_with("tm")); // Testnet transparent prefix
        assert!(addr.len() > 20); // Reasonable length check
    }
}
