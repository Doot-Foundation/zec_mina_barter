use crate::config::Config;
use crate::error::AppError;
use crate::key::KeyManager;
use crate::mina::MinaClient;
use crate::wallet::Wallet;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use serde_json;
use std::fs;
use std::path::PathBuf;
use std::sync::Arc;

pub type SharedState = Arc<AppState>;

#[derive(Clone)]
pub struct AppState {
    pub config: Config,
    pub key_manager: KeyManager,
    pub wallet: Wallet,
    pub mina_client: MinaClient,
    runtime: Arc<Mutex<RuntimeState>>,
    state_path: PathBuf,
}

#[derive(Debug)]
struct RuntimeState {
    verified: bool,
    in_transit: bool,
    origin: Option<OriginBinding>,
    send_in_progress: bool,
    mina_tx_hash: Option<String>,
}

#[derive(Default, Serialize, Deserialize)]
struct PersistedState {
    verified: bool,
    in_transit: bool,
    origin: Option<OriginBinding>,
    mina_tx_hash: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub enum OriginType {
    Shielded,
    Transparent,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct OriginBinding {
    pub origin_type: OriginType,
    pub origin_address: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct StatusSnapshot {
    pub status: String,
    pub verified: bool,
    pub in_transit: bool,
    pub origin: Option<OriginBinding>,
    pub mina_tx_hash: Option<String>,
}

pub struct SendGuard {
    state: SharedState,
    active: bool,
}

impl AppState {
    pub fn new(
        config: Config,
        key_manager: KeyManager,
        wallet: Wallet,
        mina_client: MinaClient,
    ) -> SharedState {
        let state_path = config.data_dir.join("state.json");
        let persisted = load_state(&state_path).unwrap_or_default();
        let runtime = RuntimeState {
            verified: persisted.verified,
            in_transit: persisted.in_transit,
            origin: persisted.origin,
            send_in_progress: false,
            mina_tx_hash: persisted.mina_tx_hash,
        };

        Arc::new(Self {
            config,
            key_manager,
            wallet,
            mina_client,
            runtime: Arc::new(Mutex::new(runtime)),
            state_path,
        })
    }

    pub fn status(&self) -> StatusSnapshot {
        let rt = self.runtime.lock();
        StatusSnapshot {
            status: if rt.verified {
                "active".to_string()
            } else {
                "inactive".to_string()
            },
            verified: rt.verified,
            in_transit: rt.in_transit,
            origin: rt.origin.clone(),
            mina_tx_hash: rt.mina_tx_hash.clone(),
        }
    }

    pub fn bind_origin(&self, binding: OriginBinding) -> Result<(), AppError> {
        let mut rt = self.runtime.lock();
        if rt.origin.is_some() {
            tracing::warn!("{} origin already bound", crate::logging::tags::WARNING);
            return Err(AppError::AlreadyBound);
        }
        rt.origin = Some(binding);
        rt.verified = true;
        let _ = persist_state(&self.state_path, &rt);
        tracing::info!(
            "{} origin bound verified={} in_transit={}",
            crate::logging::tags::INFO,
            rt.verified,
            rt.in_transit
        );
        Ok(())
    }

    pub fn origin(&self) -> Option<OriginBinding> {
        let rt = self.runtime.lock();
        rt.origin.clone()
    }

    pub fn ensure_verified(&self) -> Result<(), AppError> {
        let rt = self.runtime.lock();
        if rt.verified {
            Ok(())
        } else {
            Err(AppError::NotVerified)
        }
    }

    pub fn in_transit(&self) -> bool {
        let rt = self.runtime.lock();
        rt.in_transit
    }

    pub fn set_in_transit(
        &self,
        value: bool,
        mina_tx_hash: Option<String>,
    ) -> Result<(), AppError> {
        let mut rt = self.runtime.lock();
        if rt.send_in_progress {
            return Err(AppError::Busy);
        }
        if value && !rt.verified {
            return Err(AppError::NotVerified);
        }
        rt.in_transit = value;
        rt.mina_tx_hash = if value { mina_tx_hash } else { None };
        persist_state(&self.state_path, &rt)?;
        tracing::info!(
            "{} in_transit set to {} verified={}",
            crate::logging::tags::INFO,
            value,
            rt.verified
        );
        Ok(())
    }

    pub fn begin_send(self: &SharedState) -> Result<SendGuard, AppError> {
        let mut rt = self.runtime.lock();
        if rt.send_in_progress {
            return Err(AppError::Busy);
        }
        rt.send_in_progress = true;
        tracing::info!("{} send_guard acquired", crate::logging::tags::INFO);
        Ok(SendGuard {
            state: self.clone(),
            active: true,
        })
    }

    pub fn ensure_api_key(&self, provided: &str) -> Result<(), AppError> {
        if self.config.api_key == provided {
            Ok(())
        } else {
            Err(AppError::Unauthorized)
        }
    }
}

impl Drop for SendGuard {
    fn drop(&mut self) {
        if self.active {
            let mut rt = self.state.runtime.lock();
            rt.send_in_progress = false;
            let _ = persist_state(&self.state.state_path, &rt);
        }
    }
}

fn load_state(path: &PathBuf) -> Result<PersistedState, AppError> {
    if !path.exists() {
        return Ok(PersistedState::default());
    }
    let data = fs::read(path)?;
    let state: PersistedState = serde_json::from_slice(&data)?;
    Ok(state)
}

fn persist_state(path: &PathBuf, rt: &RuntimeState) -> Result<(), AppError> {
    let state = PersistedState {
        verified: rt.verified,
        in_transit: rt.in_transit,
        origin: rt.origin.clone(),
        mina_tx_hash: rt.mina_tx_hash.clone(),
    };
    let json = serde_json::to_vec_pretty(&state)?;
    fs::write(path, json)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::AddressType;
    use crate::zcashd::ZcashdRpcClient;
    use tempfile::TempDir;

    // Helper to create a test config with temporary directory
    fn test_config(temp_dir: &TempDir) -> Config {
        Config {
            listen_addr: "127.0.0.1:8423".parse().unwrap(),
            data_dir: temp_dir.path().to_path_buf(),
            escrow_address_type: AddressType::Shielded,
            mina_endpoint: "https://devnet.zeko.io/graphql".to_string(),
            mina_to_pubkey: "B62qod2DugDjy9Jxhzd56gFS7npN8pWhanxxb36MLPzDDqtzzDyBy5z".to_string(),
            api_key: "sk_test_abc123_secret_key".to_string(),
            fee_cap_multiplier: 5.0,
            funding_min_zec: 0.001,
            mina_min_amount: 0.1,
            operator_token: Some("operator_secret_xyz".to_string()),
            zcashd_rpc_url: "http://localhost:18232".to_string(),
            zcashd_rpc_user: "zcashrpc".to_string(),
            zcashd_rpc_pass: "changeme".to_string(),
        }
    }

    // Helper to create a test AppState with mocked zcashd
    async fn test_state(temp_dir: &TempDir) -> (SharedState, mockito::ServerGuard) {
        let config = test_config(temp_dir);
        let key_manager = KeyManager::init(&config).unwrap();

        // Create a mock zcashd server
        let mut server = mockito::Server::new_async().await;
        let zcashd_url = server.url();

        // Mock the zcashd RPC call that Wallet::create makes
        let _m = server
            .mock("POST", "/")
            .with_status(200)
            .with_body(r#"{"result":"zs1mockedaddress","error":null,"id":"1"}"#)
            .create_async()
            .await;

        let zcashd = ZcashdRpcClient::new(
            zcashd_url,
            "zcashrpc".to_string(),
            "changeme".to_string(),
        );

        let wallet = Wallet::create(
            key_manager.unified_full_viewing_key().to_string(),
            zcashd,
            OriginType::Shielded,
        )
        .await
        .unwrap();

        let mina_client = MinaClient::new(
            config.mina_endpoint.clone(),
            config.mina_to_pubkey.clone(),
            config.mina_min_amount,
        )
        .unwrap();

        (AppState::new(config, key_manager, wallet, mina_client), server)
    }

    #[tokio::test]
    async fn test_app_state_new_starts_unverified() {
        let temp_dir = TempDir::new().unwrap();
        let (state, _server) = test_state(&temp_dir).await;

        let status = state.status();
        assert!(!status.verified);
        assert_eq!(status.status, "inactive");
        assert!(!status.in_transit);
        assert!(status.origin.is_none());
        assert!(status.mina_tx_hash.is_none());
    }

    #[tokio::test]
    async fn test_bind_origin_sets_verified() {
        let temp_dir = TempDir::new().unwrap();
        let (state, _server) = test_state(&temp_dir).await;

        let binding = OriginBinding {
            origin_type: OriginType::Shielded,
            origin_address: "zs1testaddress1234567890abcdefghijklmnopqrstuvwxyz".to_string(),
        };

        state.bind_origin(binding.clone()).unwrap();

        let status = state.status();
        assert!(status.verified);
        assert_eq!(status.status, "active");
        assert!(status.origin.is_some());

        let origin = state.origin().unwrap();
        assert_eq!(origin.origin_address, binding.origin_address);
    }

    #[tokio::test]
    async fn test_bind_origin_already_bound_fails() {
        let temp_dir = TempDir::new().unwrap();
        let (state, _server) = test_state(&temp_dir).await;

        let binding1 = OriginBinding {
            origin_type: OriginType::Shielded,
            origin_address: "zs1address1".to_string(),
        };

        let binding2 = OriginBinding {
            origin_type: OriginType::Transparent,
            origin_address: "t1address2".to_string(),
        };

        state.bind_origin(binding1).unwrap();

        // Second bind should fail
        let result = state.bind_origin(binding2);
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), AppError::AlreadyBound));
    }

    #[tokio::test]
    async fn test_ensure_verified_checks_status() {
        let temp_dir = TempDir::new().unwrap();
        let (state, _server) = test_state(&temp_dir).await;

        // Should fail when not verified
        let result = state.ensure_verified();
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), AppError::NotVerified));

        // Bind origin to become verified
        state
            .bind_origin(OriginBinding {
                origin_type: OriginType::Shielded,
                origin_address: "zs1test".to_string(),
            })
            .unwrap();

        // Should succeed now
        state.ensure_verified().unwrap();
    }

    #[tokio::test]
    async fn test_set_in_transit_requires_verification() {
        let temp_dir = TempDir::new().unwrap();
        let (state, _server) = test_state(&temp_dir).await;

        // Setting in_transit=true should fail when not verified
        let result = state.set_in_transit(
            true,
            Some("5JuQKyFuVRPt6aBvWVYHRH5K8zvZMX4zN3GpLqYdX2Tw".to_string()),
        );
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), AppError::NotVerified));

        // Setting in_transit=false should work even when not verified
        state.set_in_transit(false, None).unwrap();
    }

    #[tokio::test]
    async fn test_set_in_transit_updates_state() {
        let temp_dir = TempDir::new().unwrap();
        let (state, _server) = test_state(&temp_dir).await;

        // Become verified first
        state
            .bind_origin(OriginBinding {
                origin_type: OriginType::Shielded,
                origin_address: "zs1test".to_string(),
            })
            .unwrap();

        let tx_hash = "5JuQKyFuVRPt6aBvWVYHRH5K8zvZMX4zN3GpLqYdX2Tw".to_string();

        // Set in_transit=true with tx hash
        state.set_in_transit(true, Some(tx_hash.clone())).unwrap();

        let status = state.status();
        assert!(status.in_transit);
        assert_eq!(status.mina_tx_hash, Some(tx_hash));

        // Clear in_transit
        state.set_in_transit(false, None).unwrap();

        let status = state.status();
        assert!(!status.in_transit);
        assert!(status.mina_tx_hash.is_none());
    }

    #[tokio::test]
    async fn test_send_guard_prevents_concurrent_sends() {
        let temp_dir = TempDir::new().unwrap();
        let (state, _server) = test_state(&temp_dir).await;

        // Acquire first guard
        let guard1 = state.begin_send().unwrap();

        // Second attempt should fail with Busy error
        let result = state.begin_send();
        assert!(result.is_err());
        if let Err(e) = result {
            assert!(matches!(e, AppError::Busy));
        }

        // Drop first guard
        drop(guard1);

        // Now we should be able to acquire again
        let _guard2 = state.begin_send().unwrap();
    }

    #[tokio::test]
    async fn test_send_guard_auto_releases_on_drop() {
        let temp_dir = TempDir::new().unwrap();
        let (state, _server) = test_state(&temp_dir).await;

        {
            let _guard = state.begin_send().unwrap();
            // Guard is held in this scope
        }
        // Guard dropped automatically here

        // Should be able to acquire again after guard dropped
        let _guard = state.begin_send().unwrap();
    }

    #[tokio::test]
    async fn test_set_in_transit_blocked_when_send_in_progress() {
        let temp_dir = TempDir::new().unwrap();
        let (state, _server) = test_state(&temp_dir).await;

        // Become verified first
        state
            .bind_origin(OriginBinding {
                origin_type: OriginType::Shielded,
                origin_address: "zs1test".to_string(),
            })
            .unwrap();

        // Can set in_transit before acquiring send guard
        state.set_in_transit(false, None).unwrap();

        // Acquire send guard
        let _guard = state.begin_send().unwrap();

        // set_in_transit should fail while send is in progress
        let result = state.set_in_transit(true, Some("txhash".to_string()));
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), AppError::Busy));
    }

    #[tokio::test]
    async fn test_ensure_api_key_validates_correctly() {
        let temp_dir = TempDir::new().unwrap();
        let (state, _server) = test_state(&temp_dir).await;

        // Correct API key should succeed
        state.ensure_api_key("sk_test_abc123_secret_key").unwrap();

        // Incorrect API key should fail
        let result = state.ensure_api_key("wrong_key");
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), AppError::Unauthorized));
    }

    #[tokio::test]
    async fn test_state_persistence_across_restarts() {
        let temp_dir = TempDir::new().unwrap();

        // First instance
        {
            let (state, _server) = test_state(&temp_dir).await;
            state
                .bind_origin(OriginBinding {
                    origin_type: OriginType::Transparent,
                    origin_address: "t1abc123xyz".to_string(),
                })
                .unwrap();

            state
                .set_in_transit(true, Some("mina_tx_456".to_string()))
                .unwrap();
        }

        // Second instance with same data_dir should load persisted state
        let (state2, _server2) = test_state(&temp_dir).await;
        let status = state2.status();

        assert!(status.verified);
        assert!(status.in_transit);
        assert!(status.origin.is_some());
        assert_eq!(
            status.origin.unwrap().origin_address,
            "t1abc123xyz"
        );
        assert_eq!(status.mina_tx_hash, Some("mina_tx_456".to_string()));
    }

    #[test]
    fn test_load_state_creates_default_when_missing() {
        let temp_dir = TempDir::new().unwrap();
        let path = temp_dir.path().join("nonexistent.json");

        let state = load_state(&path).unwrap();
        assert!(!state.verified);
        assert!(!state.in_transit);
        assert!(state.origin.is_none());
        assert!(state.mina_tx_hash.is_none());
    }
}
