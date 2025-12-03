use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use http::uri::InvalidUri;
use serde::Serialize;
use thiserror::Error;
use zcash_client_sqlite::error::SqliteClientError;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("config error: {0}")]
    Config(String),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("http client error: {0}")]
    Http(#[from] reqwest::Error),
    #[error("serialization error: {0}")]
    Serde(#[from] serde_json::Error),
    #[error("unauthorized")]
    Unauthorized,
    #[error("forbidden")]
    Forbidden,
    #[error("busy")]
    Busy,
    #[error("origin not verified yet")]
    NotVerified,
    #[error("origin not bound")]
    NoOrigin,
    #[error("in-transit gate mismatch")]
    TransitMismatch,
    #[error("crypto error")]
    Crypto,
    #[error("wallet error: {0}")]
    Wallet(String),
    #[error("already bound")]
    AlreadyBound,
    #[error("insufficient funds")]
    InsufficientFunds,
    #[error("funding not found on-chain")]
    FundingNotFound,
    #[error("grpc error: {0}")]
    Grpc(#[from] tonic::Status),
    #[error("grpc transport error: {0}")]
    GrpcTransport(#[from] tonic::transport::Error),
    #[error("uri error: {0}")]
    Uri(#[from] InvalidUri),
    #[error("sqlite error: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("wallet db error: {0}")]
    WalletDb(#[from] SqliteClientError),
}

#[derive(Serialize)]
struct ErrorBody {
    message: String,
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let status = match self {
            AppError::Unauthorized => StatusCode::UNAUTHORIZED,
            AppError::Forbidden => StatusCode::FORBIDDEN,
            AppError::Busy => StatusCode::CONFLICT,
            AppError::NotVerified | AppError::NoOrigin | AppError::TransitMismatch => {
                StatusCode::PRECONDITION_FAILED
            }
            AppError::AlreadyBound => StatusCode::CONFLICT,
            AppError::InsufficientFunds | AppError::FundingNotFound => StatusCode::PAYMENT_REQUIRED,
            AppError::Config(_)
            | AppError::Crypto
            | AppError::Wallet(_)
            | AppError::Io(_)
            | AppError::Http(_)
            | AppError::Serde(_)
            | AppError::Grpc(_)
            | AppError::GrpcTransport(_)
            | AppError::Uri(_)
            | AppError::Sqlite(_)
            | AppError::WalletDb(_) => StatusCode::INTERNAL_SERVER_ERROR,
        };

        let body = ErrorBody {
            message: self.to_string(),
        };

        (status, Json(body)).into_response()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io;

    #[test]
    fn test_error_display_config() {
        let err = AppError::Config("missing ZCASHD_RPC_URL".to_string());
        assert_eq!(err.to_string(), "config error: missing ZCASHD_RPC_URL");
    }

    #[test]
    fn test_error_display_wallet() {
        let err = AppError::Wallet("insufficient shielded balance: 0.5 ZEC required".to_string());
        assert_eq!(
            err.to_string(),
            "wallet error: insufficient shielded balance: 0.5 ZEC required"
        );
    }

    #[test]
    fn test_error_display_simple_variants() {
        assert_eq!(AppError::Unauthorized.to_string(), "unauthorized");
        assert_eq!(AppError::Forbidden.to_string(), "forbidden");
        assert_eq!(AppError::Busy.to_string(), "busy");
        assert_eq!(AppError::NotVerified.to_string(), "origin not verified yet");
        assert_eq!(AppError::NoOrigin.to_string(), "origin not bound");
        assert_eq!(
            AppError::TransitMismatch.to_string(),
            "in-transit gate mismatch"
        );
        assert_eq!(AppError::Crypto.to_string(), "crypto error");
        assert_eq!(AppError::AlreadyBound.to_string(), "already bound");
        assert_eq!(
            AppError::InsufficientFunds.to_string(),
            "insufficient funds"
        );
        assert_eq!(
            AppError::FundingNotFound.to_string(),
            "funding not found on-chain"
        );
    }

    #[test]
    fn test_from_io_error() {
        let io_err = io::Error::new(io::ErrorKind::NotFound, "wallet.dat not found");
        let app_err: AppError = io_err.into();
        assert!(app_err.to_string().contains("io error"));
        assert!(app_err.to_string().contains("wallet.dat not found"));
    }

    #[test]
    fn test_from_serde_error() {
        // Invalid JSON - missing closing brace
        let json_invalid = r#"{"amount": "0.5", "currency": "ZEC""#;
        let serde_err = serde_json::from_str::<serde_json::Value>(json_invalid).unwrap_err();
        let app_err: AppError = serde_err.into();
        assert!(app_err.to_string().contains("serialization error"));
    }

    #[test]
    fn test_http_status_code_unauthorized() {
        let err = AppError::Unauthorized;
        let response = err.into_response();
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }

    #[test]
    fn test_http_status_code_forbidden() {
        let err = AppError::Forbidden;
        let response = err.into_response();
        assert_eq!(response.status(), StatusCode::FORBIDDEN);
    }

    #[test]
    fn test_http_status_code_conflict() {
        let err = AppError::Busy;
        let response = err.into_response();
        assert_eq!(response.status(), StatusCode::CONFLICT);

        let err = AppError::AlreadyBound;
        let response = err.into_response();
        assert_eq!(response.status(), StatusCode::CONFLICT);
    }

    #[test]
    fn test_http_status_code_precondition_failed() {
        let err = AppError::NotVerified;
        let response = err.into_response();
        assert_eq!(response.status(), StatusCode::PRECONDITION_FAILED);

        let err = AppError::NoOrigin;
        let response = err.into_response();
        assert_eq!(response.status(), StatusCode::PRECONDITION_FAILED);

        let err = AppError::TransitMismatch;
        let response = err.into_response();
        assert_eq!(response.status(), StatusCode::PRECONDITION_FAILED);
    }

    #[test]
    fn test_http_status_code_payment_required() {
        let err = AppError::InsufficientFunds;
        let response = err.into_response();
        assert_eq!(response.status(), StatusCode::PAYMENT_REQUIRED);

        let err = AppError::FundingNotFound;
        let response = err.into_response();
        assert_eq!(response.status(), StatusCode::PAYMENT_REQUIRED);
    }

    #[test]
    fn test_http_status_code_internal_server_error() {
        // Config error
        let err = AppError::Config("test error".to_string());
        let response = err.into_response();
        assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);

        // Crypto error
        let err = AppError::Crypto;
        let response = err.into_response();
        assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);

        // Wallet error
        let err = AppError::Wallet("test wallet error".to_string());
        let response = err.into_response();
        assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);

        // IO error
        let io_err = io::Error::new(io::ErrorKind::PermissionDenied, "access denied");
        let err: AppError = io_err.into();
        let response = err.into_response();
        assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);
    }
}
