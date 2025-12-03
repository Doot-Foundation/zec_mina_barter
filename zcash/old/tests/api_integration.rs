use escrowd::api::build_router;
use escrowd::config::{AddressType, Config};
use escrowd::key::KeyManager;
use escrowd::mina::MinaClient;
use escrowd::state::AppState;
use escrowd::wallet::Wallet;
use escrowd::zcashd::ZcashdRpcClient;
use axum::Router;
use mockito::Server;
use std::net::SocketAddr;
use tokio::net::TcpListener;

#[tokio::test]
async fn status_and_address_endpoints_work() {
    // Dummy config
    let cfg = Config {
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
    };

    // Mock zcashd RPC
    let mut server = Server::new_async().await;
    let _m1 = server
        .mock("POST", "/")
        .with_status(200)
        .with_body(r#"{"result":"zs1mockaddress","error":null,"id":"1"}"#)
        .create_async()
        .await;

    let key_manager = KeyManager::init(&cfg).unwrap();
    let zcashd = ZcashdRpcClient::new(server.url(), "user".to_string(), "pass".to_string());
    let wallet = Wallet::create(
        key_manager.unified_full_viewing_key().to_string(),
        zcashd,
        escrowd::state::OriginType::Shielded,
    )
    .await
    .unwrap();
    let mina_client =
        MinaClient::new(cfg.mina_endpoint.clone(), cfg.mina_to_pubkey.clone(), cfg.mina_min_amount)
            .unwrap();

    let state = AppState::new(cfg.clone(), key_manager, wallet, mina_client);
    let app: Router = build_router(state);

    let listener = TcpListener::bind(cfg.listen_addr).await.unwrap();
    let addr: SocketAddr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(listener, app.into_make_service_with_connect_info::<SocketAddr>())
            .await
            .unwrap();
    });

    let res = reqwest::get(format!("http://{}/address", addr))
        .await
        .unwrap();
    assert_eq!(res.status().as_u16(), 200);

    let res = reqwest::get(format!("http://{}/status", addr))
        .await
        .unwrap();
    assert_eq!(res.status().as_u16(), 200);
}
