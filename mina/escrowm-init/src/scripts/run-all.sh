#!/bin/bash

# ==============================================================================
# Doot Barter Swap - Full Integration Test Suite
# ==============================================================================
#
# This script runs all onchain integration tests for MINA ↔ ZEC atomic swaps.
# It executes two complete test scenarios:
#   1. MINA Sell Initialization (Alice sells MINA for ZEC)
#   2. ZEC Sell Initialization (Bob sells ZEC for MINA)
#
# Prerequisites:
#   - .env file with USER_1_KEY, USER_2_KEY, and OPERATOR_KEY
#   - All accounts funded with at least 50 MINA on Zeko L2
#   - Node.js >= 18.14.0
#   - TypeScript built (npm run build)
#
# Usage:
#   chmod +x run-all.sh
#   ./run-all.sh
#
# ==============================================================================

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
MAGENTA='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# ==============================================================================
# Helper Functions
# ==============================================================================

print_header() {
  echo ""
  echo -e "${MAGENTA}╔════════════════════════════════════════════════════════════════╗${NC}"
  echo -e "${MAGENTA}║$(printf "%64s" | tr ' ' ' ')║${NC}"
  local text="$1"
  local padding=$((64 - ${#text}))
  local left_pad=$((padding / 2))
  local right_pad=$((padding - left_pad))
  echo -e "${MAGENTA}║$(printf "%${left_pad}s")${CYAN}${text}${MAGENTA}$(printf "%${right_pad}s")║${NC}"
  echo -e "${MAGENTA}║$(printf "%64s" | tr ' ' ' ')║${NC}"
  echo -e "${MAGENTA}╚════════════════════════════════════════════════════════════════╝${NC}"
  echo ""
}

print_section() {
  echo ""
  echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${BLUE}  $1${NC}"
  echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo ""
}

print_success() {
  echo -e "${GREEN}✅ $1${NC}"
}

print_error() {
  echo -e "${RED}❌ $1${NC}"
}

print_warning() {
  echo -e "${YELLOW}⚠️  $1${NC}"
}

print_info() {
  echo -e "${CYAN}ℹ️  $1${NC}"
}

run_script() {
  local script_path="$1"
  local script_name=$(basename "$script_path" .js)
  local step_num=$(echo "$script_name" | cut -d'_' -f1)
  local scenario=$(echo "$script_path" | grep -oP '(mina_sell_initialization|zec_sell_initialization)')

  echo ""
  echo -e "${CYAN}═══════════════════════════════════════════════════════════════════${NC}"
  echo -e "${CYAN}  Running: ${YELLOW}${script_name}${NC}"
  echo -e "${CYAN}  Scenario: ${scenario}${NC}"
  echo -e "${CYAN}  Time: $(date '+%Y-%m-%d %H:%M:%S')${NC}"
  echo -e "${CYAN}═══════════════════════════════════════════════════════════════════${NC}"
  echo ""

  if node "$script_path"; then
    print_success "Completed: ${script_name}"
    return 0
  else
    print_error "Failed: ${script_name}"
    print_error "Check the output above for error details"
    return 1
  fi
}

# ==============================================================================
# Pre-flight Checks
# ==============================================================================

print_header "Doot Barter Swap - Integration Test Suite"

print_section "Pre-flight Checks"

# Check if .env file exists
if [ ! -f "../../.env" ]; then
  print_error ".env file not found in mina/escrowm-init/"
  print_info "Please create .env with USER_1_KEY, USER_2_KEY, and OPERATOR_KEY"
  exit 1
fi
print_success ".env file found"

# Check if build directory exists
if [ ! -d "../../build" ]; then
  print_error "Build directory not found"
  print_info "Please run 'npm run build' first"
  exit 1
fi
print_success "Build directory found"

# Check if Node.js is available
if ! command -v node &> /dev/null; then
  print_error "Node.js not found"
  print_info "Please install Node.js >= 18.14.0"
  exit 1
fi
print_success "Node.js found: $(node --version)"

# Create .state directory if it doesn't exist
mkdir -p ../.state
print_success "State directory ready"

# Clean up old state files
if [ -f "../.state/mina_sell_state.json" ]; then
  print_warning "Removing old mina_sell_state.json"
  rm "../.state/mina_sell_state.json"
fi

if [ -f "../.state/zec_sell_state.json" ]; then
  print_warning "Removing old zec_sell_state.json"
  rm "../.state/zec_sell_state.json"
fi

print_info "All pre-flight checks passed!"

# ==============================================================================
# Test Execution Timing
# ==============================================================================

TOTAL_START_TIME=$(date +%s)

# ==============================================================================
# Scenario 1: MINA Sell Initialization
# ==============================================================================

print_header "Scenario 1: MINA Sell Initialization"

print_info "Alice wants to sell 1 MINA for ZEC"
print_info "Bob wants to buy MINA with ZEC"
print_info "Flow: Alice deposits → Operator locks → Bob claims"
echo ""

SCENARIO_1_START=$(date +%s)

# Step 0: Setup
run_script "../../build/src/scripts/mina_sell_initialization/0_msi_setup.js" || exit 1

# Step 1: Deposit
run_script "../../build/src/scripts/mina_sell_initialization/1_msi_deposit.js" || exit 1

# Step 2: Verify Deposit
run_script "../../build/src/scripts/mina_sell_initialization/2_msi_verify_deposit.js" || exit 1

# Step 3: Lock
run_script "../../build/src/scripts/mina_sell_initialization/3_msi_lock.js" || exit 1

# Step 4: Claim
run_script "../../build/src/scripts/mina_sell_initialization/4_msi_claim.js" || exit 1

# Step 5: Settlement
print_warning "Settlement proof generation takes 5-6 minutes..."
run_script "../../build/src/scripts/mina_sell_initialization/5_msi_settle.js" || exit 1

# Step 6: Final Verification
run_script "../../build/src/scripts/mina_sell_initialization/6_msi_verify_final.js" || exit 1

SCENARIO_1_END=$(date +%s)
SCENARIO_1_DURATION=$((SCENARIO_1_END - SCENARIO_1_START))

print_success "Scenario 1 completed in $((SCENARIO_1_DURATION / 60)) minutes $((SCENARIO_1_DURATION % 60)) seconds"

# ==============================================================================
# Scenario 2: ZEC Sell Initialization
# ==============================================================================

print_header "Scenario 2: ZEC Sell Initialization"

print_info "Bob wants to sell ZEC for MINA"
print_info "Alice wants to buy ZEC with MINA"
print_info "Flow: Alice deposits → Operator locks → Bob claims"
echo ""

SCENARIO_2_START=$(date +%s)

# Step 0: Setup
run_script "../../build/src/scripts/zec_sell_initialization/0_zsi_setup.js" || exit 1

# Step 1: Deposit
run_script "../../build/src/scripts/zec_sell_initialization/1_zsi_deposit.js" || exit 1

# Step 2: Verify Deposit
run_script "../../build/src/scripts/zec_sell_initialization/2_zsi_verify_deposit.js" || exit 1

# Step 3: Lock
run_script "../../build/src/scripts/zec_sell_initialization/3_zsi_lock.js" || exit 1

# Step 4: Claim
run_script "../../build/src/scripts/zec_sell_initialization/4_zsi_claim.js" || exit 1

# Step 5: Settlement
print_warning "Settlement proof generation takes 5-6 minutes..."
run_script "../../build/src/scripts/zec_sell_initialization/5_zsi_settle.js" || exit 1

# Step 6: Final Verification
run_script "../../build/src/scripts/zec_sell_initialization/6_zsi_verify_final.js" || exit 1

SCENARIO_2_END=$(date +%s)
SCENARIO_2_DURATION=$((SCENARIO_2_END - SCENARIO_2_START))

print_success "Scenario 2 completed in $((SCENARIO_2_DURATION / 60)) minutes $((SCENARIO_2_DURATION % 60)) seconds"

# ==============================================================================
# Final Summary
# ==============================================================================

TOTAL_END_TIME=$(date +%s)
TOTAL_DURATION=$((TOTAL_END_TIME - TOTAL_START_TIME))

print_header "Test Suite Complete!"

echo ""
echo -e "${GREEN}╔════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║                     🎉 ALL TESTS PASSED! 🎉                    ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════════════════════════════╝${NC}"
echo ""

print_section "Execution Summary"

echo -e "${CYAN}📊 Test Statistics:${NC}"
echo -e "  Total Scripts Executed: ${YELLOW}14${NC}"
echo -e "  Scenarios Tested: ${YELLOW}2${NC}"
echo -e "  Transactions Sent: ${YELLOW}~8-10${NC} (per scenario)"
echo -e "  Settlement Proofs: ${YELLOW}2${NC}"
echo ""

echo -e "${CYAN}⏱️  Timing Breakdown:${NC}"
echo -e "  Scenario 1 Duration: ${YELLOW}$((SCENARIO_1_DURATION / 60))m $((SCENARIO_1_DURATION % 60))s${NC}"
echo -e "  Scenario 2 Duration: ${YELLOW}$((SCENARIO_2_DURATION / 60))m $((SCENARIO_2_DURATION % 60))s${NC}"
echo -e "  Total Duration: ${YELLOW}$((TOTAL_DURATION / 60))m $((TOTAL_DURATION % 60))s${NC}"
echo ""

echo -e "${CYAN}✅ Test Scenarios Completed:${NC}"
echo -e "  1. ${GREEN}✓${NC} MINA Sell Initialization (Alice → Bob)"
echo -e "  2. ${GREEN}✓${NC} ZEC Sell Initialization (Bob → Alice)"
echo ""

echo -e "${CYAN}📁 State Files:${NC}"
echo -e "  MINA Sell: ${YELLOW}src/scripts/.state/mina_sell_state.json${NC}"
echo -e "  ZEC Sell: ${YELLOW}src/scripts/.state/zec_sell_state.json${NC}"
echo ""

echo -e "${CYAN}🔗 Contract:${NC}"
echo -e "  Address: ${YELLOW}B62qmg7giAqEhf7UdZamqYumnQotExwQFXEeuuW2Yze7V67ZtgFKNmo${NC}"
echo -e "  Network: ${YELLOW}Zeko L2 Devnet${NC}"
echo -e "  Explorer: ${YELLOW}https://zekoscan.io/testnet${NC}"
echo ""

print_section "Next Steps"

echo -e "${CYAN}📝 What to do next:${NC}"
echo ""
echo -e "  ${GREEN}1.${NC} Review transaction hashes on ZekoScan"
echo -e "  ${GREEN}2.${NC} Check state files for complete trade data"
echo -e "  ${GREEN}3.${NC} Verify account balances changed as expected"
echo -e "  ${GREEN}4.${NC} Review logs for any warnings or issues"
echo ""

echo -e "${CYAN}🔍 To run individual scenarios:${NC}"
echo ""
echo -e "  ${YELLOW}# Run only MINA Sell Initialization:${NC}"
echo -e "  node build/src/scripts/mina_sell_initialization/0_msi_setup.js"
echo -e "  # ... continue with 1_msi_deposit.js through 6_msi_verify_final.js"
echo ""
echo -e "  ${YELLOW}# Run only ZEC Sell Initialization:${NC}"
echo -e "  node build/src/scripts/zec_sell_initialization/0_zsi_setup.js"
echo -e "  # ... continue with 1_zsi_deposit.js through 6_zsi_verify_final.js"
echo ""

print_success "Integration test suite completed successfully!"
echo ""
