use escrowd::mina::MinaClient;
use mockito::Server;

#[tokio::test]
async fn verify_tx_accepts_matching_tx() {
    let mut server = Server::new_async().await;
    let body = r#"{
      "data": {
        "transactions": [
          {
            "hash": "txhash",
            "from": "B62qfrom",
            "to": "B62qto",
            "amount": "2.5",
            "canonical": true
          }
        ]
      }
    }"#;
    let _m = server
        .mock("POST", "/")
        .with_status(200)
        .with_body(body)
        .create_async()
        .await;

    let client = MinaClient::new(server.url(), "B62qto".to_string(), 1.0).unwrap();
    let ok = client.verify_tx("txhash").await.unwrap();
    assert!(ok);
}
