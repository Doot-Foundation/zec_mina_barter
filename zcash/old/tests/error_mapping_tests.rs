use escrowd::error::AppError;
use axum::response::IntoResponse;
use axum::http::StatusCode;

#[test]
fn error_status_codes_match() {
    let mapping = vec![
        (AppError::Unauthorized, StatusCode::UNAUTHORIZED),
        (AppError::Forbidden, StatusCode::FORBIDDEN),
        (AppError::Busy, StatusCode::CONFLICT),
        (AppError::NotVerified, StatusCode::PRECONDITION_FAILED),
        (AppError::NoOrigin, StatusCode::PRECONDITION_FAILED),
        (AppError::TransitMismatch, StatusCode::PRECONDITION_FAILED),
        (AppError::AlreadyBound, StatusCode::CONFLICT),
        (AppError::InsufficientFunds, StatusCode::PAYMENT_REQUIRED),
        (AppError::FundingNotFound, StatusCode::PAYMENT_REQUIRED),
    ];

    for (err, code) in mapping {
        let resp = err.into_response();
        let status = resp.status();
        assert_eq!(status, code);
    }
}
