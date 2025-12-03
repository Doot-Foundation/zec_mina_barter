use crate::error::AppError;
use crate::logging::tags;
use reqwest::Client;
use serde_json::Value;
use serde_json::json;

#[derive(Clone)]
pub struct ZcashdRpcClient {
    url: String,
    user: String,
    pass: String,
    http: Client,
}

#[derive(Clone, Debug)]
pub enum SpendSource {
    Shielded,
    Transparent,
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

    pub async fn new_sapling_address(&self) -> Result<String, AppError> {
        let addr = self
            .call("z_getnewaddress", json!(["sapling"]))
            .await
            .and_then(as_string)?;
        tracing::info!("{} new sapling address={}", tags::INFO, addr);
        Ok(addr)
    }

    pub async fn new_transparent_address(&self) -> Result<String, AppError> {
        let addr = self
            .call("getnewaddress", json!([]))
            .await
            .and_then(as_string)?;
        tracing::info!("{} new transparent address={}", tags::INFO, addr);
        Ok(addr)
    }

    pub async fn get_balance(&self, source: SpendSource, addr: &str) -> Result<f64, AppError> {
        match source {
            SpendSource::Shielded => self
                .call("z_getbalance", json!([addr]))
                .await
                .and_then(as_f64),
            SpendSource::Transparent => {
                // Sum unspent outputs for the address.
                let unspent = self
                    .call("listunspent", json!([0, 9999999, [addr]]))
                    .await?;
                let arr = unspent.as_array().ok_or_else(|| {
                    AppError::Wallet("unexpected listunspent response".to_string())
                })?;
                let sum = arr
                    .iter()
                    .filter_map(|v| v.get("amount").and_then(|a| a.as_f64()))
                    .sum();
                tracing::info!("{} rpc balance addr={} amount={}", tags::INFO, addr, sum);
                Ok(sum)
            }
        }
    }

    pub async fn has_shielded_funding(
        &self,
        addr: &str,
        memo_ascii: &str,
        min_amount: f64,
    ) -> Result<bool, AppError> {
        let wanted_memo_hex = hex::encode(memo_ascii.as_bytes());
        let received = self
            .call("z_listreceivedbyaddress", json!([addr, 0]))
            .await?;
        let Some(arr) = received.as_array() else {
            return Ok(false);
        };
        for entry in arr {
            let amount = entry.get("amount").and_then(|v| v.as_f64()).unwrap_or(0.0);
            if amount < min_amount {
                continue;
            }
            if let Some(memo_hex) = entry.get("memo").and_then(|m| m.as_str()) {
                if memo_hex.eq_ignore_ascii_case(&wanted_memo_hex) {
                    return Ok(true);
                }
            }
        }
        Ok(false)
    }

    pub async fn send_full_balance(
        &self,
        source: SpendSource,
        from_addr: &str,
        dest: &str,
        amount: f64,
    ) -> Result<String, AppError> {
        tracing::info!(
            "{} rpc send_full_balance start source={:?} from={} dest={} amount={}",
            tags::INFO,
            source,
            from_addr,
            dest,
            amount
        );
        let method = match source {
            SpendSource::Shielded => "z_sendmany",
            SpendSource::Transparent => "z_sendmany",
        };
        let params = json!([
            from_addr,
            [
                {
                    "address": dest,
                    "amount": amount
                }
            ],
            1,
            0.0
        ]);
        let opid = self.call(method, params).await.and_then(as_string)?;
        tracing::info!("{} opid started opid={}", tags::INFO, opid);
        let txid = self.poll_operation(opid.clone()).await?;
        tracing::info!(
            "{} rpc send_full_balance completed dest={} txid={}",
            tags::SUCCESS,
            dest,
            txid
        );
        Ok(txid)
    }

