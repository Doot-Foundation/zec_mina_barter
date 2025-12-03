use crate::config::{Config, Network};
use crate::error::AppError;
use crate::key::KeyManager;
use async_trait::async_trait;
use prost::Message;
use rand::{rngs::StdRng, SeedableRng};
use secrecy::SecretVec;
use std::io;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::Mutex;
use tokio::task;
use tonic::transport::Channel;
use zcash_client_backend::data_api::{
    chain::BlockCache, scanning::ScanRange, Account, AccountBirthday, AccountPurpose,
    BirthdayError, WalletRead, WalletWrite,
};
use zcash_client_backend::proto::compact_formats::CompactBlock;
use zcash_client_backend::proto::service::{
    compact_tx_streamer_client::CompactTxStreamerClient, BlockId, Empty,
};
use zcash_client_backend::sync;
use zcash_client_sqlite::error::SqliteClientError;
use zcash_client_sqlite::wallet::init::init_wallet_db;
use zcash_client_sqlite::{AccountUuid, WalletDb};
use zcash_keys::keys::UnifiedFullViewingKey;
use zcash_protocol::consensus::{BlockHeight, Network as ConsensusNetwork};

pub type WalletDbConn = WalletDb<
    rusqlite::Connection,
    ConsensusNetwork,
    zcash_client_sqlite::util::SystemClock,
    StdRng,
>;

/// Handle that owns the wallet database, block cache, and lightwalletd client.
#[derive(Clone)]
pub struct Lightwallet {
    inner: Arc<LightwalletInner>,
}

struct LightwalletInner {
    account: AccountUuid,
    params: ConsensusNetwork,
    #[allow(dead_code)]
    network: Network,
    wallet_db: Mutex<WalletDbConn>,
    cache: SqliteBlockCache,
    grpc: Mutex<CompactTxStreamerClient<Channel>>,
}

impl Lightwallet {
    pub async fn initialize(config: &Config, key_manager: &KeyManager) -> Result<Self, AppError> {
        let params = match config.network {
            Network::Mainnet => ConsensusNetwork::MainNetwork,
            Network::Testnet => ConsensusNetwork::TestNetwork,
        };

        let base = config.data_dir.join("lightwalletd");
        std::fs::create_dir_all(&base)?;
        let cache = SqliteBlockCache::new(base.join("cache.sqlite"))?;

        let wallet_path = base.join("wallet.sqlite");
        let mut wallet_db = WalletDb::for_path(
            &wallet_path,
            params.clone(),
            zcash_client_sqlite::util::SystemClock,
            StdRng::from_entropy(),
        )?;
        if let Err(e) = init_wallet_db(&mut wallet_db, Some(load_seed(key_manager))) {
            return Err(AppError::Wallet(format!("wallet migration failed: {e:?}")));
        }

        let ufvk = UnifiedFullViewingKey::decode(&params, key_manager.unified_full_viewing_key())
            .map_err(|e| AppError::Config(format!("invalid UFVK encoding: {e}")))?;

        let mut grpc = CompactTxStreamerClient::new(
            Channel::from_shared(config.lightwalletd_url.clone())?
                .connect()
                .await?,
        );
        let birthday = determine_birthday(&mut grpc, config).await?;

        let account = if let Some(existing) = wallet_db.get_account_for_ufvk(&ufvk)? {
            existing.id()
        } else {
            wallet_db
                .import_account_ufvk(
                    "escrow",
                    &ufvk,
                    &birthday,
                    AccountPurpose::Spending { derivation: None },
                    None,
                )?
                .id()
        };

        let lightwallet = Self {
            inner: Arc::new(LightwalletInner {
                account,
                params,
                network: key_manager.network(),
                wallet_db: Mutex::new(wallet_db),
                cache,
                grpc: Mutex::new(grpc),
            }),
        };

        lightwallet.sync().await?;
        Ok(lightwallet)
    }

    pub fn account_id(&self) -> AccountUuid {
        self.inner.account
    }

