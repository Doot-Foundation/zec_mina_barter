// Mock implementations for external services
//
// This module provides mock servers and client implementations for:
// - Zcashd RPC server (JSON-RPC over HTTP)
// - Lightwalletd gRPC server (CompactTxStreamer)
// - Mock wallet database responses
//
// These mocks enable isolated testing without real blockchain dependencies.

use mockito::{Mock, Server, ServerGuard};
use serde_json::json;
use std::sync::Arc;
use tokio::sync::Mutex;

/// Mock Zcashd RPC server
///
/// Provides a test HTTP server that mimics zcashd's JSON-RPC interface.
/// Supports configurable responses for different RPC methods.
pub struct MockZcashdServer {
    pub server: ServerGuard,
    mocks: Vec<Mock>,
}

impl MockZcashdServer {
    /// Creates a new mock zcashd server
    pub async fn new() -> Self {
        let server = Server::new_async().await;
        Self {
            server,
            mocks: Vec::new(),
        }
    }

    /// Returns the base URL for this mock server
    pub fn url(&self) -> String {
        self.server.url()
    }

    /// Mocks a successful sendrawtransaction response
    ///
    /// # Arguments
    /// * `tx_hex` - The raw transaction hex to expect
    /// * `txid` - The transaction ID to return
    pub async fn mock_send_raw_transaction(&mut self, tx_hex: &str, txid: &str) -> &mut Self {
        let mock = self
            .server
            .mock("POST", "/")
            .match_header("content-type", "application/json")
            .match_body(mockito::Matcher::JsonString(
                json!({
                    "jsonrpc": "1.0",
                    "method": "sendrawtransaction",
                    "params": [tx_hex],
                    "id": "escrowd"
                })
                .to_string(),
            ))
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(
                json!({
                    "result": txid,
                    "error": null,
                    "id": "escrowd"
                })
                .to_string(),
            )
            .create_async()
            .await;

        self.mocks.push(mock);
        self
    }

    /// Mocks a failed sendrawtransaction response
    ///
    /// # Arguments
    /// * `error_code` - RPC error code (e.g., -25 for missing inputs)
    /// * `error_message` - Human-readable error message
    pub async fn mock_send_raw_transaction_error(
        &mut self,
        error_code: i32,
        error_message: &str,
    ) -> &mut Self {
        let mock = self
            .server
            .mock("POST", "/")
            .match_header("content-type", "application/json")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(
                json!({
                    "result": null,
                    "error": {
                        "code": error_code,
                        "message": error_message
                    },
                    "id": "escrowd"
                })
                .to_string(),
            )
            .create_async()
            .await;

        self.mocks.push(mock);
        self
    }

    /// Mocks a network error (connection refused)
    pub async fn mock_network_error(&mut self) -> &mut Self {
        let mock = self
            .server
            .mock("POST", "/")
            .with_status(503) // Service unavailable
            .create_async()
            .await;

        self.mocks.push(mock);
        self
    }

    /// Mocks getblockchaininfo response
    pub async fn mock_get_blockchain_info(&mut self, height: u64, blocks: u64) -> &mut Self {
        let mock = self
            .server
            .mock("POST", "/")
            .match_body(mockito::Matcher::PartialJsonString(
                json!({
                    "method": "getblockchaininfo"
                })
                .to_string(),
            ))
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(
                json!({
                    "result": {
                        "chain": "test",
                        "blocks": blocks,
                        "headers": height,
                        "bestblockhash": "0000000000000000000000000000000000000000000000000000000000000000",
                        "difficulty": 1.0,
                        "verificationprogress": 1.0,
                        "chainwork": "0000000000000000000000000000000000000000000000000000000000000000"
                    },
                    "error": null,
                    "id": "escrowd"
                })
                .to_string(),
            )
            .create_async()
            .await;

        self.mocks.push(mock);
        self
    }

    /// Verifies that all expected mock calls were made
    pub fn assert_all_called(&self) {
        for mock in &self.mocks {
            mock.assert();
        }
    }
}

/// Mock Lightwalletd gRPC server
///
/// Provides a test gRPC server that mimics lightwalletd's CompactTxStreamer service.
/// Note: This is a simplified mock - full gRPC mocking would require tonic-mock or similar.
pub struct MockLightwalletdServer {
    pub base_url: String,
    // In a real implementation, this would be a tonic server
    // For now, we'll use HTTP mocks for the gRPC-Web gateway
}

impl MockLightwalletdServer {
    /// Creates a new mock lightwalletd server
    pub fn new(base_url: String) -> Self {
        Self { base_url }
    }

    /// Returns mock compact blocks for a given height range
    pub fn mock_compact_blocks(&self, start_height: u64, end_height: u64) -> Vec<MockCompactBlock> {
        (start_height..=end_height)
            .map(|height| MockCompactBlock {
                height,
                hash: vec![0u8; 32],
                prev_hash: vec![0u8; 32],
                time: 1600000000 + (height * 150), // ~2.5 min blocks
                vtx: vec![],
            })
            .collect()
    }