    async fn poll_operation(&self, opid: String) -> Result<String, AppError> {
        // Poll z_getoperationstatus until the opid is complete; return txid on success.
        for _ in 0..60 {
            let statuses = self.call("z_getoperationstatus", json!([[opid]])).await?;
            if let Some(arr) = statuses.as_array() {
                if let Some(status) = arr.first() {
                    if let Some(error) = status.get("error") {
                        tracing::error!("{} opid error: {:?}", tags::ERROR, error);
                        return Err(AppError::Wallet(format!("operation error: {error:?}")));
                    }
                    if let Some(result) = status.get("result") {
                        if let Some(txid) = result.get("txid").and_then(|t| t.as_str()) {
                            // Clean up
                            let _ = self.call("z_getoperationresult", json!([[opid]])).await;
                            tracing::info!("{} opid complete txid={}", tags::SUCCESS, txid);
                            return Ok(txid.to_string());
                        }
                    }
                }
            }
            tokio::time::sleep(std::time::Duration::from_secs(2)).await;
        }
        tracing::warn!(
            "{} opid {} did not complete within timeout",
            tags::WARNING,
            opid
        );
        Err(AppError::Wallet(
            "operation did not complete in time".into(),
        ))
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

fn as_f64(v: Value) -> Result<f64, AppError> {
    v.as_f64()
        .ok_or_else(|| AppError::Wallet("expected number".into()))
}

fn as_string(v: Value) -> Result<String, AppError> {
    v.as_str()
        .map(|s| s.to_string())
        .ok_or_else(|| AppError::Wallet("expected string".into()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use mockito;

    #[test]
    fn test_zcashd_client_new_creates_client() {
        let url = "http://127.0.0.1:18232".to_string();
        let user = "zcashrpc".to_string();
        let pass = "changeme".to_string();

        let client = ZcashdRpcClient::new(url.clone(), user.clone(), pass.clone());

        assert_eq!(client.url, url);
        assert_eq!(client.user, user);
        assert_eq!(client.pass, pass);
    }

    #[tokio::test]
    async fn test_new_sapling_address_success() {
        let mut server = mockito::Server::new_async().await;
        let user = "zcashrpc".to_string();
        let pass = "changeme".to_string();

        let response_body = serde_json::json!({
            "result": "zs1z7rejlpsa98s2rrrfkwmaxu53e4ue0ulcrw0h4x5g8jl04tak0d3mm47vdtahatqrlkngh9slya",
            "error": null,
            "id": "escrowd"
        });

        let _m = server
            .mock("POST", "/")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(response_body.to_string())
            .create_async()
            .await;

        let client = ZcashdRpcClient::new(server.url(), user, pass);
        let result = client.new_sapling_address().await;

        assert!(result.is_ok());
        assert!(result.unwrap().starts_with("zs1"));
    }

    #[tokio::test]
    async fn test_new_transparent_address_success() {
        let mut server = mockito::Server::new_async().await;
        let user = "zcashrpc".to_string();
        let pass = "changeme".to_string();

        let response_body = serde_json::json!({
            "result": "tmYXBYJj1K7vhNWkZZR1E6MKJq1FMGPTq1b",
            "error": null,
            "id": "escrowd"
        });

        let _m = server
            .mock("POST", "/")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(response_body.to_string())
            .create_async()
            .await;

        let client = ZcashdRpcClient::new(server.url(), user, pass);
        let result = client.new_transparent_address().await;

        assert!(result.is_ok());
        assert!(result.unwrap().starts_with("tm"));
    }

    #[tokio::test]
    async fn test_get_balance_shielded_success() {
        let mut server = mockito::Server::new_async().await;
        let user = "zcashrpc".to_string();
        let pass = "changeme".to_string();

        let response_body = serde_json::json!({
            "result": 1.5,
            "error": null,
            "id": "escrowd"
        });

        let _m = server
            .mock("POST", "/")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(response_body.to_string())
            .create_async()
            .await;

        let client = ZcashdRpcClient::new(server.url(), user, pass);
        let result = client
            .get_balance(
                SpendSource::Shielded,
                "zs1z7rejlpsa98s2rrrfkwmaxu53e4ue0ulcrw0h4x5g8jl04tak0d3mm47vdtahatqrlkngh9slya",
            )
            .await;

        assert!(result.is_ok());
        assert_eq!(result.unwrap(), 1.5);
    }

    #[tokio::test]
    async fn test_get_balance_transparent_success() {
        let mut server = mockito::Server::new_async().await;
        let user = "zcashrpc".to_string();
        let pass = "changeme".to_string();

        let response_body = serde_json::json!({
            "result": [
                {
                    "txid": "5e78e6e5e10a3e2e5e7e8e9e0e1e2e3e4e5e6e7e8e9e0e1e2e3e4e5e6e7e8e9e0",
                    "vout": 0,
                    "address": "tmYXBYJj1K7vhNWkZZR1E6MKJq1FMGPTq1b",
                    "amount": 0.5,
                    "confirmations": 100
                },
                {
                    "txid": "6e78e6e5e10a3e2e5e7e8e9e0e1e2e3e4e5e6e7e8e9e0e1e2e3e4e5e6e7e8e9e0",
                    "vout": 1,
                    "address": "tmYXBYJj1K7vhNWkZZR1E6MKJq1FMGPTq1b",
                    "amount": 1.0,
                    "confirmations": 50
                }
            ],
            "error": null,
            "id": "escrowd"
        });

        let _m = server
            .mock("POST", "/")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(response_body.to_string())
            .create_async()
            .await;

        let client = ZcashdRpcClient::new(server.url(), user, pass);
        let result = client
            .get_balance(SpendSource::Transparent, "tmYXBYJj1K7vhNWkZZR1E6MKJq1FMGPTq1b")
            .await;

        assert!(result.is_ok());
        assert_eq!(result.unwrap(), 1.5);
    }

    #[tokio::test]
    async fn test_get_balance_transparent_empty_array() {
        let mut server = mockito::Server::new_async().await;
        let user = "zcashrpc".to_string();
        let pass = "changeme".to_string();

        let response_body = serde_json::json!({
            "result": [],
            "error": null,
            "id": "escrowd"
        });

        let _m = server
            .mock("POST", "/")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(response_body.to_string())
            .create_async()
            .await;

        let client = ZcashdRpcClient::new(server.url(), user, pass);
        let result = client
            .get_balance(SpendSource::Transparent, "tmYXBYJj1K7vhNWkZZR1E6MKJq1FMGPTq1b")
            .await;

        assert!(result.is_ok());
        assert_eq!(result.unwrap(), 0.0);
    }

    #[tokio::test]
    async fn test_has_shielded_funding_success() {
        let mut server = mockito::Server::new_async().await;
        let user = "zcashrpc".to_string();
        let pass = "changeme".to_string();

        let memo_ascii = "swap-123456";
        let memo_hex = hex::encode(memo_ascii.as_bytes());

        let response_body = serde_json::json!({
            "result": [
                {
                    "txid": "5e78e6e5e10a3e2e5e7e8e9e0e1e2e3e4e5e6e7e8e9e0e1e2e3e4e5e6e7e8e9e0",
                    "amount": 0.5,
                    "memo": memo_hex,
                    "confirmations": 10
                }
            ],
            "error": null,
            "id": "escrowd"
        });

        let _m = server
            .mock("POST", "/")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(response_body.to_string())
            .create_async()
            .await;

        let client = ZcashdRpcClient::new(server.url(), user, pass);
        let result = client
            .has_shielded_funding(
                "zs1z7rejlpsa98s2rrrfkwmaxu53e4ue0ulcrw0h4x5g8jl04tak0d3mm47vdtahatqrlkngh9slya",
                memo_ascii,
                0.001,
            )
            .await;

        assert!(result.is_ok());
        assert!(result.unwrap());
    }

    #[tokio::test]
    async fn test_has_shielded_funding_insufficient_amount() {
        let mut server = mockito::Server::new_async().await;
        let user = "zcashrpc".to_string();
        let pass = "changeme".to_string();

        let memo_ascii = "swap-123456";
        let memo_hex = hex::encode(memo_ascii.as_bytes());

        let response_body = serde_json::json!({
            "result": [
                {
                    "txid": "5e78e6e5e10a3e2e5e7e8e9e0e1e2e3e4e5e6e7e8e9e0e1e2e3e4e5e6e7e8e9e0",
                    "amount": 0.0005,
                    "memo": memo_hex,
                    "confirmations": 10
                }
            ],
            "error": null,
            "id": "escrowd"
        });

        let _m = server
            .mock("POST", "/")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(response_body.to_string())
            .create_async()
            .await;

        let client = ZcashdRpcClient::new(server.url(), user, pass);
        let result = client
            .has_shielded_funding(
                "zs1z7rejlpsa98s2rrrfkwmaxu53e4ue0ulcrw0h4x5g8jl04tak0d3mm47vdtahatqrlkngh9slya",
                memo_ascii,
                0.001,
            )
            .await;

        assert!(result.is_ok());
        assert!(!result.unwrap());
    }

    #[tokio::test]
    async fn test_has_shielded_funding_wrong_memo() {
        let mut server = mockito::Server::new_async().await;
        let user = "zcashrpc".to_string();
        let pass = "changeme".to_string();

        let wrong_memo = "different-swap-id";
        let wrong_memo_hex = hex::encode(wrong_memo.as_bytes());

        let response_body = serde_json::json!({
            "result": [
                {
                    "txid": "5e78e6e5e10a3e2e5e7e8e9e0e1e2e3e4e5e6e7e8e9e0e1e2e3e4e5e6e7e8e9e0",
                    "amount": 0.5,
                    "memo": wrong_memo_hex,
                    "confirmations": 10
                }
            ],
            "error": null,
            "id": "escrowd"
        });

        let _m = server
            .mock("POST", "/")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(response_body.to_string())
            .create_async()
            .await;

        let client = ZcashdRpcClient::new(server.url(), user, pass);
        let result = client
            .has_shielded_funding(
                "zs1z7rejlpsa98s2rrrfkwmaxu53e4ue0ulcrw0h4x5g8jl04tak0d3mm47vdtahatqrlkngh9slya",
                "swap-123456",
                0.001,
            )
            .await;

        assert!(result.is_ok());
        assert!(!result.unwrap());
    }

    #[tokio::test]
    async fn test_has_shielded_funding_empty_array() {
        let mut server = mockito::Server::new_async().await;
        let user = "zcashrpc".to_string();
        let pass = "changeme".to_string();

        let response_body = serde_json::json!({
            "result": [],
            "error": null,
            "id": "escrowd"
        });

        let _m = server
            .mock("POST", "/")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(response_body.to_string())
            .create_async()
            .await;

        let client = ZcashdRpcClient::new(server.url(), user, pass);
        let result = client
            .has_shielded_funding(
                "zs1z7rejlpsa98s2rrrfkwmaxu53e4ue0ulcrw0h4x5g8jl04tak0d3mm47vdtahatqrlkngh9slya",
                "swap-123456",
                0.001,
            )
            .await;

        assert!(result.is_ok());
        assert!(!result.unwrap());
    }

    #[tokio::test]
    async fn test_send_full_balance_success() {
        let mut server = mockito::Server::new_async().await;
        let user = "zcashrpc".to_string();
        let pass = "changeme".to_string();

        // First call returns operation ID
        let opid_response = serde_json::json!({
            "result": "opid-12345-abcde",
            "error": null,
            "id": "escrowd"
        });

        // Second call (poll) returns completed operation with txid
        let status_response = serde_json::json!({
            "result": [
                {
                    "id": "opid-12345-abcde",
                    "status": "success",
                    "result": {
                        "txid": "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2"
                    }
                }
            ],
            "error": null,
            "id": "escrowd"
        });

        // Third call (cleanup) returns empty
        let cleanup_response = serde_json::json!({
            "result": [],
            "error": null,
            "id": "escrowd"
        });

        let _m1 = server
            .mock("POST", "/")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(opid_response.to_string())
            .create_async()
            .await;

        let _m2 = server
            .mock("POST", "/")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(status_response.to_string())
            .create_async()
            .await;

        let _m3 = server
            .mock("POST", "/")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(cleanup_response.to_string())
            .create_async()
            .await;

        let client = ZcashdRpcClient::new(server.url(), user, pass);
        let result = client
            .send_full_balance(
                SpendSource::Shielded,
                "zs1z7rejlpsa98s2rrrfkwmaxu53e4ue0ulcrw0h4x5g8jl04tak0d3mm47vdtahatqrlkngh9slya",
                "tmYXBYJj1K7vhNWkZZR1E6MKJq1FMGPTq1b",
                0.5,
            )
            .await;

        assert!(result.is_ok());
        assert_eq!(
            result.unwrap(),
            "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2"
        );
    }

    #[test]
    fn test_as_f64_success() {
        let value = serde_json::json!(3.14);
        let result = as_f64(value);
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), 3.14);
    }

    #[test]
    fn test_as_f64_failure() {
        let value = serde_json::json!("not a number");
        let result = as_f64(value);
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("expected number"));
    }

    #[test]
    fn test_as_string_success() {
        let value = serde_json::json!("hello");
        let result = as_string(value);
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), "hello");
    }

    #[test]
    fn test_as_string_failure() {
        let value = serde_json::json!(42);
        let result = as_string(value);
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("expected string"));
    }
}
