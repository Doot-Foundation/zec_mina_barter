use crate::error::AppError;
use crate::key::FeePolicy;
use crate::state::OriginType;
use crate::zcashd::{SpendSource, ZcashdRpcClient};
use base64::Engine;
use base64::engine::general_purpose::STANDARD as BASE64;
use bitcoin::VarInt;
use bitcoin::consensus::Encodable;
use bitcoin::hashes::{Hash, hash160, sha256d};
use bitcoin::secp256k1::ecdsa::{RecoverableSignature, RecoveryId};
use bitcoin::secp256k1::{Message as SecpMessage, Secp256k1};
use zcash_address::{ConversionError, TryFromAddress, ZcashAddress};
use zcash_protocol::consensus::NetworkType;

const ZCASH_SIGNED_MESSAGE_PREFIX: &str = "Zcash Signed Message:\n";

#[derive(Clone)]
#[allow(dead_code)]
pub struct Wallet {
    ufvk: String,
    rpc: ZcashdRpcClient,
    source_type: OriginType,
    address: String,
}

impl Wallet {
    pub async fn create(
        ufvk: String,
        rpc: ZcashdRpcClient,
        source_type: OriginType,
    ) -> Result<Self, AppError> {
        let address = match source_type {
            OriginType::Shielded => rpc.new_sapling_address().await?,
            OriginType::Transparent => rpc.new_transparent_address().await?,
        };
        tracing::info!(
            "{} wallet created addr={} source_type={:?}",
            crate::logging::tags::INFO,
            address,
            source_type
        );
        Ok(Self {
            ufvk,
            rpc,
            source_type,
            address,
        })
    }

    pub fn address(&self) -> &str {
        &self.address
    }

    pub fn rpc(&self) -> &ZcashdRpcClient {
        &self.rpc
    }

    /// Placeholder: build and broadcast a sweep tx using stored keys and witnesses.
    pub async fn sweep_full_balance(
        &self,
        destination: &str,
        _fee_policy: &FeePolicy,
    ) -> Result<String, AppError> {
        let source = match self.source_type {
            OriginType::Shielded => SpendSource::Shielded,
            OriginType::Transparent => SpendSource::Transparent,
        };
        let balance = self.rpc.get_balance(source.clone(), &self.address).await?;
        if balance <= 0.0 {
            tracing::warn!(
                "{} no balance to sweep addr={}",
                crate::logging::tags::WARNING,
                self.address
            );
            return Err(AppError::Wallet("no balance to sweep".into()));
        }
        let amount = (balance - 0.0001).max(0.0);
        if amount <= 0.0 {
            tracing::warn!(
                "{} balance too low for fee addr={} balance={}",
                crate::logging::tags::WARNING,
                self.address,
                balance
            );
            return Err(AppError::Wallet("balance too low for fee".into()));
        }
        tracing::info!(
            "{} sweep start addr={} dest={} amount={}",
            crate::logging::tags::INFO,
            self.address,
            destination,
            amount
        );
        let txid = self
            .rpc
            .send_full_balance(source, &self.address, destination, amount)
            .await?;
        tracing::info!(
            "{} sweep complete addr={} dest={} txid={}",
            crate::logging::tags::SUCCESS,
            self.address,
            destination,
            txid
        );
        Ok(txid)
    }