    #[allow(dead_code)]
    pub fn params(&self) -> ConsensusNetwork {
        self.inner.params
    }

    #[allow(dead_code)]
    pub fn network(&self) -> Network {
        self.inner.network.clone()
    }

    pub async fn sync(&self) -> Result<(), AppError> {
        let mut grpc = self.inner.grpc.lock().await;
        let mut wallet_db = self.inner.wallet_db.lock().await;
        let cache = self.inner.cache.clone();
        sync::run(&mut grpc, &self.inner.params, &cache, &mut *wallet_db, 100)
            .await
            .map_err(|e| AppError::Wallet(format!("lightwallet sync failed: {e:?}")))
    }

    pub async fn with_wallet_db<F, R>(&self, f: F) -> Result<R, AppError>
    where
        F: FnOnce(&mut WalletDbConn) -> Result<R, AppError> + Send + 'static,
        R: Send + 'static,
    {
        let mut db = self.inner.wallet_db.lock().await;
        f(&mut db)
    }

    #[allow(dead_code)]
    pub fn cache(&self) -> SqliteBlockCache {
        self.inner.cache.clone()
    }
}

async fn determine_birthday(
    client: &mut CompactTxStreamerClient<Channel>,
    config: &Config,
) -> Result<AccountBirthday, AppError> {
    let treestate = if let Some(height) = config.birth_height {
        let prev = height.saturating_sub(1);
        client
            .get_tree_state(BlockId {
                height: prev as u64,
                hash: vec![],
            })
            .await?
            .into_inner()
    } else {
        client.get_latest_tree_state(Empty {}).await?.into_inner()
    };
    AccountBirthday::from_treestate(treestate, None).map_err(|e| match e {
        BirthdayError::HeightInvalid(err) => {
            AppError::Config(format!("invalid birth height: {err}"))
        }
        BirthdayError::Decode(err) => AppError::Config(format!("invalid treestate: {err}")),
    })
}

fn load_seed(key_manager: &KeyManager) -> SecretVec<u8> {
    key_manager.seed_secret()
}

/// Simple sqlite-backed block cache used for lightwalletd sync.
#[derive(Clone)]
pub struct SqliteBlockCache {
    conn: Arc<parking_lot::Mutex<rusqlite::Connection>>,
}

impl SqliteBlockCache {
    pub fn new(path: PathBuf) -> Result<Self, AppError> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let conn = rusqlite::Connection::open(path)?;
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS compactblocks (
                height INTEGER PRIMARY KEY,
                data   BLOB NOT NULL
            );",
        )?;
        Ok(Self {
            conn: Arc::new(parking_lot::Mutex::new(conn)),
        })
    }

    fn read_range(
        conn: &rusqlite::Connection,
        start: BlockHeight,
        end: BlockHeight,
    ) -> Result<Vec<CompactBlock>, SqliteClientError> {
        let mut stmt = conn.prepare(
            "SELECT height, data FROM compactblocks
             WHERE height >= ?1 AND height < ?2
             ORDER BY height ASC",
        )?;
        let rows = stmt.query_map(
            (i64::from(u32::from(start)), i64::from(u32::from(end))),
            |row| {
                let data: Vec<u8> = row.get(1)?;
                let block = CompactBlock::decode(&data[..]).map_err(|e| {
                    rusqlite::Error::FromSqlConversionFailure(
                        data.len(),
                        rusqlite::types::Type::Blob,
                        Box::new(e),
                    )
                })?;
                Ok(block)
            },
        )?;
        let mut blocks = Vec::new();
        for block in rows {
            blocks.push(block?);
        }
        Ok(blocks)
    }

    async fn blocking_task<F, R>(&self, f: F) -> Result<R, SqliteClientError>
    where
        F: FnOnce(&mut rusqlite::Connection) -> Result<R, SqliteClientError> + Send + 'static,
        R: Send + 'static,
    {
        let conn = self.conn.clone();
        task::spawn_blocking(move || {
            let mut guard = conn.lock();
            f(&mut guard)
        })
        .await
        .map_err(|e| SqliteClientError::Io(io::Error::new(io::ErrorKind::Other, e.to_string())))?
    }
}

