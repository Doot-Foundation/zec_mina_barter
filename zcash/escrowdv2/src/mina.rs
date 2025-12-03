use crate::error::AppError;
use reqwest::Client;
use serde::{Deserialize, Serialize};

#[derive(Clone)]
pub struct MinaClient {
    endpoint: String,
    to_pubkey: String,
    min_amount: f64,
    http: Client,
}

impl MinaClient {
    pub fn new(endpoint: String, to_pubkey: String, min_amount: f64) -> Result<Self, AppError> {
        Ok(Self {
            endpoint,
            to_pubkey,
            min_amount,
            http: Client::new(),
        })
    }

    pub async fn verify_tx(&self, tx_hash: &str) -> Result<bool, AppError> {
        let body = GraphQlRequest::new(tx_hash);
        let resp = self
            .http
            .post(&self.endpoint)
            .json(&body)
            .send()
            .await
            .map_err(AppError::from)?;

        if !resp.status().is_success() {
            tracing::warn!(
                "{} mina query failed status={} tx_hash={}",
                crate::logging::tags::WARNING,
                resp.status(),
                tx_hash
            );
            return Ok(false);
        }

        let parsed: GraphQlResponse = resp.json().await?;
        let Some(data) = parsed.data else {
            tracing::warn!(
                "{} mina query returned no data tx_hash={}",
                crate::logging::tags::WARNING,
                tx_hash
            );
            return Ok(false);
        };

        for tx in data.transactions.into_iter() {
            if tx.to.as_deref() != Some(&self.to_pubkey) {
                continue;
            }
            if tx.canonical != Some(true) {
                continue;
            }
            let amount_ok = tx
                .amount
                .as_deref()
                .unwrap_or("0")
                .parse::<f64>()
                .unwrap_or(0.0)
                >= self.min_amount;
            if amount_ok {
                tracing::info!(
                    "{} mina tx accepted tx_hash={} to={} amount={}",
                    crate::logging::tags::SUCCESS,
                    tx.hash.unwrap_or_default(),
                    self.to_pubkey,
                    tx.amount.unwrap_or_default()
                );
                return Ok(true);
            }
        }

        Ok(false)
    }
}

#[derive(Serialize)]
struct GraphQlRequest<'a> {
    query: &'a str,
    variables: Variables<'a>,
}

#[derive(Serialize)]
struct Variables<'a> {
    hash: &'a str,
}

impl<'a> GraphQlRequest<'a> {
    fn new(tx_hash: &'a str) -> Self {
        Self {
            query: TX_QUERY,
            variables: Variables { hash: tx_hash },
        }
    }
}

#[derive(Debug, Deserialize)]
struct GraphQlResponse {
    data: Option<ResponseData>,
}

#[derive(Debug, Deserialize)]
struct ResponseData {
    transactions: Vec<MinaTx>,
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
struct MinaTx {
    pub hash: Option<String>,
    pub from: Option<String>,
    pub to: Option<String>,
    pub amount: Option<String>,
    pub canonical: Option<bool>,
}

const TX_QUERY: &str = r#"
query TxByHash($hash: String!) {
  transactions(query: { hash: $hash }) {
    hash
    from
    to
    amount
    canonical
  }
}
"#;

#[cfg(test)]
mod tests {
    use super::*;
    use mockito;

    fn test_pubkey() -> String {
        "B62qod2DugDjy9Jxhzd56gFS7npN8pWhanxxb36MLPzDDqtzzDyBy5z".to_string()
    }

    fn test_from_pubkey() -> String {
        "B62qkoGddv1djrxNY7CAdrNWkkjrU72BKCoAfdKxWUqYV5bWk5kej27".to_string()
    }

    #[test]
    fn test_mina_client_new_creates_client() {
        let endpoint = "https://api.minascan.io/archive/devnet/v1/graphql".to_string();
        let to_pubkey = test_pubkey();
        let min_amount = 0.001;

        let client = MinaClient::new(endpoint.clone(), to_pubkey.clone(), min_amount).unwrap();

        assert_eq!(client.endpoint, endpoint);
        assert_eq!(client.to_pubkey, to_pubkey);
        assert_eq!(client.min_amount, min_amount);
    }

