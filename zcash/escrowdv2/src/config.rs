use crate::error::AppError;
use std::env;
use std::path::{Path, PathBuf};

#[derive(Clone, Debug)]
pub struct Config {
    pub listen_addr: std::net::SocketAddr,
    pub data_dir: PathBuf,
    pub escrow_address_type: AddressType,
    pub mina_endpoint: String,
    pub mina_to_pubkey: String,
    pub api_key: String,
    pub fee_cap_multiplier: f64,
    pub funding_min_zec: f64,
    pub mina_min_amount: f64,
    pub operator_token: Option<String>,
    pub zcashd_rpc_url: String,
    pub zcashd_rpc_user: String,
    pub zcashd_rpc_pass: String,
    // Lightwalletd additions
    pub lightwalletd_url: String,
    pub network: Network,
    pub birth_height: Option<u32>,
    pub sapling_spend_path: PathBuf,
    pub sapling_output_path: PathBuf,
}

#[derive(Clone, Debug)]
pub enum Network {
    Mainnet,
    Testnet,
}

impl Config {
    pub fn from_env() -> Result<Self, AppError> {
        let listen_addr: std::net::SocketAddr = env::var("LISTEN_ADDR")
            .unwrap_or_else(|_| "127.0.0.1:8080".to_string())
            .parse()
            .map_err(|e| AppError::Config(format!("invalid LISTEN_ADDR: {e}")))?;

        let data_dir = env::var("DATA_DIR").unwrap_or_else(|_| "./data".to_string());

        let escrow_address_type = env::var("ESCROW_ADDR_TYPE")
            .unwrap_or_else(|_| "shielded".to_string())
            .parse()
            .map_err(|e| AppError::Config(format!("invalid ESCROW_ADDR_TYPE: {e}")))?;
        let mina_endpoint = env::var("MINA_ENDPOINT")
            .unwrap_or_else(|_| "https://api.minascan.io/archive/devnet/v1/graphql".to_string());
        let mina_to_pubkey =
            env::var("MINA_TO_PUBKEY").unwrap_or_else(|_| "SET_MINA_TO_PUBKEY".to_string());
        let api_key = env::var("API_KEY").unwrap_or_else(|_| "SET_API_KEY".to_string());
        let fee_cap_multiplier: f64 = env::var("FEE_CAP_MULTIPLIER")
            .ok()
            .and_then(|v| v.parse::<f64>().ok())
            .unwrap_or(5.0);
        let funding_min_zec: f64 = env::var("FUNDING_MIN_ZEC")
            .ok()
            .and_then(|v| v.parse::<f64>().ok())
            .unwrap_or(0.001);
        let mina_min_amount: f64 = env::var("MINA_MIN_AMOUNT")
            .ok()
            .and_then(|v| v.parse::<f64>().ok())
            .unwrap_or(0.001);
        let operator_token = env::var("OPERATOR_TOKEN").ok();

        let data_dir_path = Path::new(&data_dir).to_path_buf();

        let zcashd_rpc_url =
            env::var("ZCASHD_RPC_URL").unwrap_or_else(|_| "http://127.0.0.1:18232".to_string());
        let zcashd_rpc_user =
            env::var("ZCASHD_RPC_USER").unwrap_or_else(|_| "zcashrpc".to_string());
        let zcashd_rpc_pass =
            env::var("ZCASHD_RPC_PASS").unwrap_or_else(|_| "changeme".to_string());

        let lightwalletd_url =
            env::var("LIGHTWALLETD_URL").unwrap_or_else(|_| "http://127.0.0.1:9067".to_string());
        let network = match env::var("NETWORK")
            .unwrap_or_else(|_| "testnet".to_string())
            .to_lowercase()
            .as_str()
        {
            "mainnet" | "main" => Network::Mainnet,
            _ => Network::Testnet,
        };
        let birth_height = env::var("LIGHTWALLETD_BIRTH_HEIGHT")
            .ok()
            .and_then(|v| v.parse::<u32>().ok());

        let params_dir = env::var("ZCASH_PARAMS_DIR")
            .ok()
            .map(PathBuf::from)
            .or_else(|| {
                env::var("HOME")
                    .ok()
                    .map(|home| Path::new(&home).join(".zcash-params"))
            })
            .unwrap_or_else(|| PathBuf::from("."));
        let sapling_spend_path = env::var("SAPLING_SPEND_PATH")
            .map(PathBuf::from)
            .unwrap_or_else(|_| params_dir.join("sapling-spend.params"));
        let sapling_output_path = env::var("SAPLING_OUTPUT_PATH")
            .map(PathBuf::from)
            .unwrap_or_else(|_| params_dir.join("sapling-output.params"));

        Ok(Self {
            listen_addr,
            data_dir: data_dir_path,
            escrow_address_type,
            mina_endpoint,
            mina_to_pubkey,
            api_key,
            fee_cap_multiplier,
            funding_min_zec,
            mina_min_amount,
            operator_token,
            zcashd_rpc_url,
            zcashd_rpc_user,
            zcashd_rpc_pass,
            lightwalletd_url,
            network,
            birth_height,
            sapling_spend_path,
            sapling_output_path,
        })
    }

