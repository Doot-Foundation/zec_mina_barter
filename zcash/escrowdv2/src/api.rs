use crate::error::AppError;
use crate::key::FeePolicy;
use crate::state::{OriginBinding, OriginType, SharedState, StatusSnapshot};
use axum::extract::{ConnectInfo, State};
use axum::http::HeaderMap;
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use std::net::SocketAddr;
use std::time::Duration;

pub fn build_router(state: SharedState) -> Router {
    Router::new()
        .route("/address", get(get_address))
        .route("/status", get(get_status))
        .route("/funding/shielded", post(funding_shielded))
        .route("/funding/transparent", post(funding_transparent))
        .route("/set-in-transit", post(set_in_transit))
        .route("/send-back", post(send_back))
        .route("/send-target", post(send_target))
        .route("/bind-origin", post(bind_origin))
        .with_state(state)
}

#[derive(Serialize)]
struct AddressResponse {
    ua: String,
}

async fn get_address(State(state): State<SharedState>) -> Json<AddressResponse> {
    tracing::info!("{} address requested", crate::logging::tags::INFO);
    Json(AddressResponse {
        ua: state.wallet.address().to_string(),
    })
}

async fn get_status(State(state): State<SharedState>) -> Json<StatusSnapshot> {
    Json(state.status())
}

#[derive(Deserialize)]
struct InTransitRequest {
    mina_tx_hash: String,
    expected_mina_amount: Option<String>,
    mina_usd: Option<String>,
    zec_usd: Option<String>,
    decimals: Option<u64>,
    _aggregation_timestamp: Option<u64>,
}

#[derive(Serialize)]
struct InTransitResponse {
    in_transit: bool,
    mina_tx_hash: Option<String>,
}

async fn set_in_transit(
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    State(state): State<SharedState>,
    headers: HeaderMap,
    Json(req): Json<InTransitRequest>,
) -> Result<Json<InTransitResponse>, AppError> {
    ensure_localhost(&addr)?;
    ensure_operator(&headers, &state)?;
    state.ensure_verified()?;
    if state.in_transit() {
        return Ok(Json(InTransitResponse {
            in_transit: true,
            mina_tx_hash: state.status().mina_tx_hash,
        }));
    }
    let ok = state.mina_client.verify_tx(&req.mina_tx_hash).await?;
    tracing::info!(
        "{} mina_tx={} in_transit={}",
        crate::logging::tags::INFO,
        req.mina_tx_hash,
        ok
    );
    if ok {
        if let (Some(exp_mina), Some(mina_usd), Some(zec_usd), Some(decimals)) = (
            req.expected_mina_amount.as_ref(),
            req.mina_usd.as_ref(),
            req.zec_usd.as_ref(),
            req.decimals,
        ) {
            let exp_mina_val: f64 = exp_mina.parse().unwrap_or(0.0) / 1e9;
            let mina_usd_val: f64 = mina_usd.parse().unwrap_or(0.0) / decimals as f64;
            let zec_usd_val: f64 = zec_usd.parse().unwrap_or(0.0) / decimals as f64;
            if mina_usd_val > 0.0 && zec_usd_val > 0.0 {
                let price_zec_per_mina = zec_usd_val / mina_usd_val;
                let expected_zec = exp_mina_val * price_zec_per_mina;
                let balance_zats = state.wallet.spendable_balance_zatoshis().await?;
                let balance = balance_zats.into_u64() as f64 / 1e8;
                // Allow 10% slippage
                let min_required = expected_zec * 0.9;
                if balance < min_required {
                    tracing::warn!(
                        "{} insufficient ZEC balance balance={} expected_zec={}",
                        crate::logging::tags::WARNING,
                        balance,
                        expected_zec
                    );
                    return Err(AppError::InsufficientFunds);
                }
            }
        }
    }
    state.set_in_transit(ok, Some(req.mina_tx_hash.clone()))?;
    Ok(Json(InTransitResponse {
        in_transit: ok,
        mina_tx_hash: if ok { Some(req.mina_tx_hash) } else { None },
    }))
}

#[derive(Deserialize)]
struct SendBackRequest {
    api_key: String,
    signed_message: Option<String>,
}

#[derive(Deserialize)]
struct SendTargetRequest {
    target_address: String,
}

#[derive(Serialize)]
struct SendResponse {
    txid: String,
}

#[derive(Deserialize)]
struct BindOriginRequest {
    api_key: String,
    origin_address: String,
    origin_type: OriginType,
}

#[derive(Deserialize)]
struct FundingShieldedRequest {
    api_key: String,
    memo: String,
    origin_address: String,
}

