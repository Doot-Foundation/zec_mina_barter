#!/bin/bash
# Test script for escrowdv2 API endpoints

set -e

# Configuration
ESCROWDV2_URL="${ESCROWDV2_URL:-http://localhost:8080}"
API_KEY="${API_KEY:-test_api_key_123456789}"
OPERATOR_TOKEN="${OPERATOR_TOKEN:-op_secret_abc123xyz}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Helper functions
print_header() {
    echo ""
    echo -e "${BLUE}========================================${NC}"
    echo -e "${BLUE}$1${NC}"
    echo -e "${BLUE}========================================${NC}"
    echo ""
}

print_test() {
    echo -e "${YELLOW}▶ $1${NC}"
}

print_success() {
    echo -e "${GREEN}✓ $1${NC}"
}

print_error() {
    echo -e "${RED}✗ $1${NC}"
}

# Test 1: Check service is running
test_service_health() {
    print_header "Test 1: Service Health Check"
    print_test "Checking if escrowdv2 is running at $ESCROWDV2_URL"

    if curl -s -f "$ESCROWDV2_URL/address" > /dev/null 2>&1; then
        print_success "Service is running"
        return 0
    else
        print_error "Service is not responding"
        echo "Please start escrowdv2 first:"
        echo "  ./scripts/start-escrowd-dev.sh"
        return 1
    fi
}

# Test 2: Get escrow address
test_get_address() {
    print_header "Test 2: Get Escrow Address"
    print_test "GET /address"

    RESPONSE=$(curl -s "$ESCROWDV2_URL/address")
    echo "Response: $RESPONSE"

    if echo "$RESPONSE" | grep -q '"ua"'; then
        ESCROW_ADDR=$(echo "$RESPONSE" | jq -r '.ua')
        print_success "Got escrow address: $ESCROW_ADDR"
        echo "$ESCROW_ADDR" > /tmp/escrow_addr.txt
        return 0
    else
        print_error "Failed to get address"
        return 1
    fi
}

# Test 3: Get initial status
test_get_status() {
    print_header "Test 3: Get Initial Status"
    print_test "GET /status"

    RESPONSE=$(curl -s "$ESCROWDV2_URL/status")
    echo "$RESPONSE" | jq '.'

    VERIFIED=$(echo "$RESPONSE" | jq -r '.verified')
    IN_TRANSIT=$(echo "$RESPONSE" | jq -r '.in_transit')

    if [ "$VERIFIED" = "false" ] && [ "$IN_TRANSIT" = "false" ]; then
        print_success "Initial state correct (verified=false, in_transit=false)"
        return 0
    else
        print_error "Unexpected initial state"
        return 1
    fi
}

# Test 4: Test funding verification (will fail without actual funding)
test_funding_shielded() {
    print_header "Test 4: Funding Verification (Shielded)"
    print_test "POST /funding/shielded"

    echo "Note: This will fail with 402 unless you've actually sent ZEC with the correct memo"
    echo ""

    RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$ESCROWDV2_URL/funding/shielded" \
        -H "Content-Type: application/json" \
        -d "{
            \"api_key\": \"$API_KEY\",
            \"memo\": \"$API_KEY\",
            \"origin_address\": \"ztestsapling1refund...\"
        }")

    HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
    BODY=$(echo "$RESPONSE" | sed '$d')

    echo "HTTP Status: $HTTP_CODE"
    echo "Response: $BODY"

    if [ "$HTTP_CODE" = "200" ]; then
        print_success "Funding verified!"
        return 0
    elif [ "$HTTP_CODE" = "402" ]; then
        print_error "Funding not found (expected - you need to send ZEC first)"
        echo ""
        echo "To test this properly:"
        echo "  1. Get escrow address: curl $ESCROWDV2_URL/address"
        echo "  2. Send ZEC with memo: zcash-cli -testnet z_sendmany ..."
        echo "  3. Wait 1 confirmation (~75 seconds)"
        echo "  4. Run this test again"
        return 0  # Not a real error
    else
        print_error "Unexpected response: $HTTP_CODE"
        return 1
    fi
}

# Test 5: Test operator authentication (should fail - missing auth)
test_operator_auth_fail() {
    print_header "Test 5: Operator Auth (Should Fail)"
    print_test "POST /set-in-transit without auth"

    RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$ESCROWDV2_URL/set-in-transit" \
        -H "Content-Type: application/json" \
        -d "{
            \"mina_tx_hash\": \"test123\"
        }")

    HTTP_CODE=$(echo "$RESPONSE" | tail -n1)

    echo "HTTP Status: $HTTP_CODE"

    if [ "$HTTP_CODE" = "403" ] || [ "$HTTP_CODE" = "401" ]; then
        print_success "Auth correctly rejected (HTTP $HTTP_CODE)"
        return 0
    else
        print_error "Expected 401/403, got $HTTP_CODE"
        return 1
    fi
}