    #[tokio::test]
    async fn test_verify_tx_success_valid_canonical_transaction() {
        let mut server = mockito::Server::new_async().await;
        let to_pubkey = test_pubkey();
        let from_pubkey = test_from_pubkey();

        let response_body = serde_json::json!({
            "data": {
                "transactions": [{
                    "hash": "CkpZEKF7JYh9KLjJXJKP8wzAnQGEqLnS4KhPH1jf9K7AyU38yedqB",
                    "from": from_pubkey,
                    "to": to_pubkey,
                    "amount": "1000000000",
                    "canonical": true
                }]
            }
        });

        let _m = server
            .mock("POST", "/")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(response_body.to_string())
            .create_async()
            .await;

        let client = MinaClient::new(server.url(), to_pubkey.clone(), 0.001).unwrap();
        let result = client
            .verify_tx("CkpZEKF7JYh9KLjJXJKP8wzAnQGEqLnS4KhPH1jf9K7AyU38yedqB")
            .await;

        assert!(result.is_ok());
        assert!(result.unwrap());
    }

    #[tokio::test]
    async fn test_verify_tx_success_amount_at_minimum_threshold() {
        let mut server = mockito::Server::new_async().await;
        let to_pubkey = test_pubkey();
        let from_pubkey = test_from_pubkey();

        let response_body = serde_json::json!({
            "data": {
                "transactions": [{
                    "hash": "CkpZEKF7JYh9KLjJXJKP8wzAnQGEqLnS4KhPH1jf9K7AyU38yedqB",
                    "from": from_pubkey,
                    "to": to_pubkey,
                    "amount": "1000000",
                    "canonical": true
                }]
            }
        });

        let _m = server
            .mock("POST", "/")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(response_body.to_string())
            .create_async()
            .await;

        let client = MinaClient::new(server.url(), to_pubkey.clone(), 0.001).unwrap();
        let result = client
            .verify_tx("CkpZEKF7JYh9KLjJXJKP8wzAnQGEqLnS4KhPH1jf9K7AyU38yedqB")
            .await;

        assert!(result.is_ok());
        assert!(result.unwrap());
    }

    #[tokio::test]
    async fn test_verify_tx_fails_on_http_error() {
        let mut server = mockito::Server::new_async().await;
        let to_pubkey = test_pubkey();

        let _m = server
            .mock("POST", "/")
            .with_status(500)
            .with_body("Internal Server Error")
            .create_async()
            .await;

        let client = MinaClient::new(server.url(), to_pubkey.clone(), 0.001).unwrap();
        let result = client
            .verify_tx("CkpZEKF7JYh9KLjJXJKP8wzAnQGEqLnS4KhPH1jf9K7AyU38yedqB")
            .await;

        assert!(result.is_ok());
        assert!(!result.unwrap());
    }

    #[tokio::test]
    async fn test_verify_tx_fails_on_empty_data() {
        let mut server = mockito::Server::new_async().await;
        let to_pubkey = test_pubkey();

        let response_body = serde_json::json!({
            "data": null
        });

        let _m = server
            .mock("POST", "/")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(response_body.to_string())
            .create_async()
            .await;

        let client = MinaClient::new(server.url(), to_pubkey.clone(), 0.001).unwrap();
        let result = client
            .verify_tx("CkpZEKF7JYh9KLjJXJKP8wzAnQGEqLnS4KhPH1jf9K7AyU38yedqB")
            .await;

        assert!(result.is_ok());
        assert!(!result.unwrap());
    }

    #[tokio::test]
    async fn test_verify_tx_fails_wrong_recipient() {
        let mut server = mockito::Server::new_async().await;
        let to_pubkey = test_pubkey();
        let from_pubkey = test_from_pubkey();
        let wrong_recipient = "B62qrKG4Z8hnzZqp1AL8WsQhQYah3quN1qUj3SyfJA8Lw135qWWg1mi".to_string();

        let response_body = serde_json::json!({
            "data": {
                "transactions": [{
                    "hash": "CkpZEKF7JYh9KLjJXJKP8wzAnQGEqLnS4KhPH1jf9K7AyU38yedqB",
                    "from": from_pubkey,
                    "to": wrong_recipient,
                    "amount": "1000000000",
                    "canonical": true
                }]
            }
        });

        let _m = server
            .mock("POST", "/")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(response_body.to_string())
            .create_async()
            .await;

        let client = MinaClient::new(server.url(), to_pubkey.clone(), 0.001).unwrap();
        let result = client
            .verify_tx("CkpZEKF7JYh9KLjJXJKP8wzAnQGEqLnS4KhPH1jf9K7AyU38yedqB")
            .await;

        assert!(result.is_ok());
        assert!(!result.unwrap());
    }

