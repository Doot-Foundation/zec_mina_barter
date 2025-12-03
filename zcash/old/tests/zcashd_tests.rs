use escrowd::zcashd::{SpendSource, ZcashdRpcClient};
use mockito::Server;

#[tokio::test]
async fn get_balance_shielded_parses_response() {
    let mut server = Server::new_async().await;
    let _m = server
        .mock("POST", "/")
        .with_status(200)
        .with_body(r#"{"result":1.2345,"error":null,"id":"1"}"#)
        .create_async()
        .await;

    let client = ZcashdRpcClient::new(server.url(), "user".to_string(), "pass".to_string());
    let bal = client
        .get_balance(SpendSource::Shielded, "zs1mock")
        .await
        .unwrap();
    assert!((bal - 1.2345).abs() < 1e-6);
}

#[tokio::test]
async fn has_shielded_funding_matches_memo_and_amount() {
    let mut server = Server::new_async().await;
    let _m = server
        .mock("POST", "/")
        .with_status(200)
        .with_body(
            r#"{
                "result": [
                  {"amount": 0.5, "memo": "31323334"},
                  {"amount": 1.0, "memo": "74657374"}
                ],
                "error": null,
                "id": "1"
              }"#,
        )
        .create_async()
        .await;

    let client = ZcashdRpcClient::new(server.url(), "user".to_string(), "pass".to_string());
    let ok = client
        .has_shielded_funding("zs1mock", "test", 0.9)
        .await
        .unwrap();
    assert!(ok);
}