#[derive(Deserialize)]
struct FundingTransparentRequest {
    api_key: String,
    funding_address: String,
    signed_message: String,
}

async fn bind_origin(
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    State(state): State<SharedState>,
    Json(req): Json<BindOriginRequest>,
) -> Result<Json<StatusSnapshot>, AppError> {
    ensure_localhost(&addr)?;
    state.ensure_api_key(&req.api_key)?;
    tracing::info!(
        "{} binding origin manually origin={} origin_type={:?}",
        crate::logging::tags::INFO,
        req.origin_address,
        req.origin_type,
    );
    state.bind_origin(OriginBinding {
        origin_type: req.origin_type,
        origin_address: req.origin_address,
    })?;
    Ok(Json(state.status()))
}

async fn funding_shielded(
    State(state): State<SharedState>,
    Json(req): Json<FundingShieldedRequest>,
) -> Result<Json<StatusSnapshot>, AppError> {
    // High-detail logging for debugging shielded funding flows.
    let line = format!(
        "[escrowdv2] /funding/shielded request api_key={} memo={} origin_address={} min_zec={} escrow_addr={}",
        req.api_key,
        req.memo,
        req.origin_address,
        state.config.funding_min_zec,
        state.wallet.address(),
    );
    eprintln!("{}", line);
    crate::logging::append_trade_log(&line);
    tracing::info!(
        "{} /funding/shielded called api_key={} memo={} origin_address={} min_zec={} escrow_addr={}",
        crate::logging::tags::INFO,
        req.api_key,
        req.memo,
        req.origin_address,
        state.config.funding_min_zec,
        state.wallet.address(),
    );

    state.ensure_api_key(&req.api_key)?;

    // Verify memo matches API key
    if req.memo != req.api_key {
        tracing::warn!(
            "{} shielded funding memo mismatch api_key={} memo={}",
            crate::logging::tags::WARNING,
            req.api_key,
            req.memo
        );
        let line = format!(
            "[escrowdv2] /funding/shielded memo mismatch api_key={} memo={}",
            req.api_key,
            req.memo
        );
        eprintln!("{}", line);
        crate::logging::append_trade_log(&line);
        return Err(AppError::Unauthorized);
    }

    // ON-CHAIN VERIFICATION: Check for received shielded note with matching memo.
    let escrow_addr = state.wallet.address();
    tracing::info!(
        "{} verifying shielded funding on-chain escrow_addr={} min_zec={} memo={}",
        crate::logging::tags::INFO,
        escrow_addr,
        state.config.funding_min_zec,
        req.memo
    );
    let line = format!(
        "[escrowdv2] verifying shielded funding escrow_addr={} min_zec={} memo={}",
        escrow_addr,
        state.config.funding_min_zec,
        req.memo
    );
    eprintln!("{}", line);
    crate::logging::append_trade_log(&line);

    let has_funds = state
        .wallet
        .verify_shielded_funding(&req.api_key, state.config.funding_min_zec)
        .await?;

    if !has_funds {
        tracing::warn!(
            "{} shielded funding not found on-chain addr={} min_zec={} memo={}",
            crate::logging::tags::WARNING,
            escrow_addr,
            state.config.funding_min_zec,
            req.memo
        );
        let line = format!(
            "[escrowdv2] shielded funding NOT FOUND addr={} min_zec={} memo={}",
            escrow_addr,
            state.config.funding_min_zec,
            req.memo
        );
        eprintln!("{}", line);
        crate::logging::append_trade_log(&line);
        return Err(AppError::FundingNotFound);
    }

    // BIND to user-supplied origin_address (refund target)
    tracing::info!(
        "{} shielded funding verified escrow_addr={} origin_addr={}",
        crate::logging::tags::SUCCESS,
        escrow_addr,
        req.origin_address
    );
    state.bind_origin(OriginBinding {
        origin_type: OriginType::Shielded,
        origin_address: req.origin_address,
    })?;

    Ok(Json(state.status()))
}