    /// Verify a transparent address signed message (compact signature, base64), using Zcash message prefix.
    pub fn verify_transparent_signed_message(
        &self,
        taddr: &str,
        message: &str,
        signature_b64: &str,
    ) -> Result<(), AppError> {
        let pkh = transparent_pkh_from_taddr(taddr)?;
        let sig_bytes = BASE64
            .decode(signature_b64.as_bytes())
            .map_err(|_| AppError::Unauthorized)?;
        if sig_bytes.len() != 65 {
            return Err(AppError::Unauthorized);
        }
        let header = sig_bytes[0];
        if header < 27 || header > 34 {
            return Err(AppError::Unauthorized);
        }
        let rec_id = RecoveryId::from_i32(((header - 27) & 0x03) as i32)
            .map_err(|_| AppError::Unauthorized)?;
        let sig = RecoverableSignature::from_compact(&sig_bytes[1..], rec_id)
            .map_err(|_| AppError::Unauthorized)?;

        let digest = signed_message_hash(message);
        let msg = SecpMessage::from_digest_slice(&digest).map_err(|_| AppError::Unauthorized)?;
        let secp = Secp256k1::new();
        let pubkey = secp
            .recover_ecdsa(&msg, &sig)
            .map_err(|_| AppError::Unauthorized)?;
        let derived_pkh = hash160::Hash::hash(&pubkey.serialize());
        if derived_pkh.to_byte_array() == pkh {
            tracing::info!(
                "{} transparent signature verified taddr={}",
                crate::logging::tags::SUCCESS,
                taddr
            );
            Ok(())
        } else {
            tracing::warn!(
                "{} transparent signature mismatch taddr={}",
                crate::logging::tags::WARNING,
                taddr
            );
            Err(AppError::Unauthorized)
        }
    }
}

fn signed_message_hash(message: &str) -> [u8; 32] {
    let mut data = Vec::new();
    data.extend_from_slice(&encode_varint_prefix(
        ZCASH_SIGNED_MESSAGE_PREFIX.as_bytes(),
    ));
    data.extend_from_slice(ZCASH_SIGNED_MESSAGE_PREFIX.as_bytes());
    data.extend_from_slice(&encode_varint_prefix(message.as_bytes()));
    data.extend_from_slice(message.as_bytes());
    let first = sha256d::Hash::hash(&data);
    first.to_byte_array()
}

fn encode_varint_prefix(bytes: &[u8]) -> Vec<u8> {
    let vi = VarInt(bytes.len() as u64);
    let mut buf = Vec::new();
    vi.consensus_encode(&mut buf)
        .expect("vec write cannot fail");
    buf
}

fn transparent_pkh_from_taddr(taddr: &str) -> Result<[u8; 20], AppError> {
    let addr = ZcashAddress::try_from_encoded(taddr).map_err(|_| AppError::Unauthorized)?;
    let extracted: TransparentP2pkh = addr
        .convert_if_network::<TransparentP2pkh>(NetworkType::Test)
        .map_err(|_| AppError::Unauthorized)?;
    Ok(extracted.0)
}

#[derive(Clone, Debug)]
struct TransparentP2pkh([u8; 20]);

impl TryFromAddress for TransparentP2pkh {
    type Error = ();

