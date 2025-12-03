use escrowd::config::{AddressType, Config};
use escrowd::key::KeyManager;

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

#[test]
fn key_manager_initializes_and_exposes_ufvk() {
    let cfg = dummy_config();
    let km = KeyManager::init(&cfg).unwrap();
    let ufvk = km.unified_full_viewing_key();
    assert!(!ufvk.is_empty());
}