async fn funding_transparent(
    State(state): State<SharedState>,
    Json(req): Json<FundingTransparentRequest>,
) -> Result<Json<StatusSnapshot>, AppError> {
    state.ensure_api_key(&req.api_key)?;
    // Bind funding to both api_key and escrow address to prevent replay across escrows.
    let expected = format!(
        "I approve these funds for the Barter Swap. api_key: {} escrow_addr: {}",
        state.config.api_key,
        state.wallet.address()
    );
    state.wallet.verify_transparent_signed_message(
        &req.funding_address,
        &expected,
        &req.signed_message,
    )?;

    // ON-CHAIN VERIFICATION: Check balance at escrow address
    let balance_zats = state.wallet.transparent_balance_zatoshis().await?;
    let balance = balance_zats.into_u64() as f64 / 1e8;

    if balance < state.config.funding_min_zec {
        tracing::warn!(
            "{} transparent funding insufficient balance={} min_zec={} escrow_addr={}",
            crate::logging::tags::WARNING,
            balance,
            state.config.funding_min_zec,
            state.wallet.address()
        );
        return Err(AppError::InsufficientFunds);
    }

    tracing::info!(
        "{} transparent funding verified balance={} escrow_addr={} from_addr={}",
        crate::logging::tags::SUCCESS,
        balance,
        state.wallet.address(),
        req.funding_address
    );

    state.bind_origin(OriginBinding {
        origin_type: OriginType::Transparent,
        origin_address: req.funding_address,
    })?;
    Ok(Json(state.status()))
}

async fn send_back(
    State(state): State<SharedState>,
    Json(req): Json<SendBackRequest>,
) -> Result<Json<SendResponse>, AppError> {
    state.ensure_api_key(&req.api_key)?;
    state.ensure_verified()?;
    if state.in_transit() {
        return Err(AppError::TransitMismatch);
    }

    let Some(binding) = state.origin() else {
        return Err(AppError::NoOrigin);
    };

    tracing::info!("{} send-back requested", crate::logging::tags::INFO);
    if let OriginType::Transparent = binding.origin_type {
        if req.signed_message.is_none() {
            return Err(AppError::Unauthorized);
        }
        let msg = req.signed_message.unwrap();
        // Require the signed message to bind api_key and escrow address explicitly.
        let expected = format!(
            "I approve these funds for the Barter Swap. api_key: {} escrow_addr: {}",
            state.config.api_key,
            state.wallet.address()
        );
        state
            .wallet
            .verify_transparent_signed_message(&binding.origin_address, &expected, &msg)?;
    }

    let send_guard = state.begin_send()?;
    let fee_policy = FeePolicy {
        bump_on_timeout: 1.2,
        max_multiplier: state.config.fee_cap_multiplier,
    };

    let txid = state
        .wallet
        .sweep_full_balance(&state.key_manager, &binding.origin_address, &fee_policy)
        .await?;

    drop(send_guard);

    let resp = Json(SendResponse { txid });
    // Graceful shutdown after refund to origin
    schedule_shutdown(Duration::from_secs(60));
    Ok(resp)
}

async fn send_target(
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    State(state): State<SharedState>,
    headers: HeaderMap,
    Json(req): Json<SendTargetRequest>,
) -> Result<Json<SendResponse>, AppError> {
    ensure_localhost(&addr)?;
    ensure_operator(&headers, &state)?;
    state.ensure_verified()?;
    if !state.in_transit() {
        return Err(AppError::TransitMismatch);
    }

    tracing::info!("{} send-target requested", crate::logging::tags::INFO);
    let send_guard = state.begin_send()?;
    let fee_policy = FeePolicy {
        bump_on_timeout: 1.2,
        max_multiplier: state.config.fee_cap_multiplier,
    };
    let txid = state
        .wallet
        .sweep_full_balance(&state.key_manager, &req.target_address, &fee_policy)
        .await?;

    state.key_manager.cleanup_after_send()?;
    drop(send_guard);
    state.set_in_transit(false, None)?;

    // Exit after send-to-target to match documented behavior.
    let txid_resp = Json(SendResponse { txid });
    // Spawn a delayed shutdown so the response can be returned.
    schedule_shutdown(Duration::from_secs(60));
    Ok(txid_resp)
}

fn schedule_shutdown(delay: Duration) {
    tokio::spawn(async move {
        tokio::time::sleep(delay).await;
        std::process::exit(0);
    });
}

fn ensure_localhost(addr: &SocketAddr) -> Result<(), AppError> {
    if addr.ip().is_loopback() {
        Ok(())
    } else {
        Err(AppError::Forbidden)
    }
}

fn ensure_operator(headers: &HeaderMap, state: &SharedState) -> Result<(), AppError> {
    let Some(ref required_token) = state.config.operator_token else {
        // OPERATOR_TOKEN not set - this is a configuration error
        tracing::error!(
            "{} OPERATOR_TOKEN not configured - rejecting localhost operation",
            crate::logging::tags::ERROR
        );
        return Err(AppError::Forbidden);
    };

    match headers.get("authorization") {
        Some(value) => {
            let auth_str = value.to_str().map_err(|_| AppError::Forbidden)?;
            if let Some(token) = auth_str.strip_prefix("Bearer ") {
                if token == required_token {
                    return Ok(());
                }
            }
            Err(AppError::Forbidden)
        }
        None => Err(AppError::Forbidden),
    }
}
