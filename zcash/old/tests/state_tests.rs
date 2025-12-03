use escrowd::config::{AddressType, Config};
use escrowd::key::KeyManager;
use escrowd::mina::MinaClient;
use escrowd::state::{AppState, OriginBinding, OriginType, SharedState};
use escrowd::wallet::Wallet;
use escrowd::zcashd::ZcashdRpcClient;
use mockito::Server;

fn dummy_config() -> Config {
    Config {
        listen_addr: "127.0.0.1:0".parse().unwrap(),
        data_dir: tempfile::tempdir().unwrap().into_path(),
        escrow_address_type: AddressType::Shielded,
        mina_endpoint: "http://localhost:1234/graphql".to_string(),
        mina_to_pubkey: "B62qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq".to_string(),
        api_key: "apikey".to_string(),
        fee_cap_multiplier: 5.0,
        funding_min_zec: 0.001,
        mina_min_amount: 0.001,
        operator_token: Some("operator".to_string()),
        zcashd_rpc_url: "http://localhost:18232".to_string(),
        zcashd_rpc_user: "user".to_string(),
        zcashd_rpc_pass: "pass".to_string(),
    }
}

async fn dummy_state() -> SharedState {
    let cfg = dummy_config();
    let key_manager = KeyManager::init(&cfg).unwrap();
    let mut server = Server::new_async().await;
    let zcashd_url = server.url();
    let _m1 = server
        .mock("POST", "/")
        .with_status(200)
        .with_body(r#"{"result":"zs1mock","error":null,"id":"1"}"#)
        .create_async()
        .await;
    let zcashd = ZcashdRpcClient::new(zcashd_url, "user".to_string(), "pass".to_string());
    let wallet = Wallet::create(
        key_manager.unified_full_viewing_key().to_string(),
        zcashd,
        OriginType::Shielded,
    )
    .await
    .unwrap();
    let mina_client =
        MinaClient::new("http://127.0.0.1:1".to_string(), cfg.mina_to_pubkey.clone(), cfg.mina_min_amount)
            .unwrap();
    AppState::new(cfg, key_manager, wallet, mina_client)
}

#[tokio::test]
async fn bind_origin_sets_verified_and_persists() {
    let state = dummy_state().await;
    state
        .bind_origin(OriginBinding {
            origin_type: OriginType::Shielded,
            origin_address: "ztest".to_string(),
        })
        .unwrap();
    assert!(state.status().verified);
    assert!(state.origin().is_some());
}

#[tokio::test]
async fn already_bound_prevents_double_bind() {
    let state = dummy_state().await;
    state
        .bind_origin(OriginBinding {
            origin_type: OriginType::Shielded,
            origin_address: "z1".to_string(),
        })
        .unwrap();
    let err = state
        .bind_origin(OriginBinding {
            origin_type: OriginType::Shielded,
            origin_address: "z2".to_string(),
        })
        .unwrap_err();
    assert!(format!("{err}").contains("already bound"));
}

#[tokio::test]
async fn set_in_transit_respects_busy_flag() {
    let state = dummy_state().await;
    state.set_in_transit(false, None).unwrap();
    let guard = state.begin_send().unwrap();
    let err = state.set_in_transit(true, None).unwrap_err();
    assert!(format!("{err}").contains("busy"));
    drop(guard);
}