    /// Creates a test configuration with sensible defaults for testing
    /// This is always available to support integration tests
    #[allow(dead_code)]
    pub fn default_test() -> Self {
        use tempfile::TempDir;
        let temp_dir = TempDir::new().expect("Failed to create temp dir");
        let data_dir = temp_dir.path().to_path_buf();

        Self {
            listen_addr: "127.0.0.1:0".parse().unwrap(),
            data_dir: data_dir.clone(),
            escrow_address_type: AddressType::Shielded,
            mina_endpoint: "https://api.minascan.io/archive/devnet/v1/graphql".to_string(),
            mina_to_pubkey: "B62qod2DugDjy9Jxhzd56gFS7npN8pWhanxxb36MLPzDDqtzzDyBy5z".to_string(),
            api_key: "test_api_key_12345".to_string(),
            fee_cap_multiplier: 2.0,
            funding_min_zec: 0.01,
            mina_min_amount: 1.0,
            operator_token: Some("test_operator_token_67890".to_string()),
            zcashd_rpc_url: "http://localhost:18232".to_string(),
            zcashd_rpc_user: "zcashrpc".to_string(),
            zcashd_rpc_pass: "test_password".to_string(),
            lightwalletd_url: "http://localhost:19067".to_string(),
            network: Network::Testnet,
            birth_height: Some(1000000),
            sapling_spend_path: data_dir.join("sapling-spend.params"),
            sapling_output_path: data_dir.join("sapling-output.params"),
        }
    }
}

#[derive(Clone, Debug)]
pub enum AddressType {
    Shielded,
    Transparent,
}

