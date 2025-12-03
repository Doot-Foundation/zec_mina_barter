#!/bin/bash
# Quick start script for escrowdv2 development

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ESCROWDV2_DIR="$PROJECT_ROOT/escrowdv2"

echo "=========================================="
echo "escrowdv2 Development Quick Start"
echo "=========================================="
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if zcashd is running
check_zcashd() {
    echo -n "Checking zcashd connection... "

    # Try Docker first
    if docker ps | grep -q zcashd-testnet; then
        echo -e "${GREEN}✓ Found Docker container${NC}"
        return 0
    fi

    # Try native zcashd
    if pgrep -x zcashd > /dev/null; then
        echo -e "${GREEN}✓ Found native process${NC}"
        return 0
    fi

    echo -e "${RED}✗ Not running${NC}"
    echo ""
    echo "Please start zcashd first (from zcash/ directory):"
    echo "  Docker: docker-compose -f docker-compose.zcashd.yml up -d"
    echo "  Native: zcashd -daemon -testnet -experimentalfeatures -lightwalletd"
    echo ""
    return 1
}

# Check if lightwalletd is running
check_lightwalletd() {
    echo -n "Checking lightwalletd connection... "

    # Check if Docker container is running
    if docker ps | grep -q lightwalletd; then
        echo -e "${GREEN}✓ Found Docker container${NC}"

        # Try to hit HTTP status endpoint
        if curl -s -f http://localhost:9068/status > /dev/null 2>&1; then
            echo -e "${GREEN}✓ HTTP endpoint responsive${NC}"
            return 0
        else
            echo -e "${YELLOW}⚠ Container running but not synced yet${NC}"
            return 0
        fi
    fi

    echo -e "${RED}✗ Not running${NC}"
    echo ""
    echo "Please start lightwalletd first (from zcash/lightwalletd/):"
    echo "  docker-compose up -d"
    echo ""
    return 1
}

# Check Sapling parameters
check_sapling_params() {
    echo -n "Checking Sapling parameters... "

    SAPLING_SPEND="$HOME/.zcash-params/sapling-spend.params"
    SAPLING_OUTPUT="$HOME/.zcash-params/sapling-output.params"

    if [ -f "$SAPLING_SPEND" ] && [ -f "$SAPLING_OUTPUT" ]; then
        echo -e "${GREEN}✓ Found${NC}"
        return 0
    else
        echo -e "${RED}✗ Not found${NC}"
        echo ""
        echo "Please download Sapling parameters:"
        echo "  mkdir -p ~/.zcash-params && cd ~/.zcash-params"
        echo "  wget https://download.z.cash/downloads/sapling-spend.params"
        echo "  wget https://download.z.cash/downloads/sapling-output.params"
        echo ""
        return 1
    fi
}

# Check if .env exists
check_env() {
    if [ ! -f "$ESCROWDV2_DIR/.env" ]; then
        echo -e "${YELLOW}⚠ No .env file found${NC}"
        echo ""
        echo "Creating .env from .env.example..."

        if [ -f "$ESCROWDV2_DIR/.env.example" ]; then
            cp "$ESCROWDV2_DIR/.env.example" "$ESCROWDV2_DIR/.env"
            echo -e "${GREEN}✓ Created .env file${NC}"
            echo ""
            echo -e "${YELLOW}⚠ IMPORTANT: Edit escrowdv2/.env and update:${NC}"
            echo "  - MINA_TO_PUBKEY (your Mina public key)"
            echo "  - API_KEY (generate: openssl rand -hex 32)"
            echo "  - OPERATOR_TOKEN (generate: openssl rand -base64 32)"
            echo "  - ZCASHD_RPC_PASS (your zcashd RPC password)"
            echo ""
            read -p "Press Enter after updating .env to continue..."
        else
            echo -e "${RED}✗ .env.example not found${NC}"
            return 1
        fi
    else
        echo -e "${GREEN}✓ Found .env file${NC}"
    fi
}

# Check if Rust is installed
check_rust() {
    echo -n "Checking Rust installation... "
    if command -v cargo &> /dev/null; then
        RUST_VERSION=$(rustc --version | cut -d' ' -f2)
        echo -e "${GREEN}✓ v$RUST_VERSION${NC}"
        return 0
    else
        echo -e "${RED}✗ Not installed${NC}"
        echo ""
        echo "Please install Rust:"
        echo "  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh"
        echo ""
        return 1
    fi
}

# Build escrowdv2
build_escrowdv2() {
    echo ""
    echo "Building escrowdv2..."
    cd "$ESCROWDV2_DIR"

    if cargo build --release; then
        echo -e "${GREEN}✓ Build successful${NC}"
        return 0
    else
        echo -e "${RED}✗ Build failed${NC}"
        return 1
    fi
}

# Start escrowdv2
start_escrowdv2() {
    echo ""
    echo "=========================================="
    echo "Starting escrowdv2..."
    echo "=========================================="
    echo ""

    cd "$ESCROWDV2_DIR"

    # Load .env
    export $(cat .env | grep -v '^#' | xargs)

    # Show configuration
    echo "Configuration:"
    echo "  Listen Address: $LISTEN_ADDR"
    echo "  Data Directory: $DATA_DIR"
    echo "  Escrow Type: $ESCROW_ADDR_TYPE"
    echo "  Lightwalletd URL: $LIGHTWALLETD_URL"
    echo "  Zcashd RPC URL: $ZCASHD_RPC_URL"
    echo "  Mina Endpoint: $MINA_ENDPOINT"
    echo "  Mina To: ${MINA_TO_PUBKEY:0:10}..."
    echo "  API Key: ${API_KEY:0:10}..."
    echo "  Operator Token: ${OPERATOR_TOKEN:+[SET]}${OPERATOR_TOKEN:-[NOT SET - REQUIRED!]}"
    echo ""

    if [ -z "$OPERATOR_TOKEN" ]; then
        echo -e "${RED}✗ OPERATOR_TOKEN not set in .env${NC}"
        echo "Please add OPERATOR_TOKEN to .env file"
        return 1
    fi

    # Create data directory
    mkdir -p "$DATA_DIR"

    # Run escrowdv2 with logging
    echo "Press Ctrl+C to stop"
    echo ""
    RUST_LOG=info ./target/release/escrowdv2
}

# Main execution
main() {
    # Run checks
    check_rust || exit 1
    check_zcashd || exit 1
    check_lightwalletd || exit 1
    check_sapling_params || exit 1
    check_env || exit 1

    # Build
    if [ ! -f "$ESCROWDV2_DIR/target/release/escrowdv2" ]; then
        echo ""
        read -p "Binary not found. Build now? (y/n) " -n 1 -r
        echo ""
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            build_escrowdv2 || exit 1
        else
            echo "Please build first: cd escrowdv2 && cargo build --release"
            exit 1
        fi
    else
        echo -e "${GREEN}✓ Found compiled binary${NC}"
    fi

    # Start
    start_escrowdv2
}

# Run main
main
