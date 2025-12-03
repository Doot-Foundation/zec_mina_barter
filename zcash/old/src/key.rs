use crate::config::Config;
use crate::error::AppError;
use rand::RngCore;
use ring::aead::{AES_256_GCM, Aad, LessSafeKey, NONCE_LEN, Nonce, UnboundKey};
use ring::hkdf;
use ring::rand::{SecureRandom, SystemRandom};
use serde::Serialize;
use std::fs;
use std::fs::OpenOptions;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use zcash_keys::keys::{UnifiedAddressRequest, UnifiedSpendingKey};
use zcash_protocol::consensus::TEST_NETWORK;
use zeroize::Zeroizing;
use zip32::AccountId;

#[derive(Clone)]
#[allow(dead_code)]
pub struct KeyManager {
    ua: String,
    ufvk: String,
    data_dir: PathBuf,
    salt_path: PathBuf,
    sealed_key_path: PathBuf,
    seed: Zeroizing<Vec<u8>>,
}

#[derive(Clone, Debug, Serialize)]
pub struct FeePolicy {
    pub bump_on_timeout: f64,
    pub max_multiplier: f64,
}

impl KeyManager {
    pub fn init(config: &Config) -> Result<Self, AppError> {
        let data_dir = config.data_dir.clone();
        if !data_dir.exists() {
            fs::create_dir_all(&data_dir)?;
        }

        let salt_path = data_dir.join("salt");
        let sealed_key_path = data_dir.join("escrow.sealed");

        if !salt_path.exists() {
            write_random_file(&salt_path, 32)?;
            set_permissions_owner_read_write(&salt_path)?;
        }

        let salt = read_file(&salt_path)?;
        let seed = if sealed_key_path.exists() {
            unseal_seed(&sealed_key_path, &salt)?
        } else {
            let new_seed = random_bytes(64)?;
            seal_seed(&sealed_key_path, &salt, &new_seed)?;
            set_permissions_owner_read_write(&sealed_key_path)?;
            new_seed
        };

        let (ua, ufvk) = derive_ua_and_ufvk_from_seed(&seed)?;

        Ok(Self {
            ua,
            ufvk,
            data_dir,
            salt_path,
            sealed_key_path,
            seed: Zeroizing::new(seed),
        })
    }

    pub fn unified_full_viewing_key(&self) -> &str {
        &self.ufvk
    }

    pub fn cleanup_after_send(&self) -> Result<(), AppError> {
        if self.sealed_key_path.exists() {
            fs::remove_file(&self.sealed_key_path)?;
        }
        // zeroize happens on drop of Zeroizing<seed>
        Ok(())
    }
}

fn write_random_file(path: &Path, len: usize) -> Result<(), AppError> {
    let mut buf = vec![0u8; len];
    rand::thread_rng().fill_bytes(&mut buf);
    let mut file = OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(true)
        .open(path)?;
    file.write_all(&buf)?;
    Ok(())
}

fn read_file(path: &Path) -> Result<Vec<u8>, AppError> {
    let mut file = OpenOptions::new().read(true).open(path)?;
    let mut buf = Vec::new();
    file.read_to_end(&mut buf)?;
    Ok(buf)
}

fn set_permissions_owner_read_write(path: &Path) -> Result<(), AppError> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let perms = fs::Permissions::from_mode(0o600);
        fs::set_permissions(path, perms)?;
    }
    Ok(())
}

fn random_bytes(len: usize) -> Result<Vec<u8>, AppError> {
    let mut buf = vec![0u8; len];
    rand::thread_rng().fill_bytes(&mut buf);
    Ok(buf)
}

fn derive_wrap_key(salt: &[u8]) -> Result<LessSafeKey, AppError> {
    let salt = hkdf::Salt::new(hkdf::HKDF_SHA256, salt);
    let prk = salt.extract(b"zcash-escrowd");
    let okm = prk
        .expand(&[b"wrap-key"], WrapKeyLen)
        .map_err(|_| AppError::Crypto)?;
    let mut key = [0u8; 32];
    okm.fill(&mut key).map_err(|_| AppError::Crypto)?;
    let unbound = UnboundKey::new(&AES_256_GCM, &key).map_err(|_| AppError::Crypto)?;
    Ok(LessSafeKey::new(unbound))
}

struct WrapKeyLen;
impl hkdf::KeyType for WrapKeyLen {
    fn len(&self) -> usize {
        32
    }
}

fn seal_seed(path: &Path, salt: &[u8], seed: &[u8]) -> Result<(), AppError> {
    let wrap_key = derive_wrap_key(salt)?;
    let rng = SystemRandom::new();
    let mut nonce_bytes = [0u8; NONCE_LEN];
    rng.fill(&mut nonce_bytes).map_err(|_| AppError::Crypto)?;
    let nonce = Nonce::assume_unique_for_key(nonce_bytes);

    let mut in_out = seed.to_vec();
    wrap_key
        .seal_in_place_append_tag(nonce, Aad::empty(), &mut in_out)
        .map_err(|_| AppError::Crypto)?;

    let mut file = OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(true)
        .open(path)?;
    file.write_all(b"ESCROW1")?;
    file.write_all(&nonce_bytes)?;
    file.write_all(&in_out)?;
    Ok(())
}

