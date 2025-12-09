use std::env;
use std::fs::OpenOptions;
use std::io::Write;
use std::path::PathBuf;

/// Colored log prefixes for consistent tagging.
#[allow(dead_code)]
pub mod tags {
    pub const INFO: &str = "\x1b[34m[INFO]\x1b[0m";
    pub const SUCCESS: &str = "\x1b[32m[SUCCESS]\x1b[0m";
    pub const WARNING: &str = "\x1b[33m[WARNING]\x1b[0m";
    pub const ERROR: &str = "\x1b[31m[ERROR]\x1b[0m";
    pub const PANIC: &str = "\x1b[95m[PANIC]\x1b[0m";
    pub const TRACE: &str = "\x1b[36m[TRACE]\x1b[0m";
}

/// Append a single log line to a per-trade log file under DATA_DIR.
///
/// The middleware spawns escrowdv2 with:
///   DATA_DIR=./data/<TRADE_ID>
///   TRADE_ID=<trade-id>
/// We write to: DATA_DIR/<TRADE_ID>.log
pub fn append_trade_log(line: &str) {
    let data_dir = match env::var("DATA_DIR") {
        Ok(v) => v,
        Err(_) => return,
    };
    let trade_id = match env::var("TRADE_ID") {
        Ok(v) => v,
        Err(_) => return,
    };

    let dir = PathBuf::from(data_dir);
    if let Err(e) = std::fs::create_dir_all(&dir) {
        eprintln!("[escrowdv2] failed to create log dir {:?}: {}", dir, e);
        return;
    }

    let path = dir.join(format!("{}.log", trade_id));
    match OpenOptions::new().create(true).append(true).open(&path) {
        Ok(mut file) => {
            if let Err(e) = writeln!(file, "{}", line) {
                eprintln!("[escrowdv2] failed to write log line to {:?}: {}", path, e);
            }
        }
        Err(e) => {
            eprintln!("[escrowdv2] failed to open log file {:?}: {}", path, e);
        }
    }
}