    fn try_from_transparent_p2pkh(
        net: NetworkType,
        data: [u8; 20],
    ) -> Result<Self, ConversionError<Self::Error>> {
        if net != NetworkType::Test {
            return Err(ConversionError::IncorrectNetwork {
                expected: NetworkType::Test,
                actual: net,
            });
        }
        Ok(TransparentP2pkh(data))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use mockito;

    async fn create_mock_zcashd(response_body: serde_json::Value) -> (mockito::ServerGuard, ZcashdRpcClient) {
        let mut server = mockito::Server::new_async().await;
        let _m = server
            .mock("POST", "/")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(response_body.to_string())
            .create_async()
            .await;

        let rpc = ZcashdRpcClient::new(
            server.url(),
            "zcashrpc".to_string(),
            "changeme".to_string(),
        );

        (server, rpc)
    }

    #[tokio::test]
    async fn test_wallet_create_shielded_success() {
        let response_body = serde_json::json!({
            "result": "zs1z7rejlpsa98s2rrrfkwmaxu53e4ue0ulcrw0h4x5g8jl04tak0d3mm47vdtahatqrlkngh9slya",
            "error": null,
            "id": "escrowd"
        });

        let (_server, rpc) = create_mock_zcashd(response_body).await;

        let wallet = Wallet::create(
            "uview1test".to_string(),
            rpc,
            OriginType::Shielded,
        )
        .await;

        assert!(wallet.is_ok());
        let w = wallet.unwrap();
        assert!(w.address().starts_with("zs1"));
        assert_eq!(w.ufvk, "uview1test");
    }

    #[tokio::test]
    async fn test_wallet_create_transparent_success() {
        let response_body = serde_json::json!({
            "result": "tmYXBYJj1K7vhNWkZZR1E6MKJq1FMGPTq1b",
            "error": null,
            "id": "escrowd"
        });

        let (_server, rpc) = create_mock_zcashd(response_body).await;

        let wallet = Wallet::create(
            "uview1test".to_string(),
            rpc,
            OriginType::Transparent,
        )
        .await;

        assert!(wallet.is_ok());
        let w = wallet.unwrap();
        assert!(w.address().starts_with("tm"));
        assert_eq!(w.ufvk, "uview1test");
    }

    #[tokio::test]
    async fn test_wallet_address_getter() {
        let response_body = serde_json::json!({
            "result": "tmYXBYJj1K7vhNWkZZR1E6MKJq1FMGPTq1b",
            "error": null,
            "id": "escrowd"
        });

        let (_server, rpc) = create_mock_zcashd(response_body).await;
        let wallet = Wallet::create("uview1test".to_string(), rpc, OriginType::Transparent)
            .await
            .unwrap();

        assert_eq!(wallet.address(), "tmYXBYJj1K7vhNWkZZR1E6MKJq1FMGPTq1b");
    }

    #[tokio::test]
    async fn test_sweep_full_balance_success() {
        let mut server = mockito::Server::new_async().await;

        // First call: new_transparent_address
        let addr_response = serde_json::json!({
            "result": "tmYXBYJj1K7vhNWkZZR1E6MKJq1FMGPTq1b",
            "error": null,
            "id": "escrowd"
        });

        // Second call: get_balance (listunspent)
        let balance_response = serde_json::json!({
            "result": [
                {
                    "txid": "5e78e6e5e10a3e2e5e7e8e9e0e1e2e3e4e5e6e7e8e9e0e1e2e3e4e5e6e7e8e9e0",
                    "vout": 0,
                    "address": "tmYXBYJj1K7vhNWkZZR1E6MKJq1FMGPTq1b",
                    "amount": 1.0,
                    "confirmations": 10
                }
            ],
            "error": null,
            "id": "escrowd"
        });

        // Third call: send_full_balance (z_sendmany)
        let opid_response = serde_json::json!({
            "result": "opid-12345-abcde",
            "error": null,
            "id": "escrowd"
        });

        // Fourth call: z_getoperationstatus
        let status_response = serde_json::json!({
            "result": [
                {
                    "id": "opid-12345-abcde",
                    "status": "success",
                    "result": {
                        "txid": "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2"
                    }
                }
            ],
            "error": null,
            "id": "escrowd"
        });

        // Fifth call: z_getoperationresult (cleanup)
        let cleanup_response = serde_json::json!({
            "result": [],
            "error": null,
            "id": "escrowd"
        });

        let _m1 = server.mock("POST", "/").with_status(200).with_body(addr_response.to_string()).create_async().await;
        let _m2 = server.mock("POST", "/").with_status(200).with_body(balance_response.to_string()).create_async().await;
        let _m3 = server.mock("POST", "/").with_status(200).with_body(opid_response.to_string()).create_async().await;
        let _m4 = server.mock("POST", "/").with_status(200).with_body(status_response.to_string()).create_async().await;
        let _m5 = server.mock("POST", "/").with_status(200).with_body(cleanup_response.to_string()).create_async().await;

        let rpc = ZcashdRpcClient::new(server.url(), "zcashrpc".to_string(), "changeme".to_string());
        let wallet = Wallet::create("uview1test".to_string(), rpc, OriginType::Transparent)
            .await
            .unwrap();

        let fee_policy = FeePolicy {
            bump_on_timeout: 1.5,
            max_multiplier: 5.0,
        };

        let result = wallet
            .sweep_full_balance("tmDestinationAddress123456789", &fee_policy)
            .await;

        assert!(result.is_ok());
        assert_eq!(result.unwrap(), "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2");
    }

    #[tokio::test]
    async fn test_sweep_full_balance_zero_balance() {
        let mut server = mockito::Server::new_async().await;

        let addr_response = serde_json::json!({
            "result": "tmYXBYJj1K7vhNWkZZR1E6MKJq1FMGPTq1b",
            "error": null,
            "id": "escrowd"
        });

        let balance_response = serde_json::json!({
            "result": [],
            "error": null,
            "id": "escrowd"
        });

        let _m1 = server.mock("POST", "/").with_status(200).with_body(addr_response.to_string()).create_async().await;
        let _m2 = server.mock("POST", "/").with_status(200).with_body(balance_response.to_string()).create_async().await;

        let rpc = ZcashdRpcClient::new(server.url(), "zcashrpc".to_string(), "changeme".to_string());
        let wallet = Wallet::create("uview1test".to_string(), rpc, OriginType::Transparent)
            .await
            .unwrap();

        let fee_policy = FeePolicy {
            bump_on_timeout: 1.5,
            max_multiplier: 5.0,
        };

        let result = wallet
            .sweep_full_balance("tmDestinationAddress123456789", &fee_policy)
            .await;

        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("no balance to sweep"));
    }