    /// Returns mock compact blocks with a specific transaction
    pub fn mock_compact_blocks_with_tx(
        &self,
        height: u64,
        tx_hash: Vec<u8>,
    ) -> Vec<MockCompactBlock> {
        vec![MockCompactBlock {
            height,
            hash: vec![0u8; 32],
            prev_hash: vec![0u8; 32],
            time: 1600000000 + (height * 150),
            vtx: vec![MockCompactTx {
                index: 0,
                hash: tx_hash,
                outputs: vec![],
            }],
        }]
    }
}

/// Mock compact block structure
#[derive(Debug, Clone)]
pub struct MockCompactBlock {
    pub height: u64,
    pub hash: Vec<u8>,
    pub prev_hash: Vec<u8>,
    pub time: u64,
    pub vtx: Vec<MockCompactTx>,
}

/// Mock compact transaction structure
#[derive(Debug, Clone)]
pub struct MockCompactTx {
    pub index: u64,
    pub hash: Vec<u8>,
    pub outputs: Vec<MockCompactOutput>,
}

/// Mock compact output structure
#[derive(Debug, Clone)]
pub struct MockCompactOutput {
    pub cmu: Vec<u8>,
    pub epk: Vec<u8>,
    pub ciphertext: Vec<u8>,
}

/// Mock wallet database
///
/// Provides an in-memory mock of zcash_client_sqlite::WalletDb
/// for testing wallet operations without a real database.
pub struct MockWalletDb {
    pub accounts: Arc<Mutex<Vec<MockAccount>>>,
    pub notes: Arc<Mutex<Vec<MockNote>>>,
    pub transactions: Arc<Mutex<Vec<MockTransaction>>>,
}

impl MockWalletDb {
    /// Creates a new empty mock wallet database
    pub fn new() -> Self {
        Self {
            accounts: Arc::new(Mutex::new(Vec::new())),
            notes: Arc::new(Mutex::new(Vec::new())),
            transactions: Arc::new(Mutex::new(Vec::new())),
        }
    }

    /// Adds a mock account
    pub async fn add_account(&self, account: MockAccount) {
        self.accounts.lock().await.push(account);
    }

    /// Adds a mock received note
    pub async fn add_note(&self, note: MockNote) {
        self.notes.lock().await.push(note);
    }

    /// Returns all notes with matching memo
    pub async fn get_notes_with_memo(&self, memo_prefix: &str) -> Vec<MockNote> {
        self.notes
            .lock()
            .await
            .iter()
            .filter(|note| note.memo.starts_with(memo_prefix))
            .cloned()
            .collect()
    }

    /// Returns total balance
    pub async fn get_balance(&self) -> u64 {
        self.notes
            .lock()
            .await
            .iter()
            .filter(|note| !note.spent)
            .map(|note| note.value)
            .sum()
    }
}

/// Mock account structure
#[derive(Debug, Clone)]
pub struct MockAccount {
    pub account_id: u32,
    pub ufvk: String,
    pub birthday: u64,
}

/// Mock received note structure
#[derive(Debug, Clone)]
pub struct MockNote {
    pub note_id: u64,
    pub txid: Vec<u8>,
    pub output_index: u32,
    pub account_id: u32,
    pub value: u64,
    pub memo: String,
    pub spent: bool,
    pub confirmed_height: Option<u64>,
}

/// Mock transaction structure
#[derive(Debug, Clone)]
pub struct MockTransaction {
    pub txid: Vec<u8>,
    pub block_height: Option<u64>,
    pub tx_index: Option<u32>,
    pub raw: Vec<u8>,
}

impl Default for MockWalletDb {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_mock_zcashd_send_raw_transaction() {
        let mut mock_server = MockZcashdServer::new().await;
        let test_txid = "abcd1234".to_string();

        mock_server
            .mock_send_raw_transaction("deadbeef", &test_txid)
            .await;

        // In actual tests, this would be called by the zcashd client
        // mock_server.assert_all_called();
    }

    #[tokio::test]
    async fn test_mock_lightwalletd_compact_blocks() {
        let mock_server = MockLightwalletdServer::new("http://localhost:19067".to_string());
        let blocks = mock_server.mock_compact_blocks(1000, 1010);

        assert_eq!(blocks.len(), 11);
        assert_eq!(blocks[0].height, 1000);
        assert_eq!(blocks[10].height, 1010);
    }

    #[tokio::test]
    async fn test_mock_wallet_db() {
        let db = MockWalletDb::new();

        db.add_note(MockNote {
            note_id: 1,
            txid: vec![1, 2, 3, 4],
            output_index: 0,
            account_id: 0,
            value: 100_000_000, // 1 ZEC
            memo: "test:mina:Alice".to_string(),
            spent: false,
            confirmed_height: Some(1000),
        })
        .await;

        let balance = db.get_balance().await;
        assert_eq!(balance, 100_000_000);

        let memos = db.get_notes_with_memo("test:mina:").await;
        assert_eq!(memos.len(), 1);
        assert_eq!(memos[0].memo, "test:mina:Alice");
    }
}