#[async_trait]
impl BlockCache for SqliteBlockCache {
    fn get_tip_height(
        &self,
        range: Option<&ScanRange>,
    ) -> Result<Option<BlockHeight>, Self::Error> {
        let conn = self.conn.lock();
        if let Some(scan) = range {
            let start = scan.block_range().start;
            let end = scan.block_range().end;
            let mut stmt = conn.prepare(
                "SELECT MAX(height) FROM compactblocks WHERE height >= ?1 AND height < ?2",
            )?;
            let max: Option<i64> = stmt.query_row(
                (i64::from(u32::from(start)), i64::from(u32::from(end))),
                |row| row.get(0),
            )?;
            Ok(max.map(|h| BlockHeight::from_u32(h as u32)))
        } else {
            let mut stmt = conn.prepare("SELECT MAX(height) FROM compactblocks")?;
            let max: Option<i64> = stmt.query_row([], |row| row.get(0))?;
            Ok(max.map(|h| BlockHeight::from_u32(h as u32)))
        }
    }

    async fn read(&self, range: &ScanRange) -> Result<Vec<CompactBlock>, Self::Error> {
        let start = range.block_range().start;
        let end = range.block_range().end;
        self.blocking_task(move |conn| Self::read_range(conn, start, end))
            .await
    }

    async fn insert(&self, compact_blocks: Vec<CompactBlock>) -> Result<(), Self::Error> {
        self.blocking_task(move |conn| {
            let tx = conn.transaction()?;
            {
                let mut stmt = tx.prepare(
                    "INSERT OR REPLACE INTO compactblocks (height, data) VALUES (?1, ?2)",
                )?;
                for block in compact_blocks {
                    let mut buf = Vec::with_capacity(block.encoded_len());
                    block.encode(&mut buf).map_err(|e| {
                        SqliteClientError::CorruptedData(format!(
                            "failed to encode block for cache: {e}"
                        ))
                    })?;
                    stmt.execute((i64::from(block.height()), buf))?;
                }
            }
            tx.commit()?;
            Ok(())
        })
        .await
    }

    async fn truncate(&self, block_height: BlockHeight) -> Result<(), Self::Error> {
        self.blocking_task(move |conn| {
            conn.execute(
                "DELETE FROM compactblocks WHERE height > ?1",
                (i64::from(u32::from(block_height)),),
            )?;
            Ok(())
        })
        .await
    }

    async fn delete(&self, range: ScanRange) -> Result<(), Self::Error> {
        self.blocking_task(move |conn| {
            conn.execute(
                "DELETE FROM compactblocks WHERE height >= ?1 AND height < ?2",
                (
                    i64::from(u32::from(range.block_range().start)),
                    i64::from(u32::from(range.block_range().end)),
                ),
            )?;
            Ok(())
        })
        .await
    }
}

impl zcash_client_backend::data_api::chain::BlockSource for SqliteBlockCache {
    type Error = SqliteClientError;

    fn with_blocks<F, DbErrT>(
        &self,
        from_height: Option<BlockHeight>,
        limit: Option<usize>,
        mut with_row: F,
    ) -> Result<(), zcash_client_backend::data_api::chain::error::Error<DbErrT, Self::Error>>
    where
        F: FnMut(
            CompactBlock,
        ) -> Result<
            (),
            zcash_client_backend::data_api::chain::error::Error<DbErrT, Self::Error>,
        >,
    {
        let conn = self.conn.lock();
        let start = from_height.unwrap_or(BlockHeight::from_u32(0));
        let end = if let Some(limit) = limit {
            BlockHeight::from_u32(u32::from(start).saturating_add(limit as u32))
        } else {
            BlockHeight::from_u32(u32::MAX)
        };
        let blocks = Self::read_range(&conn, start, end)
            .map_err(zcash_client_backend::data_api::chain::error::Error::BlockSource)?;
        for block in blocks {
            with_row(block)?;
        }
        Ok(())
    }
}
