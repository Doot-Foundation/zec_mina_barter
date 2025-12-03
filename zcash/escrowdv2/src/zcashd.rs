use crate::error::AppError;
use crate::logging::tags;
use reqwest::Client;
use serde_json::json;
use serde_json::Value;

#[derive(Clone)]
pub struct ZcashdRpcClient {
    url: String,
    user: String,
    pass: String,
    http: Client,
}

impl ZcashdRpcClient {
    pub fn new(url: String, user: String, pass: String) -> Self {
        Self {
            url,
            user,
            pass,
            http: Client::new(),
        }
    }

    pub async fn send_raw_transaction(&self, tx_hex: &str) -> Result<String, AppError> {
        tracing::info!(
            "{} broadcasting raw transaction size={} bytes",
            tags::INFO,
            tx_hex.len() / 2
        );
        self.call("sendrawtransaction", json!([tx_hex]))
            .await
            .and_then(as_string)
    }

    async fn call(&self, method: &str, params: Value) -> Result<Value, AppError> {
        let body = json!({
            "jsonrpc": "1.0",
            "id": "escrowd",
            "method": method,
            "params": params,
        });
        let resp = self
            .http
            .post(&self.url)
            .basic_auth(&self.user, Some(&self.pass))
            .json(&body)
            .send()
            .await?;
        let status = resp.status();
        let v: RpcResponse = resp.json().await?;
        if !status.is_success() {
            return Err(AppError::Wallet(format!(
                "rpc {} failed: status {}",
                method, status
            )));
        }
        if let Some(err) = v.error {
            return Err(AppError::Wallet(format!("rpc {} error: {:?}", method, err)));
        }
        Ok(v.result.unwrap_or(Value::Null))
    }
}

#[derive(Debug, serde::Deserialize)]
struct RpcResponse {
    result: Option<Value>,
    error: Option<Value>,
}

fn as_string(v: Value) -> Result<String, AppError> {
    v.as_str()
        .map(|s| s.to_string())
        .ok_or_else(|| AppError::Wallet("expected string".into()))
}