    #[tokio::test]
    async fn test_verify_tx_fails_non_canonical_transaction() {
        let mut server = mockito::Server::new_async().await;
        let to_pubkey = test_pubkey();
        let from_pubkey = test_from_pubkey();

        let response_body = serde_json::json!({
            "data": {
                "transactions": [{
                    "hash": "CkpZEKF7JYh9KLjJXJKP8wzAnQGEqLnS4KhPH1jf9K7AyU38yedqB",
                    "from": from_pubkey,
                    "to": to_pubkey,
                    "amount": "1000000000",
                    "canonical": false
                }]
            }
        });

        let _m = server
            .mock("POST", "/")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(response_body.to_string())
            .create_async()
            .await;

        let client = MinaClient::new(server.url(), to_pubkey.clone(), 0.001).unwrap();
        let result = client
            .verify_tx("CkpZEKF7JYh9KLjJXJKP8wzAnQGEqLnS4KhPH1jf9K7AyU38yedqB")
            .await;

        assert!(result.is_ok());
        assert!(!result.unwrap());
    }

    #[tokio::test]
    async fn test_verify_tx_fails_insufficient_amount() {
        let mut server = mockito::Server::new_async().await;
        let to_pubkey = test_pubkey();
        let from_pubkey = test_from_pubkey();

        let response_body = serde_json::json!({
            "data": {
                "transactions": [{
                    "hash": "CkpZEKF7JYh9KLjJXJKP8wzAnQGEqLnS4KhPH1jf9K7AyU38yedqB",
                    "from": from_pubkey,
                    "to": to_pubkey,
                    "amount": "0.0005",
                    "canonical": true
                }]
            }
        });

        let _m = server
            .mock("POST", "/")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(response_body.to_string())
            .create_async()
            .await;

        let client = MinaClient::new(server.url(), to_pubkey.clone(), 0.001).unwrap();
        let result = client
            .verify_tx("CkpZEKF7JYh9KLjJXJKP8wzAnQGEqLnS4KhPH1jf9K7AyU38yedqB")
            .await;

        assert!(result.is_ok());
        assert!(!result.unwrap());
    }

    #[tokio::test]
    async fn test_verify_tx_fails_empty_transactions_array() {
        let mut server = mockito::Server::new_async().await;
        let to_pubkey = test_pubkey();

        let response_body = serde_json::json!({
            "data": {
                "transactions": []
            }
        });

        let _m = server
            .mock("POST", "/")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(response_body.to_string())
            .create_async()
            .await;

        let client = MinaClient::new(server.url(), to_pubkey.clone(), 0.001).unwrap();
        let result = client
            .verify_tx("CkpZEKF7JYh9KLjJXJKP8wzAnQGEqLnS4KhPH1jf9K7AyU38yedqB")
            .await;

        assert!(result.is_ok());
        assert!(!result.unwrap());
    }

    #[tokio::test]
    async fn test_verify_tx_success_with_multiple_transactions() {
        let mut server = mockito::Server::new_async().await;
        let to_pubkey = test_pubkey();
        let from_pubkey = test_from_pubkey();
        let wrong_recipient = "B62qrKG4Z8hnzZqp1AL8WsQhQYah3quN1qUj3SyfJA8Lw135qWWg1mi".to_string();

        let response_body = serde_json::json!({
            "data": {
                "transactions": [
                    {
                        "hash": "InvalidTx1",
                        "from": from_pubkey,
                        "to": wrong_recipient,
                        "amount": "1000000000",
                        "canonical": true
                    },
                    {
                        "hash": "InvalidTx2",
                        "from": from_pubkey,
                        "to": to_pubkey,
                        "amount": "1000000000",
                        "canonical": false
                    },
                    {
                        "hash": "ValidTx",
                        "from": from_pubkey,
                        "to": to_pubkey,
                        "amount": "1000000000",
                        "canonical": true
                    }
                ]
            }
        });

        let _m = server
            .mock("POST", "/")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(response_body.to_string())
            .create_async()
            .await;

        let client = MinaClient::new(server.url(), to_pubkey.clone(), 0.001).unwrap();
        let result = client.verify_tx("ValidTx").await;

        assert!(result.is_ok());
        assert!(result.unwrap());
    }
}
