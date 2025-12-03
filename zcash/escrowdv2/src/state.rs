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