fn unseal_seed(path: &Path, salt: &[u8]) -> Result<Vec<u8>, AppError> {
    let wrap_key = derive_wrap_key(salt)?;
    let data = read_file(path)?;
    if data.len() < 7 + NONCE_LEN {
        return Err(AppError::Crypto);
    }
    if &data[..7] != b"ESCROW1" {
        return Err(AppError::Crypto);
    }
    let offset = 7;
    let nonce_bytes: [u8; NONCE_LEN] = data[offset..offset + NONCE_LEN]
        .try_into()
        .map_err(|_| AppError::Crypto)?;
    let nonce = Nonce::assume_unique_for_key(nonce_bytes);
    let mut ciphertext = data[offset + NONCE_LEN..].to_vec();
    let plain = wrap_key
        .open_in_place(nonce, Aad::empty(), &mut ciphertext)
        .map_err(|_| AppError::Crypto)?;
    Ok(plain.to_vec())
}

fn derive_ua_and_ufvk_from_seed(seed: &[u8]) -> Result<(String, String), AppError> {
    let params = TEST_NETWORK;
    let account = AccountId::try_from(0u32).map_err(|_| AppError::Crypto)?;
    let usk =
        UnifiedSpendingKey::from_seed(&params, seed, account).map_err(|_| AppError::Crypto)?;
    let ufvk = usk.to_unified_full_viewing_key();
    use zcash_keys::keys::ReceiverRequirement;
    // Require Orchard + Transparent, omit Sapling (matches prior intent of orchard+transparent UA)
    let request = UnifiedAddressRequest::unsafe_custom(
        ReceiverRequirement::Require,
        ReceiverRequirement::Omit,
        ReceiverRequirement::Require,
    );
    let (ua, _) = ufvk
        .default_address(request)
        .map_err(|_| AppError::Crypto)?;
    let ua_encoded = ua.encode(&params);
    let ufvk_encoded = ufvk.encode(&params);
    Ok((ua_encoded, ufvk_encoded))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    // Helper to create a test config with temporary directory
    fn test_config() -> (Config, TempDir) {
        let temp_dir = TempDir::new().unwrap();
        let config = Config {
            listen_addr: "127.0.0.1:8080".parse().unwrap(),
            data_dir: temp_dir.path().to_path_buf(),
            escrow_address_type: crate::config::AddressType::Shielded,
            mina_endpoint: "http://localhost:1234/graphql".to_string(),
            mina_to_pubkey: "B62qod2DugDjy9Jxhzd56gFS7npN8pWhanxxb36MLPzDDqtzzDyBy5z".to_string(),
            api_key: "test_api_key".to_string(),
            fee_cap_multiplier: 5.0,
            funding_min_zec: 0.001,
            mina_min_amount: 0.001,
            operator_token: Some("operator_secret".to_string()),
            zcashd_rpc_url: "http://localhost:18232".to_string(),
            zcashd_rpc_user: "zcashrpc".to_string(),
            zcashd_rpc_pass: "changeme".to_string(),
        };
        (config, temp_dir)
    }

    #[test]
    fn test_key_manager_init_creates_new_keys() {
        let (config, _temp_dir) = test_config();

        let km = KeyManager::init(&config).unwrap();

        // Verify data directory was created
        assert!(config.data_dir.exists());

        // Verify salt file was created
        let salt_path = config.data_dir.join("salt");
        assert!(salt_path.exists());
        let salt = std::fs::read(&salt_path).unwrap();
        assert_eq!(salt.len(), 32);

        // Verify sealed key file was created
        let sealed_path = config.data_dir.join("escrow.sealed");
        assert!(sealed_path.exists());

        // Verify UFVK is not empty
        assert!(!km.unified_full_viewing_key().is_empty());
        assert!(km.unified_full_viewing_key().starts_with("uview"));
    }

    #[test]
    fn test_key_manager_init_loads_existing_keys() {
        let (config, _temp_dir) = test_config();

        // First initialization
        let km1 = KeyManager::init(&config).unwrap();
        let ufvk1 = km1.unified_full_viewing_key().to_string();

        // Second initialization with same data_dir should load same keys
        let km2 = KeyManager::init(&config).unwrap();
        let ufvk2 = km2.unified_full_viewing_key().to_string();

        assert_eq!(ufvk1, ufvk2, "UFVK should be identical when loading existing keys");
    }

    #[test]
    fn test_seal_and_unseal_seed() {
        let temp_dir = TempDir::new().unwrap();
        let sealed_path = temp_dir.path().join("test.sealed");
        let salt = b"test_salt_32_bytes_long_enough!";

        // Create a realistic 64-byte test seed
        let original_seed = vec![
            0x01, 0x23, 0x45, 0x67, 0x89, 0xab, 0xcd, 0xef,
            0xfe, 0xdc, 0xba, 0x98, 0x76, 0x54, 0x32, 0x10,
            0x0f, 0x1e, 0x2d, 0x3c, 0x4b, 0x5a, 0x69, 0x78,
            0x87, 0x96, 0xa5, 0xb4, 0xc3, 0xd2, 0xe1, 0xf0,
            0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88,
            0x99, 0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff, 0x00,
            0x00, 0xff, 0xee, 0xdd, 0xcc, 0xbb, 0xaa, 0x99,
            0x88, 0x77, 0x66, 0x55, 0x44, 0x33, 0x22, 0x11,
        ];

        // Seal the seed
        seal_seed(&sealed_path, salt, &original_seed).unwrap();
        assert!(sealed_path.exists());

        // Unseal and verify
        let unsealed_seed = unseal_seed(&sealed_path, salt).unwrap();
        assert_eq!(original_seed, unsealed_seed, "Unsealed seed should match original");
    }

    #[test]
    fn test_unseal_seed_with_wrong_salt_fails() {
        let temp_dir = TempDir::new().unwrap();
        let sealed_path = temp_dir.path().join("test.sealed");
        let salt1 = b"salt1_32_bytes_long_enough_here!";
        let salt2 = b"salt2_32_bytes_different_salt!!!";
        let seed = vec![0x42; 64];

        // Seal with salt1
        seal_seed(&sealed_path, salt1, &seed).unwrap();

        // Try to unseal with salt2 - should fail
        let result = unseal_seed(&sealed_path, salt2);
        assert!(result.is_err(), "Unsealing with wrong salt should fail");
    }

    #[test]
    fn test_unseal_seed_with_corrupted_file_fails() {
        let temp_dir = TempDir::new().unwrap();
        let sealed_path = temp_dir.path().join("corrupted.sealed");
        let salt = b"test_salt_32_bytes_long_enough!";

        // Write corrupted data (invalid header)
        std::fs::write(&sealed_path, b"INVALID_HEADER").unwrap();

        let result = unseal_seed(&sealed_path, salt);
        assert!(result.is_err(), "Corrupted file should fail to unseal");
    }

    #[test]
    fn test_derive_ua_and_ufvk_deterministic() {
        // Test that same seed produces same UA/UFVK
        let seed = vec![0x42; 64];

        let (ua1, ufvk1) = derive_ua_and_ufvk_from_seed(&seed).unwrap();
        let (ua2, ufvk2) = derive_ua_and_ufvk_from_seed(&seed).unwrap();

        assert_eq!(ua1, ua2, "Same seed should produce same UA");
        assert_eq!(ufvk1, ufvk2, "Same seed should produce same UFVK");

        // Verify format
        assert!(ua1.starts_with("utest"), "UA should start with utest for testnet");
        assert!(ufvk1.starts_with("uview"), "UFVK should start with uview");
    }

    #[test]
    fn test_derive_ua_and_ufvk_different_seeds() {
        // Test that different seeds produce different addresses
        let seed1 = vec![0x01; 64];
        let seed2 = vec![0x02; 64];

        let (ua1, ufvk1) = derive_ua_and_ufvk_from_seed(&seed1).unwrap();
        let (ua2, ufvk2) = derive_ua_and_ufvk_from_seed(&seed2).unwrap();

        assert_ne!(ua1, ua2, "Different seeds should produce different UAs");
        assert_ne!(ufvk1, ufvk2, "Different seeds should produce different UFVKs");
    }

    #[test]
    fn test_cleanup_after_send() {
        let (config, _temp_dir) = test_config();

        let km = KeyManager::init(&config).unwrap();
        let sealed_path = config.data_dir.join("escrow.sealed");
        assert!(sealed_path.exists(), "Sealed key should exist before cleanup");

        km.cleanup_after_send().unwrap();
        assert!(!sealed_path.exists(), "Sealed key should be removed after cleanup");
    }

    #[test]
    fn test_random_bytes_generates_correct_length() {
        let bytes = random_bytes(32).unwrap();
        assert_eq!(bytes.len(), 32);

        let bytes2 = random_bytes(64).unwrap();
        assert_eq!(bytes2.len(), 64);

        // Verify randomness - bytes should not be all zeros
        assert!(bytes.iter().any(|&b| b != 0));
        assert!(bytes2.iter().any(|&b| b != 0));
    }

    #[test]
    fn test_write_and_read_file() {
        let temp_dir = TempDir::new().unwrap();
        let file_path = temp_dir.path().join("test_file");

        // Write random file
        write_random_file(&file_path, 64).unwrap();
        assert!(file_path.exists());

        // Read and verify length
        let data = read_file(&file_path).unwrap();
        assert_eq!(data.len(), 64);

        // Verify not all zeros
        assert!(data.iter().any(|&b| b != 0));
    }

    #[test]
    #[cfg(unix)]
    fn test_set_permissions_owner_read_write() {
        use std::os::unix::fs::PermissionsExt;

        let temp_dir = TempDir::new().unwrap();
        let file_path = temp_dir.path().join("test_perms");
        std::fs::write(&file_path, b"test").unwrap();

        set_permissions_owner_read_write(&file_path).unwrap();

        let metadata = std::fs::metadata(&file_path).unwrap();
        let mode = metadata.permissions().mode();
        assert_eq!(mode & 0o777, 0o600, "File should have 0600 permissions");
    }
}
