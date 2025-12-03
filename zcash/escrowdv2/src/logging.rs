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