impl std::str::FromStr for AddressType {
    type Err = String;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.to_lowercase().as_str() {
            "shielded" | "z" => Ok(AddressType::Shielded),
            "transparent" | "t" => Ok(AddressType::Transparent),
            other => Err(format!("unknown address type {other}")),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serial_test::serial;
    use std::env;

    // Helper to clear environment variables before each test
    fn clear_test_env() {
        unsafe {
            env::remove_var("LISTEN_ADDR");
            env::remove_var("DATA_DIR");
            env::remove_var("ESCROW_ADDR_TYPE");
            env::remove_var("MINA_ENDPOINT");
            env::remove_var("MINA_TO_PUBKEY");
            env::remove_var("API_KEY");
            env::remove_var("FEE_CAP_MULTIPLIER");
            env::remove_var("FUNDING_MIN_ZEC");
            env::remove_var("MINA_MIN_AMOUNT");
            env::remove_var("OPERATOR_TOKEN");
            env::remove_var("ZCASHD_RPC_URL");
            env::remove_var("ZCASHD_RPC_USER");
            env::remove_var("ZCASHD_RPC_PASS");
        }
    }

    #[test]
    #[serial]
    fn test_config_defaults() {
        clear_test_env();
        let config = Config::from_env().unwrap();

        // Verify default values
        assert_eq!(config.listen_addr.to_string(), "127.0.0.1:8080");
        assert_eq!(config.data_dir.to_str().unwrap(), "./data");
        assert!(matches!(config.escrow_address_type, AddressType::Shielded));
        assert_eq!(
            config.mina_endpoint,
            "https://api.minascan.io/archive/devnet/v1/graphql"
        );
        assert_eq!(config.mina_to_pubkey, "SET_MINA_TO_PUBKEY");
        assert_eq!(config.api_key, "SET_API_KEY");
        assert_eq!(config.fee_cap_multiplier, 5.0);
        assert_eq!(config.funding_min_zec, 0.001);
        assert_eq!(config.mina_min_amount, 0.001);
        assert_eq!(config.operator_token, None);
        assert_eq!(config.zcashd_rpc_url, "http://127.0.0.1:18232");
        assert_eq!(config.zcashd_rpc_user, "zcashrpc");
        assert_eq!(config.zcashd_rpc_pass, "changeme");
    }

    #[test]
    #[serial]
    fn test_config_custom_values() {
        clear_test_env();

        // Set realistic testnet values
        unsafe {
            env::set_var("LISTEN_ADDR", "0.0.0.0:8423");
            env::set_var("DATA_DIR", "/var/lib/escrowd");
            env::set_var("ESCROW_ADDR_TYPE", "transparent");
            env::set_var("MINA_ENDPOINT", "https://devnet.zeko.io/graphql");
            env::set_var(
                "MINA_TO_PUBKEY",
                "B62qod2DugDjy9Jxhzd56gFS7npN8pWhanxxb36MLPzDDqtzzDyBy5z",
            );
            env::set_var("API_KEY", "sk_test_51H8Kj2KuD8aZ6xY3MpN4vQ7wR");
            env::set_var("FEE_CAP_MULTIPLIER", "3.5");
            env::set_var("FUNDING_MIN_ZEC", "0.0005");
            env::set_var("MINA_MIN_AMOUNT", "0.1");
            env::set_var("OPERATOR_TOKEN", "op_secret_abc123");
            env::set_var("ZCASHD_RPC_URL", "https://zcashd.example.com:18232");
            env::set_var("ZCASHD_RPC_USER", "testuser");
            env::set_var("ZCASHD_RPC_PASS", "testpass123");
        }

        let config = Config::from_env().unwrap();

        assert_eq!(config.listen_addr.to_string(), "0.0.0.0:8423");
        assert_eq!(config.data_dir.to_str().unwrap(), "/var/lib/escrowd");
        assert!(matches!(
            config.escrow_address_type,
            AddressType::Transparent
        ));
        assert_eq!(config.mina_endpoint, "https://devnet.zeko.io/graphql");
        assert_eq!(
            config.mina_to_pubkey,
            "B62qod2DugDjy9Jxhzd56gFS7npN8pWhanxxb36MLPzDDqtzzDyBy5z"
        );
        assert_eq!(config.api_key, "sk_test_51H8Kj2KuD8aZ6xY3MpN4vQ7wR");
        assert_eq!(config.fee_cap_multiplier, 3.5);
        assert_eq!(config.funding_min_zec, 0.0005);
        assert_eq!(config.mina_min_amount, 0.1);
        assert_eq!(config.operator_token, Some("op_secret_abc123".to_string()));
        assert_eq!(config.zcashd_rpc_url, "https://zcashd.example.com:18232");
        assert_eq!(config.zcashd_rpc_user, "testuser");
        assert_eq!(config.zcashd_rpc_pass, "testpass123");
    }

    #[test]
    #[serial]
    fn test_config_invalid_listen_addr() {
        clear_test_env();
        unsafe {
            env::set_var("LISTEN_ADDR", "invalid-address");
        }

        let result = Config::from_env();
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(err.to_string().contains("invalid LISTEN_ADDR"));
    }

    #[test]
    #[serial]
    fn test_config_invalid_escrow_addr_type() {
        clear_test_env();
        unsafe {
            env::set_var("ESCROW_ADDR_TYPE", "invalid_type");
        }

        let result = Config::from_env();
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(err.to_string().contains("invalid ESCROW_ADDR_TYPE"));
    }

    #[test]
    #[serial]
    fn test_config_numeric_parsing() {
        clear_test_env();

        // Test valid numeric values
        unsafe {
            env::set_var("FEE_CAP_MULTIPLIER", "2.75");
            env::set_var("FUNDING_MIN_ZEC", "0.025");
            env::set_var("MINA_MIN_AMOUNT", "50.5");
        }

        let config = Config::from_env().unwrap();
        assert_eq!(config.fee_cap_multiplier, 2.75);
        assert_eq!(config.funding_min_zec, 0.025);
        assert_eq!(config.mina_min_amount, 50.5);
    }

    #[test]
    #[serial]
    fn test_config_invalid_numeric_falls_back_to_default() {
        clear_test_env();

        // Set invalid numeric values - should fall back to defaults
        unsafe {
            env::set_var("FEE_CAP_MULTIPLIER", "not-a-number");
            env::set_var("FUNDING_MIN_ZEC", "invalid");
            env::set_var("MINA_MIN_AMOUNT", "xyz");
        }

        let config = Config::from_env().unwrap();
        assert_eq!(config.fee_cap_multiplier, 5.0); // default
        assert_eq!(config.funding_min_zec, 0.001); // default
        assert_eq!(config.mina_min_amount, 0.001); // default
    }

    #[test]
    fn test_address_type_parsing_shielded() {
        assert!(matches!(
            "shielded".parse::<AddressType>().unwrap(),
            AddressType::Shielded
        ));
        assert!(matches!(
            "z".parse::<AddressType>().unwrap(),
            AddressType::Shielded
        ));
        assert!(matches!(
            "SHIELDED".parse::<AddressType>().unwrap(),
            AddressType::Shielded
        ));
        assert!(matches!(
            "Z".parse::<AddressType>().unwrap(),
            AddressType::Shielded
        ));
    }

    #[test]
    fn test_address_type_parsing_transparent() {
        assert!(matches!(
            "transparent".parse::<AddressType>().unwrap(),
            AddressType::Transparent
        ));
        assert!(matches!(
            "t".parse::<AddressType>().unwrap(),
            AddressType::Transparent
        ));
        assert!(matches!(
            "TRANSPARENT".parse::<AddressType>().unwrap(),
            AddressType::Transparent
        ));
        assert!(matches!(
            "T".parse::<AddressType>().unwrap(),
            AddressType::Transparent
        ));
    }

    #[test]
    fn test_address_type_parsing_invalid() {
        let result = "invalid".parse::<AddressType>();
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), "unknown address type invalid");
    }

    #[test]
    #[serial]
    fn test_operator_token_optional() {
        clear_test_env();

        // Without OPERATOR_TOKEN
        let config = Config::from_env().unwrap();
        assert_eq!(config.operator_token, None);

        // With OPERATOR_TOKEN
        unsafe {
            env::set_var("OPERATOR_TOKEN", "secret_token_xyz");
        }
        let config = Config::from_env().unwrap();
        assert_eq!(config.operator_token, Some("secret_token_xyz".to_string()));
    }
}