    #[tokio::test]
    async fn test_sweep_full_balance_too_low_for_fee() {
        let mut server = mockito::Server::new_async().await;

        let addr_response = serde_json::json!({
            "result": "tmYXBYJj1K7vhNWkZZR1E6MKJq1FMGPTq1b",
            "error": null,
            "id": "escrowd"
        });

        let balance_response = serde_json::json!({
            "result": [
                {
                    "txid": "5e78e6e5e10a3e2e5e7e8e9e0e1e2e3e4e5e6e7e8e9e0e1e2e3e4e5e6e7e8e9e0",
                    "vout": 0,
                    "address": "tmYXBYJj1K7vhNWkZZR1E6MKJq1FMGPTq1b",
                    "amount": 0.00005,
                    "confirmations": 10
                }
            ],
            "error": null,
            "id": "escrowd"
        });

        let _m1 = server.mock("POST", "/").with_status(200).with_body(addr_response.to_string()).create_async().await;
        let _m2 = server.mock("POST", "/").with_status(200).with_body(balance_response.to_string()).create_async().await;

        let rpc = ZcashdRpcClient::new(server.url(), "zcashrpc".to_string(), "changeme".to_string());
        let wallet = Wallet::create("uview1test".to_string(), rpc, OriginType::Transparent)
            .await
            .unwrap();

        let fee_policy = FeePolicy {
            bump_on_timeout: 1.5,
            max_multiplier: 5.0,
        };

        let result = wallet
            .sweep_full_balance("tmDestinationAddress123456789", &fee_policy)
            .await;

        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("balance too low for fee"));
    }

    #[test]
    fn test_verify_transparent_signed_message_invalid_base64() {
        let wallet = Wallet {
            ufvk: "uview1test".to_string(),
            rpc: ZcashdRpcClient::new(
                "http://127.0.0.1:18232".to_string(),
                "user".to_string(),
                "pass".to_string(),
            ),
            source_type: OriginType::Transparent,
            address: "tmYXBYJj1K7vhNWkZZR1E6MKJq1FMGPTq1b".to_string(),
        };

        let result = wallet.verify_transparent_signed_message(
            "tmYXBYJj1K7vhNWkZZR1E6MKJq1FMGPTq1b",
            "test message",
            "invalid!!!base64",
        );

        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), AppError::Unauthorized));
    }

    #[test]
    fn test_verify_transparent_signed_message_wrong_length() {
        let wallet = Wallet {
            ufvk: "uview1test".to_string(),
            rpc: ZcashdRpcClient::new(
                "http://127.0.0.1:18232".to_string(),
                "user".to_string(),
                "pass".to_string(),
            ),
            source_type: OriginType::Transparent,
            address: "tmYXBYJj1K7vhNWkZZR1E6MKJq1FMGPTq1b".to_string(),
        };

        // Base64 encoding of 32 bytes (wrong length, should be 65)
        let short_sig = BASE64.encode(vec![0u8; 32]);

        let result = wallet.verify_transparent_signed_message(
            "tmYXBYJj1K7vhNWkZZR1E6MKJq1FMGPTq1b",
            "test message",
            &short_sig,
        );

        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), AppError::Unauthorized));
    }

    #[test]
    fn test_verify_transparent_signed_message_invalid_header() {
        let wallet = Wallet {
            ufvk: "uview1test".to_string(),
            rpc: ZcashdRpcClient::new(
                "http://127.0.0.1:18232".to_string(),
                "user".to_string(),
                "pass".to_string(),
            ),
            source_type: OriginType::Transparent,
            address: "tmYXBYJj1K7vhNWkZZR1E6MKJq1FMGPTq1b".to_string(),
        };

        // Create signature with invalid header (outside 27-34 range)
        let mut sig_bytes = vec![50u8]; // Invalid header
        sig_bytes.extend_from_slice(&[0u8; 64]);
        let invalid_sig = BASE64.encode(sig_bytes);

        let result = wallet.verify_transparent_signed_message(
            "tmYXBYJj1K7vhNWkZZR1E6MKJq1FMGPTq1b",
            "test message",
            &invalid_sig,
        );

        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), AppError::Unauthorized));
    }

    #[test]
    fn test_verify_transparent_signed_message_invalid_address() {
        let wallet = Wallet {
            ufvk: "uview1test".to_string(),
            rpc: ZcashdRpcClient::new(
                "http://127.0.0.1:18232".to_string(),
                "user".to_string(),
                "pass".to_string(),
            ),
            source_type: OriginType::Transparent,
            address: "tmYXBYJj1K7vhNWkZZR1E6MKJq1FMGPTq1b".to_string(),
        };

        let mut sig_bytes = vec![27u8];
        sig_bytes.extend_from_slice(&[0u8; 64]);
        let sig = BASE64.encode(sig_bytes);

        let result = wallet.verify_transparent_signed_message(
            "not-a-valid-address",
            "test message",
            &sig,
        );

        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), AppError::Unauthorized));
    }

    #[test]
    fn test_signed_message_hash_format() {
        let message = "test message";
        let hash = signed_message_hash(message);

        // Hash should be 32 bytes
        assert_eq!(hash.len(), 32);

        // Hash should be deterministic
        let hash2 = signed_message_hash(message);
        assert_eq!(hash, hash2);

        // Different messages should produce different hashes
        let hash3 = signed_message_hash("different message");
        assert_ne!(hash, hash3);
    }

    #[test]
    fn test_encode_varint_prefix_small() {
        let data = b"test";
        let encoded = encode_varint_prefix(data);

        // VarInt for length 4 should be single byte: 0x04
        assert_eq!(encoded, vec![0x04]);
    }

    #[test]
    fn test_encode_varint_prefix_medium() {
        let data = vec![0u8; 300];
        let encoded = encode_varint_prefix(&data);

        // VarInt for 300 (0x012C) should be: 0xFD 0x2C 0x01 (little-endian)
        assert_eq!(encoded, vec![0xFD, 0x2C, 0x01]);
    }

    #[test]
    fn test_signed_message_hash_deterministic() {
        // Test that the same message always produces the same hash
        let message1 = "swap-transaction-12345";
        let hash1 = signed_message_hash(message1);
        let hash2 = signed_message_hash(message1);

        assert_eq!(hash1, hash2);
        assert_eq!(hash1.len(), 32);

        // Different message should produce different hash
        let message2 = "swap-transaction-67890";
        let hash3 = signed_message_hash(message2);
        assert_ne!(hash1, hash3);
    }

    #[test]
    fn test_transparent_pkh_from_taddr_invalid() {
        let invalid_addr = "not-a-valid-address";
        let result = transparent_pkh_from_taddr(invalid_addr);

        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), AppError::Unauthorized));
    }

    #[test]
    fn test_transparent_pkh_from_taddr_shielded_address_fails() {
        let zaddr = "zs1z7rejlpsa98s2rrrfkwmaxu53e4ue0ulcrw0h4x5g8jl04tak0d3mm47vdtahatqrlkngh9slya";
        let result = transparent_pkh_from_taddr(zaddr);

        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), AppError::Unauthorized));
    }
}