# Test 6: Test operator authentication (should work)
test_operator_auth_success() {
    print_header "Test 6: Operator Auth (Should Work)"
    print_test "POST /set-in-transit with valid auth"

    echo "Note: This requires verified=true, so will likely fail with 412"
    echo ""

    RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$ESCROWDV2_URL/set-in-transit" \
        -H "Content-Type: application/json" \
        -H "Authorization: Bearer $OPERATOR_TOKEN" \
        -d "{
            \"mina_tx_hash\": \"CkpZW8QBVhN7YCKLNaW3ooFaJz1u3qHGx5f4hKZxnJAoEyA5RqnM\"
        }")

    HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
    BODY=$(echo "$RESPONSE" | sed '$d')

    echo "HTTP Status: $HTTP_CODE"
    echo "Response: $BODY"

    if [ "$HTTP_CODE" = "200" ]; then
        print_success "Set in-transit successful!"
        return 0
    elif [ "$HTTP_CODE" = "412" ]; then
        print_error "Precondition failed (expected - needs verified=true first)"
        return 0  # Not a real error
    elif [ "$HTTP_CODE" = "403" ]; then
        print_error "Auth failed - check OPERATOR_TOKEN"
        return 1
    else
        print_error "Unexpected response: $HTTP_CODE"
        return 1
    fi
}

# Test 7: Test send-back (should fail - not verified)
test_send_back() {
    print_header "Test 7: Refund (Send Back)"
    print_test "POST /send-back"

    echo "Note: This requires verified=true and in_transit=false"
    echo ""

    RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$ESCROWDV2_URL/send-back" \
        -H "Content-Type: application/json" \
        -d "{
            \"api_key\": \"$API_KEY\"
        }")

    HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
    BODY=$(echo "$RESPONSE" | sed '$d')

    echo "HTTP Status: $HTTP_CODE"
    echo "Response: $BODY"

    if [ "$HTTP_CODE" = "200" ]; then
        print_success "Refund initiated!"
        TXID=$(echo "$BODY" | jq -r '.txid')
        echo "Transaction ID: $TXID"
        return 0
    elif [ "$HTTP_CODE" = "412" ]; then
        print_error "Precondition failed (expected - needs proper setup)"
        return 0  # Not a real error
    else
        print_error "Unexpected response: $HTTP_CODE"
        return 1
    fi
}

# Test 8: Test send-target (should fail - needs localhost + auth)
test_send_target() {
    print_header "Test 8: Forward (Send Target)"
    print_test "POST /send-target"

    echo "Note: This requires verified=true, in_transit=true, and localhost"
    echo ""

    RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$ESCROWDV2_URL/send-target" \
        -H "Content-Type: application/json" \
        -H "Authorization: Bearer $OPERATOR_TOKEN" \
        -d "{
            \"target_address\": \"ztestsapling1target...\"
        }")

    HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
    BODY=$(echo "$RESPONSE" | sed '$d')

    echo "HTTP Status: $HTTP_CODE"
    echo "Response: $BODY"

    if [ "$HTTP_CODE" = "200" ]; then
        print_success "Forward initiated!"
        TXID=$(echo "$BODY" | jq -r '.txid')
        echo "Transaction ID: $TXID"
        return 0
    elif [ "$HTTP_CODE" = "412" ]; then
        print_error "Precondition failed (expected - needs proper setup)"
        return 0  # Not a real error
    elif [ "$HTTP_CODE" = "403" ]; then
        print_error "Auth failed - check OPERATOR_TOKEN and ensure localhost"
        return 0  # Expected if not localhost
    else
        print_error "Unexpected response: $HTTP_CODE"
        return 1
    fi
}

# Summary
print_summary() {
    print_header "Test Summary"

    echo "✓ Completed API endpoint tests"
    echo ""
    echo "To do a full end-to-end test:"
    echo "  1. Fund the escrow: send ZEC with API_KEY as memo"
    echo "  2. Verify funding: POST /funding/shielded"
    echo "  3. Send MINA to MINA_TO_PUBKEY"
    echo "  4. Lock escrow: POST /set-in-transit (with operator auth)"
    echo "  5. Forward funds: POST /send-target (with operator auth)"
    echo ""
    echo "Escrow address: $(cat /tmp/escrow_addr.txt 2>/dev/null || echo '[run test_get_address first]')"
    echo ""
}

# Main execution
main() {
    print_header "Escrowdv2 API Test Suite"

    echo "Configuration:"
    echo "  Escrowdv2 URL: $ESCROWDV2_URL"
    echo "  API Key: ${API_KEY:0:20}..."
    echo "  Operator Token: ${OPERATOR_TOKEN:0:20}..."
    echo ""

    # Check dependencies
    if ! command -v jq &> /dev/null; then
        print_error "jq is required but not installed"
        echo "Install: sudo apt-get install jq"
        exit 1
    fi

    # Run tests
    test_service_health || exit 1
    test_get_address || exit 1
    test_get_status || exit 1
    test_funding_shielded
    test_operator_auth_fail || exit 1
    test_operator_auth_success
    test_send_back
    test_send_target

    # Summary
    print_summary
}

# Check if jq is installed
if ! command -v jq &> /dev/null; then
    echo "Error: jq is required but not installed"
    echo "Install: sudo apt-get install jq"
    exit 1
fi

# Run main
main
