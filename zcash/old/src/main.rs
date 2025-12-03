mod api;
mod config;
mod error;
mod key;
mod logging;
mod mina;
mod state;
mod wallet;
mod zcashd;

use crate::api::build_router;
use crate::config::Config;
use crate::error::AppError;
use crate::key::KeyManager;
use crate::logging::tags;
use crate::mina::MinaClient;
use crate::state::AppState;
use crate::wallet::Wallet;
use crate::zcashd::ZcashdRpcClient;
use tokio::net::TcpListener;
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() -> Result<(), AppError> {
    init_tracing();
    std::panic::set_hook(Box::new(|info| {
        tracing::error!("{} panic: {info}", tags::PANIC);
    }));

    let config = Config::from_env()?;

    // Warn if OPERATOR_TOKEN not set
    if config.operator_token.is_none() {
        tracing::error!(
            "{} OPERATOR_TOKEN not set - localhost operations will fail. Set OPERATOR_TOKEN environment variable.",
            tags::ERROR
        );
    }

    let key_manager = KeyManager::init(&config)?;
    let mina_client = MinaClient::new(
        config.mina_endpoint.clone(),
        config.mina_to_pubkey.clone(),
        config.mina_min_amount,
    )?;
    let zcashd = ZcashdRpcClient::new(
        config.zcashd_rpc_url.clone(),
        config.zcashd_rpc_user.clone(),
        config.zcashd_rpc_pass.clone(),
    );
    let source_type = match config.escrow_address_type {
        crate::config::AddressType::Shielded => crate::state::OriginType::Shielded,
        crate::config::AddressType::Transparent => crate::state::OriginType::Transparent,
    };
    let wallet = Wallet::create(
        key_manager.unified_full_viewing_key().to_string(),
        zcashd,
        source_type,
    )
    .await?;

    tracing::info!(
        "{} listen={} address={} addr_type={:?}",
        tags::INFO,
        config.listen_addr,
        wallet.address(),
        config.escrow_address_type
    );

    let shared_state = AppState::new(config.clone(), key_manager, wallet, mina_client);
    let app = build_router(shared_state.clone());

    let listener = TcpListener::bind(config.listen_addr).await?;
    let addr = listener.local_addr()?;
    tracing::info!("listening on {}", addr);

    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<std::net::SocketAddr>(),
    )
    .await?;

    Ok(())
}

fn init_tracing() {
    let filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"));
    let _ = tracing_subscriber::fmt().with_env_filter(filter).try_init();
}
