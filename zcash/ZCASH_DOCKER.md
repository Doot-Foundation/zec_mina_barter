# Zcashd Docker Node - RPC API Reference

Complete reference for interacting with your local zcashd testnet node via RPC.

---

## Connection Details

**Endpoint**: `http://127.0.0.1:18232`
**Network**: Testnet
**User**: `zcashrpc`
**Password**: `your_secure_password_here_change_me`
**Container**: `zcashd-testnet`

### Basic RPC Call Format

```bash
curl --user zcashrpc:your_secure_password_here_change_me \
     --data-binary '{"jsonrpc":"1.0","id":"curltest","method":"METHOD_NAME","params":[PARAMS]}' \
     -H 'content-type: text/plain;' \
     http://127.0.0.1:18232/
```

### Using jq for Pretty Output

```bash
# Add | jq '.' to the end of any curl command
curl ... http://127.0.0.1:18232/ | jq '.'

# Extract just the result
curl ... http://127.0.0.1:18232/ | jq '.result'
```

---

## Table of Contents

1. [Blockchain Information](#blockchain-information)
2. [Wallet Operations](#wallet-operations)
3. [Address Management](#address-management)
4. [Transaction Operations](#transaction-operations)
5. [Shielded Operations (Sapling/Orchard)](#shielded-operations)
6. [Network & Mining](#network--mining)
7. [Utility Commands](#utility-commands)
8. [Advanced Operations](#advanced-operations)

---

## Blockchain Information

### getblockchaininfo
Get blockchain sync status, chain info, and upgrade status.

```bash
curl --user zcashrpc:your_secure_password_here_change_me \
  --data-binary '{"jsonrpc":"1.0","id":"1","method":"getblockchaininfo","params":[]}' \
  http://127.0.0.1:18232/ | jq '.result'
```

**Returns**:
- `blocks`: Current block height
- `headers`: Total headers downloaded
- `verificationprogress`: Sync progress (0.0 to 1.0)
- `initial_block_download_complete`: Sync status
- `valuePools`: Transparent/Sapling/Orchard pool values
- `upgrades`: Network upgrade status

### getbestblockhash
Get the hash of the best (tip) block.

```bash
curl --user zcashrpc:your_secure_password_here_change_me \
  --data-binary '{"jsonrpc":"1.0","id":"1","method":"getbestblockhash","params":[]}' \
  http://127.0.0.1:18232/ | jq -r '.result'
```

### getblock
Get block data by hash.

```bash
BLOCK_HASH="00732359b4c76ddd1545a77547f43ad7b93ad62dc546a7d013e2b2f28b5f26b8"

curl --user zcashrpc:your_secure_password_here_change_me \
  --data-binary "{\"jsonrpc\":\"1.0\",\"id\":\"1\",\"method\":\"getblock\",\"params\":[\"$BLOCK_HASH\"]}" \
  http://127.0.0.1:18232/ | jq '.result'
```

**Params**:
- `hash` (string): Block hash
- `verbosity` (int, optional): 0=hex, 1=json (default), 2=json+tx details

### getblockcount
Get current block height.

```bash
curl --user zcashrpc:your_secure_password_here_change_me \
  --data-binary '{"jsonrpc":"1.0","id":"1","method":"getblockcount","params":[]}' \
  http://127.0.0.1:18232/ | jq '.result'
```

### getblockhash
Get block hash by height.

```bash
curl --user zcashrpc:your_secure_password_here_change_me \
  --data-binary '{"jsonrpc":"1.0","id":"1","method":"getblockhash","params":[2189042]}' \
  http://127.0.0.1:18232/ | jq -r '.result'
```

### getchaintips
Get all known blockchain tips (forks).

```bash
curl --user zcashrpc:your_secure_password_here_change_me \
  --data-binary '{"jsonrpc":"1.0","id":"1","method":"getchaintips","params":[]}' \
  http://127.0.0.1:18232/ | jq '.result'
```

### getdifficulty
Get current mining difficulty.

```bash
curl --user zcashrpc:your_secure_password_here_change_me \
  --data-binary '{"jsonrpc":"1.0","id":"1","method":"getdifficulty","params":[]}' \
  http://127.0.0.1:18232/ | jq '.result'
```

---

## Wallet Operations

### getwalletinfo
Get wallet status and balance information.

```bash
curl --user zcashrpc:your_secure_password_here_change_me \
  --data-binary '{"jsonrpc":"1.0","id":"1","method":"getwalletinfo","params":[]}' \
  http://127.0.0.1:18232/ | jq '.result'
```

**Returns**:
- `walletversion`: Wallet format version
- `balance`: Total transparent balance
- `unconfirmed_balance`: Unconfirmed transparent balance
- `immature_balance`: Mining rewards not yet mature
- `txcount`: Total wallet transactions
- `keypoolsize`: Available key pool size

### getbalance
Get wallet balance.

```bash
# Total balance
curl --user zcashrpc:your_secure_password_here_change_me \
  --data-binary '{"jsonrpc":"1.0","id":"1","method":"getbalance","params":[]}' \
  http://127.0.0.1:18232/ | jq '.result'

# Minimum confirmations
curl --user zcashrpc:your_secure_password_here_change_me \
  --data-binary '{"jsonrpc":"1.0","id":"1","method":"getbalance","params":["*", 6]}' \
  http://127.0.0.1:18232/ | jq '.result'
```

**Params**:
- `account` (string, optional): Deprecated, use "*"
- `minconf` (int, optional): Minimum confirmations (default: 1)

### z_gettotalbalance
Get total balance across all pools (transparent + shielded).

```bash
curl --user zcashrpc:your_secure_password_here_change_me \
  --data-binary '{"jsonrpc":"1.0","id":"1","method":"z_gettotalbalance","params":[1]}' \
  http://127.0.0.1:18232/ | jq '.result'
```

**Returns**:
```json
{
  "transparent": "0.00",
  "private": "1.50",
  "total": "1.50"
}
```

### listunspent
List unspent transparent outputs.

```bash
curl --user zcashrpc:your_secure_password_here_change_me \
  --data-binary '{"jsonrpc":"1.0","id":"1","method":"listunspent","params":[1, 9999999]}' \
  http://127.0.0.1:18232/ | jq '.result'
```

**Params**:
- `minconf` (int, optional): Minimum confirmations (default: 1)
- `maxconf` (int, optional): Maximum confirmations (default: 9999999)
- `addresses` (array, optional): Filter by addresses

### listtransactions
List wallet transactions.

```bash
# Last 10 transactions
curl --user zcashrpc:your_secure_password_here_change_me \
  --data-binary '{"jsonrpc":"1.0","id":"1","method":"listtransactions","params":["*", 10]}' \
  http://127.0.0.1:18232/ | jq '.result'

# Last 50 transactions with watch-only
curl --user zcashrpc:your_secure_password_here_change_me \
  --data-binary '{"jsonrpc":"1.0","id":"1","method":"listtransactions","params":["*", 50, 0, true]}' \
  http://127.0.0.1:18232/ | jq '.result'
```

### gettransaction
Get detailed transaction information.

```bash
TXID="abc123..."

curl --user zcashrpc:your_secure_password_here_change_me \
  --data-binary "{\"jsonrpc\":\"1.0\",\"id\":\"1\",\"method\":\"gettransaction\",\"params\":[\"$TXID\"]}" \
  http://127.0.0.1:18232/ | jq '.result'
```

---

## Address Management

### getnewaddress
Generate new transparent address.

```bash
curl --user zcashrpc:your_secure_password_here_change_me \
  --data-binary '{"jsonrpc":"1.0","id":"1","method":"getnewaddress","params":[]}' \
  http://127.0.0.1:18232/ | jq -r '.result'
```

**Returns**: `tmXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX` (testnet transparent address)

### z_getnewaddress
Generate new shielded address.

```bash
# Sapling address (default)
curl --user zcashrpc:your_secure_password_here_change_me \
  --data-binary '{"jsonrpc":"1.0","id":"1","method":"z_getnewaddress","params":[]}' \
  http://127.0.0.1:18232/ | jq -r '.result'

# Sapling explicit
curl --user zcashrpc:your_secure_password_here_change_me \
  --data-binary '{"jsonrpc":"1.0","id":"1","method":"z_getnewaddress","params":["sapling"]}' \
  http://127.0.0.1:18232/ | jq -r '.result'

# Orchard (NU5+)
curl --user zcashrpc:your_secure_password_here_change_me \
  --data-binary '{"jsonrpc":"1.0","id":"1","method":"z_getnewaddress","params":["orchard"]}' \
  http://127.0.0.1:18232/ | jq -r '.result'
```

**Returns**:
- Sapling: `ztestsapling1XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX`
- Orchard: `utest1XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX`

### getaddressesbyaccount
List addresses by account (deprecated).

```bash
curl --user zcashrpc:your_secure_password_here_change_me \
  --data-binary '{"jsonrpc":"1.0","id":"1","method":"getaddressesbyaccount","params":[""]}' \
  http://127.0.0.1:18232/ | jq '.result'
```

### z_listaddresses
List all shielded addresses in wallet.

```bash
curl --user zcashrpc:your_secure_password_here_change_me \
  --data-binary '{"jsonrpc":"1.0","id":"1","method":"z_listaddresses","params":[]}' \
  http://127.0.0.1:18232/ | jq '.result'
```

### validateaddress
Validate and get info about transparent address.

```bash
ADDR="tmXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"

curl --user zcashrpc:your_secure_password_here_change_me \
  --data-binary "{\"jsonrpc\":\"1.0\",\"id\":\"1\",\"method\":\"validateaddress\",\"params\":[\"$ADDR\"]}" \
  http://127.0.0.1:18232/ | jq '.result'
```

### z_validateaddress
Validate and get info about shielded address.

```bash
ZADDR="ztestsapling1XXXXXXX"

curl --user zcashrpc:your_secure_password_here_change_me \
  --data-binary "{\"jsonrpc\":\"1.0\",\"id\":\"1\",\"method\":\"z_validateaddress\",\"params\":[\"$ZADDR\"]}" \
  http://127.0.0.1:18232/ | jq '.result'
```

### z_exportviewingkey
Export viewing key for shielded address.

```bash
ZADDR="ztestsapling1XXXXXXX"

curl --user zcashrpc:your_secure_password_here_change_me \
  --data-binary "{\"jsonrpc\":\"1.0\",\"id\":\"1\",\"method\":\"z_exportviewingkey\",\"params\":[\"$ZADDR\"]}" \
  http://127.0.0.1:18232/ | jq -r '.result'
```

### z_importviewingkey
Import viewing key (read-only access).

```bash
VK="zxviewtestsapling1XXXXXXX"

curl --user zcashrpc:your_secure_password_here_change_me \
  --data-binary "{\"jsonrpc\":\"1.0\",\"id\":\"1\",\"method\":\"z_importviewingkey\",\"params\":[\"$VK\", \"yes\"]}" \
  http://127.0.0.1:18232/ | jq '.result'
```

---

## Transaction Operations

### sendtoaddress
Send ZEC to transparent address.

```bash
TO_ADDR="tmYXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
AMOUNT="0.001"

curl --user zcashrpc:your_secure_password_here_change_me \
  --data-binary "{\"jsonrpc\":\"1.0\",\"id\":\"1\",\"method\":\"sendtoaddress\",\"params\":[\"$TO_ADDR\", $AMOUNT]}" \
  http://127.0.0.1:18232/ | jq -r '.result'
```

**Returns**: Transaction ID (txid)

### sendmany
Send to multiple transparent addresses in one transaction.

```bash
curl --user zcashrpc:your_secure_password_here_change_me \
  --data-binary '{
    "jsonrpc":"1.0",
    "id":"1",
    "method":"sendmany",
    "params":[
      "",
      {
        "tmAddr1...": 0.01,
        "tmAddr2...": 0.02,
        "tmAddr3...": 0.015
      }
    ]
  }' \
  http://127.0.0.1:18232/ | jq -r '.result'
```

### getrawtransaction
Get raw transaction hex or decoded JSON.

```bash
TXID="abc123..."

# Get hex
curl --user zcashrpc:your_secure_password_here_change_me \
  --data-binary "{\"jsonrpc\":\"1.0\",\"id\":\"1\",\"method\":\"getrawtransaction\",\"params\":[\"$TXID\"]}" \
  http://127.0.0.1:18232/ | jq -r '.result'

# Get decoded JSON
curl --user zcashrpc:your_secure_password_here_change_me \
  --data-binary "{\"jsonrpc\":\"1.0\",\"id\":\"1\",\"method\":\"getrawtransaction\",\"params\":[\"$TXID\", 1]}" \
  http://127.0.0.1:18232/ | jq '.result'
```

### sendrawtransaction
Broadcast raw transaction hex.

```bash
RAW_HEX="0400008085202f89..."

curl --user zcashrpc:your_secure_password_here_change_me \
  --data-binary "{\"jsonrpc\":\"1.0\",\"id\":\"1\",\"method\":\"sendrawtransaction\",\"params\":[\"$RAW_HEX\"]}" \
  http://127.0.0.1:18232/ | jq -r '.result'
```

### decoderawtransaction
Decode raw transaction hex to JSON.

```bash
RAW_HEX="0400008085202f89..."

curl --user zcashrpc:your_secure_password_here_change_me \
  --data-binary "{\"jsonrpc\":\"1.0\",\"id\":\"1\",\"method\":\"decoderawtransaction\",\"params\":[\"$RAW_HEX\"]}" \
  http://127.0.0.1:18232/ | jq '.result'
```

### gettxout
Get details about unspent transaction output.

```bash
TXID="abc123..."
VOUT=0

curl --user zcashrpc:your_secure_password_here_change_me \
  --data-binary "{\"jsonrpc\":\"1.0\",\"id\":\"1\",\"method\":\"gettxout\",\"params\":[\"$TXID\", $VOUT]}" \
  http://127.0.0.1:18232/ | jq '.result'
```

---

## Shielded Operations

### z_sendmany
Send from any address type to multiple recipients (transparent/shielded).

```bash
FROM_ADDR="tmXXXXX"  # or ztestsaplingXXXXX

curl --user zcashrpc:your_secure_password_here_change_me \
  --data-binary '{
    "jsonrpc":"1.0",
    "id":"1",
    "method":"z_sendmany",
    "params":[
      "'$FROM_ADDR'",
      [
        {
          "address": "ztestsapling1XXXXXXX",
          "amount": 0.01,
          "memo": "48656c6c6f"
        },
        {
          "address": "tmYXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
          "amount": 0.005
        }
      ],
      1,
      0.0001
    ]
  }' \
  http://127.0.0.1:18232/ | jq -r '.result'
```

**Params**:
- `fromaddress` (string): Source address
- `amounts` (array): Recipients with amounts and optional memos
- `minconf` (int, optional): Minimum confirmations (default: 1)
- `fee` (numeric, optional): Transaction fee (default: 0.0001)

**Returns**: Operation ID (use `z_getoperationstatus` to check)

### z_shieldcoinbase
Shield transparent coinbase funds to shielded address.

```bash
TO_ZADDR="ztestsapling1XXXXXXX"

curl --user zcashrpc:your_secure_password_here_change_me \
  --data-binary "{\"jsonrpc\":\"1.0\",\"id\":\"1\",\"method\":\"z_shieldcoinbase\",\"params\":[\"*\", \"$TO_ZADDR\", 0.0001]}" \
  http://127.0.0.1:18232/ | jq '.result'
```

### z_mergetoaddress
Merge multiple UTXOs/notes to a single address.

```bash
TO_ADDR="ztestsapling1XXXXXXX"

curl --user zcashrpc:your_secure_password_here_change_me \
  --data-binary '{
    "jsonrpc":"1.0",
    "id":"1",
    "method":"z_mergetoaddress",
    "params":[
      ["ANY_SAPLING"],
      "'$TO_ADDR'",
      0.0001,
      50
    ]
  }' \
  http://127.0.0.1:18232/ | jq '.result'
```

**Params**:
- `fromaddresses` (array): Source addresses or ["ANY_TADDR", "ANY_SAPLING", "ANY_ORCHARD"]
- `toaddress` (string): Destination address
- `fee` (numeric, optional): Transaction fee
- `transparent_limit` (int, optional): Max transparent inputs
- `shielded_limit` (int, optional): Max shielded inputs
- `memo` (string, optional): Hex memo

### z_listreceivedbyaddress
List amounts received by shielded address.

```bash
ZADDR="ztestsapling1XXXXXXX"

curl --user zcashrpc:your_secure_password_here_change_me \
  --data-binary "{\"jsonrpc\":\"1.0\",\"id\":\"1\",\"method\":\"z_listreceivedbyaddress\",\"params\":[\"$ZADDR\", 1]}" \
  http://127.0.0.1:18232/ | jq '.result'
```

**Returns**: Array of received notes with amounts, memos, txids, and confirmations.

### z_getbalance
Get balance for specific address.

```bash
ZADDR="ztestsapling1XXXXXXX"

curl --user zcashrpc:your_secure_password_here_change_me \
  --data-binary "{\"jsonrpc\":\"1.0\",\"id\":\"1\",\"method\":\"z_getbalance\",\"params\":[\"$ZADDR\", 1]}" \
  http://127.0.0.1:18232/ | jq '.result'
```

### z_getoperationstatus
Check status of async operations (z_sendmany, z_shieldcoinbase, etc).

```bash
# All operations
curl --user zcashrpc:your_secure_password_here_change_me \
  --data-binary '{"jsonrpc":"1.0","id":"1","method":"z_getoperationstatus","params":[]}' \
  http://127.0.0.1:18232/ | jq '.result'

# Specific operation ID
OPID="opid-abc123..."
curl --user zcashrpc:your_secure_password_here_change_me \
  --data-binary "{\"jsonrpc\":\"1.0\",\"id\":\"1\",\"method\":\"z_getoperationstatus\",\"params\":[[\"$OPID\"]]}" \
  http://127.0.0.1:18232/ | jq '.result'
```

**Status values**:
- `queued`: Waiting to execute
- `executing`: Currently processing
- `success`: Completed successfully (includes txid)
- `failed`: Failed (includes error message)

### z_getoperationresult
Get and remove operation results from memory.

```bash
curl --user zcashrpc:your_secure_password_here_change_me \
  --data-binary '{"jsonrpc":"1.0","id":"1","method":"z_getoperationresult","params":[]}' \
  http://127.0.0.1:18232/ | jq '.result'
```

### z_listoperationids
List all operation IDs.

```bash
curl --user zcashrpc:your_secure_password_here_change_me \
  --data-binary '{"jsonrpc":"1.0","id":"1","method":"z_listoperationids","params":[]}' \
  http://127.0.0.1:18232/ | jq '.result'
```

---

## Network & Mining

### getnetworkinfo
Get network connectivity information.

```bash
curl --user zcashrpc:your_secure_password_here_change_me \
  --data-binary '{"jsonrpc":"1.0","id":"1","method":"getnetworkinfo","params":[]}' \
  http://127.0.0.1:18232/ | jq '.result'
```

### getpeerinfo
Get information about connected peers.

```bash
curl --user zcashrpc:your_secure_password_here_change_me \
  --data-binary '{"jsonrpc":"1.0","id":"1","method":"getpeerinfo","params":[]}' \
  http://127.0.0.1:18232/ | jq '.result'
```

### getconnectioncount
Get number of connections to other nodes.

```bash
curl --user zcashrpc:your_secure_password_here_change_me \
  --data-binary '{"jsonrpc":"1.0","id":"1","method":"getconnectioncount","params":[]}' \
  http://127.0.0.1:18232/ | jq '.result'
```

### ping
Send ping to all peers.

```bash
curl --user zcashrpc:your_secure_password_here_change_me \
  --data-binary '{"jsonrpc":"1.0","id":"1","method":"ping","params":[]}' \
  http://127.0.0.1:18232/ | jq '.result'
```

### getmininginfo
Get mining-related information.

```bash
curl --user zcashrpc:your_secure_password_here_change_me \
  --data-binary '{"jsonrpc":"1.0","id":"1","method":"getmininginfo","params":[]}' \
  http://127.0.0.1:18232/ | jq '.result'
```

### getblocktemplate
Get data needed to construct a block.

```bash
curl --user zcashrpc:your_secure_password_here_change_me \
  --data-binary '{"jsonrpc":"1.0","id":"1","method":"getblocktemplate","params":[]}' \
  http://127.0.0.1:18232/ | jq '.result'
```

---

## Utility Commands

### help
List all available RPC commands or get help for specific command.

```bash
# List all commands
curl --user zcashrpc:your_secure_password_here_change_me \
  --data-binary '{"jsonrpc":"1.0","id":"1","method":"help","params":[]}' \
  http://127.0.0.1:18232/ | jq -r '.result'

# Help for specific command
curl --user zcashrpc:your_secure_password_here_change_me \
  --data-binary '{"jsonrpc":"1.0","id":"1","method":"help","params":["z_sendmany"]}' \
  http://127.0.0.1:18232/ | jq -r '.result'
```

### getinfo
Get general node information (deprecated, use specific methods instead).

```bash
curl --user zcashrpc:your_secure_password_here_change_me \
  --data-binary '{"jsonrpc":"1.0","id":"1","method":"getinfo","params":[]}' \
  http://127.0.0.1:18232/ | jq '.result'
```

### getmemoryinfo
Get memory usage statistics.

```bash
curl --user zcashrpc:your_secure_password_here_change_me \
  --data-binary '{"jsonrpc":"1.0","id":"1","method":"getmemoryinfo","params":[]}' \
  http://127.0.0.1:18232/ | jq '.result'
```

### estimatefee
Estimate fee per kilobyte for transaction to confirm in N blocks.

```bash
# Estimate for 2-block confirmation
curl --user zcashrpc:your_secure_password_here_change_me \
  --data-binary '{"jsonrpc":"1.0","id":"1","method":"estimatefee","params":[2]}' \
  http://127.0.0.1:18232/ | jq '.result'
```

### z_getnotescount
Count unspent notes in wallet.

```bash
curl --user zcashrpc:your_secure_password_here_change_me \
  --data-binary '{"jsonrpc":"1.0","id":"1","method":"z_getnotescount","params":[1]}' \
  http://127.0.0.1:18232/ | jq '.result'
```

### stop
Stop the zcashd server.

```bash
curl --user zcashrpc:your_secure_password_here_change_me \
  --data-binary '{"jsonrpc":"1.0","id":"1","method":"stop","params":[]}' \
  http://127.0.0.1:18232/ | jq -r '.result'
```

---

## Advanced Operations

### createrawtransaction
Create raw transaction (transparent only).

```bash
curl --user zcashrpc:your_secure_password_here_change_me \
  --data-binary '{
    "jsonrpc":"1.0",
    "id":"1",
    "method":"createrawtransaction",
    "params":[
      [
        {"txid":"abc123...","vout":0}
      ],
      {
        "tmAddr...": 0.01
      }
    ]
  }' \
  http://127.0.0.1:18232/ | jq -r '.result'
```

### signrawtransaction
Sign raw transaction.

```bash
RAW_HEX="0400008085202f89..."

curl --user zcashrpc:your_secure_password_here_change_me \
  --data-binary "{\"jsonrpc\":\"1.0\",\"id\":\"1\",\"method\":\"signrawtransaction\",\"params\":[\"$RAW_HEX\"]}" \
  http://127.0.0.1:18232/ | jq '.result'
```

### z_getpaymentdisclosure
Get payment disclosure for transaction.

```bash
TXID="abc123..."
JS_INDEX=0
OUTPUT_INDEX=0

curl --user zcashrpc:your_secure_password_here_change_me \
  --data-binary "{\"jsonrpc\":\"1.0\",\"id\":\"1\",\"method\":\"z_getpaymentdisclosure\",\"params\":[\"$TXID\", $JS_INDEX, $OUTPUT_INDEX]}" \
  http://127.0.0.1:18232/ | jq -r '.result'
```

### z_validatepaymentdisclosure
Validate payment disclosure.

```bash
DISCLOSURE_HEX="zpd:..."

curl --user zcashrpc:your_secure_password_here_change_me \
  --data-binary "{\"jsonrpc\":\"1.0\",\"id\":\"1\",\"method\":\"z_validatepaymentdisclosure\",\"params\":[\"$DISCLOSURE_HEX\"]}" \
  http://127.0.0.1:18232/ | jq '.result'
```

### getrawmempool
Get all transactions in mempool.

```bash
curl --user zcashrpc:your_secure_password_here_change_me \
  --data-binary '{"jsonrpc":"1.0","id":"1","method":"getrawmempool","params":[]}' \
  http://127.0.0.1:18232/ | jq '.result'
```

### getmempoolinfo
Get mempool statistics.

```bash
curl --user zcashrpc:your_secure_password_here_change_me \
  --data-binary '{"jsonrpc":"1.0","id":"1","method":"getmempoolinfo","params":[]}' \
  http://127.0.0.1:18232/ | jq '.result'
```

---

## Common Use Cases

### Check Sync Progress

```bash
curl --user zcashrpc:your_secure_password_here_change_me \
  --data-binary '{"jsonrpc":"1.0","id":"1","method":"getblockchaininfo","params":[]}' \
  http://127.0.0.1:18232/ 2>/dev/null | \
  jq '.result | {
    blocks,
    headers,
    percent: (.verificationprogress * 100 | floor),
    synced: .initial_block_download_complete
  }'
```

### Get All Balances

```bash
curl --user zcashrpc:your_secure_password_here_change_me \
  --data-binary '{"jsonrpc":"1.0","id":"1","method":"z_gettotalbalance","params":[1]}' \
  http://127.0.0.1:18232/ | jq '.result'
```

### Create Shielded Address and Check Balance

```bash
# Create address
ZADDR=$(curl --user zcashrpc:your_secure_password_here_change_me \
  --data-binary '{"jsonrpc":"1.0","id":"1","method":"z_getnewaddress","params":["sapling"]}' \
  http://127.0.0.1:18232/ 2>/dev/null | jq -r '.result')

echo "New shielded address: $ZADDR"

# Check balance
curl --user zcashrpc:your_secure_password_here_change_me \
  --data-binary "{\"jsonrpc\":\"1.0\",\"id\":\"1\",\"method\":\"z_getbalance\",\"params\":[\"$ZADDR\"]}" \
  http://127.0.0.1:18232/ | jq '.result'
```

### Send Shielded Transaction with Memo

```bash
FROM_ADDR="ztestsapling1XXXXXXX"
TO_ADDR="ztestsapling1YYYYYYY"
AMOUNT="0.01"
MEMO_HEX=$(echo -n "Hello from escrowdv2" | xxd -p | tr -d '\n')

curl --user zcashrpc:your_secure_password_here_change_me \
  --data-binary "{
    \"jsonrpc\":\"1.0\",
    \"id\":\"1\",
    \"method\":\"z_sendmany\",
    \"params\":[
      \"$FROM_ADDR\",
      [{
        \"address\": \"$TO_ADDR\",
        \"amount\": $AMOUNT,
        \"memo\": \"$MEMO_HEX\"
      }]
    ]
  }" \
  http://127.0.0.1:18232/ | jq -r '.result'
```

### Check Transaction Status

```bash
TXID="abc123..."

# Get transaction details
curl --user zcashrpc:your_secure_password_here_change_me \
  --data-binary "{\"jsonrpc\":\"1.0\",\"id\":\"1\",\"method\":\"gettransaction\",\"params\":[\"$TXID\"]}" \
  http://127.0.0.1:18232/ 2>/dev/null | \
  jq '.result | {
    confirmations,
    blockhash,
    time,
    amount,
    fee
  }'
```

### Monitor Operation Status

```bash
OPID="opid-abc123..."

watch -n 2 "curl -s --user zcashrpc:your_secure_password_here_change_me \
  --data-binary '{\"jsonrpc\":\"1.0\",\"id\":\"1\",\"method\":\"z_getoperationstatus\",\"params\":[[\"$OPID\"]]}' \
  http://127.0.0.1:18232/ | jq '.result[0]'"
```

---

## Error Codes

Common RPC error codes:

| Code | Message | Description |
|------|---------|-------------|
| -1 | RPC_MISC_ERROR | General error |
| -3 | RPC_INVALID_ADDRESS_OR_KEY | Invalid address or key |
| -4 | RPC_OUT_OF_MEMORY | Out of memory |
| -5 | RPC_INVALID_PARAMETER | Invalid parameter |
| -6 | RPC_WALLET_INSUFFICIENT_FUNDS | Insufficient funds |
| -8 | RPC_WALLET_ERROR | Wallet error |
| -13 | RPC_WALLET_KEYPOOL_RAN_OUT | Key pool exhausted |
| -14 | RPC_WALLET_UNLOCK_NEEDED | Wallet unlock needed |
| -17 | RPC_WALLET_INSUFFICIENT_FUNDS | Insufficient funds |
| -28 | RPC_IN_WARMUP | Node still warming up |

---

## Shell Aliases (Optional)

Add to `~/.bashrc` for convenience:

```bash
# Zcash RPC alias
alias zcash-rpc='curl -s --user zcashrpc:your_secure_password_here_change_me --data-binary'

# Usage:
zcash-rpc '{"jsonrpc":"1.0","id":"1","method":"getblockchaininfo","params":[]}' http://127.0.0.1:18232/ | jq '.result'
```

---

## Docker-Specific Commands

### Access zcash-cli Inside Container

```bash
# Get blockchain info
docker exec zcashd-testnet zcash-cli -testnet -rpcuser=zcashrpc -rpcpassword=your_secure_password_here_change_me getblockchaininfo

# Create new address
docker exec zcashd-testnet zcash-cli -testnet -rpcuser=zcashrpc -rpcpassword=your_secure_password_here_change_me getnewaddress

# Get balance
docker exec zcashd-testnet zcash-cli -testnet -rpcuser=zcashrpc -rpcpassword=your_secure_password_here_change_me getbalance
```

### View Logs

```bash
# Follow logs
docker logs -f zcashd-testnet

# Last 100 lines
docker logs zcashd-testnet --tail 100

# Grep for specific events
docker logs zcashd-testnet 2>&1 | grep "UpdateTip"
```

### Container Management

```bash
# Stop container
docker stop zcashd-testnet

# Start container
docker start zcashd-testnet

# Restart container
docker restart zcashd-testnet

# Remove container (keeps data)
docker rm zcashd-testnet

# Check container stats
docker stats zcashd-testnet
```

---

## Resources

- **Official RPC Docs**: https://zcash.github.io/rpc/
- **Zcash Protocol**: https://zips.z.cash/
- **Testnet Faucet**: https://faucet.testnet.z.cash/
- **Block Explorer**: https://explorer.testnet.z.cash/
- **Zcashd GitHub**: https://github.com/zcash/zcash

---

---

# Lightwalletd gRPC/HTTP API Reference

Lightwalletd provides a lightweight interface for wallet applications to interact with zcashd.

---

## Connection Details

**gRPC Endpoint**: `http://127.0.0.1:9067`
**HTTP Endpoint**: `http://127.0.0.1:9068`
**Container**: `lightwalletd`
**Network Mode**: host

### Architecture

Lightwalletd acts as a bridge between wallet applications and zcashd:
- Reads blockchain data from zcashd (via zcash.conf)
- Provides compact block format for efficient sync
- Serves gRPC API for wallet operations
- HTTP endpoint for status monitoring

---

## HTTP API Endpoints

### GET /status

Get lightwalletd service status and sync information.

```bash
curl http://localhost:9068/status
```

**Returns**:
```json
{
  "saplingHeight": 2500000,
  "orchardHeight": 2100000,
  "chainName": "test",
  "consensusBranchId": "e9ff75a6"
}
```

**Fields**:
- `saplingHeight`: Latest Sapling block height synced
- `orchardHeight`: Latest Orchard block height synced (NU5+)
- `chainName`: Network name ("main" or "test")
- `consensusBranchId`: Current consensus branch ID (hex)

---

## gRPC API Methods

Lightwalletd implements the CompactTxStreamer service defined in [compact_formats.proto](https://github.com/zcash/lightwalletd/blob/master/walletrpc/compact_formats.proto).

### Core Wallet Methods

#### GetLatestBlock
Get the latest block height.

```bash
grpcurl -plaintext -d '{}' localhost:9067 cash.z.wallet.sdk.rpc.CompactTxStreamer/GetLatestBlock
```

**Returns**:
```json
{
  "height": "2500000",
  "hash": "00000000...",
  "time": 1701234567
}
```

#### GetBlock
Get compact block by height.

```bash
grpcurl -plaintext -d '{"height": 2189042}' localhost:9067 cash.z.wallet.sdk.rpc.CompactTxStreamer/GetBlock
```

**Returns**: CompactBlock with height, hash, time, and compact transactions.

#### GetBlockRange (Streaming)
Stream compact blocks within a height range.

```bash
grpcurl -plaintext -d '{"start": {"height": 2189000}, "end": {"height": 2189100}}' \
  localhost:9067 cash.z.wallet.sdk.rpc.CompactTxStreamer/GetBlockRange
```

**Use case**: Initial wallet sync - downloads compact blocks for scanning.

#### GetTransaction
Get full transaction details by txid.

```bash
TXID="abc123..."
grpcurl -plaintext -d "{\"hash\": \"$TXID\"}" localhost:9067 cash.z.wallet.sdk.rpc.CompactTxStreamer/GetTransaction
```

**Returns**: Full raw transaction hex.

#### SendTransaction
Broadcast signed transaction to network.

```bash
RAW_HEX="0400008085202f89..."
grpcurl -plaintext -d "{\"data\": \"$RAW_HEX\"}" localhost:9067 cash.z.wallet.sdk.rpc.CompactTxStreamer/SendTransaction
```

**Returns**:
```json
{
  "errorCode": 0,
  "errorMessage": ""
}
```

**Error codes**:
- `0`: Success
- `-1`: Transaction rejected
- `-8`: Insufficient fee

### Shielded Protocol Methods

#### GetTreeState
Get Sapling/Orchard commitment tree state at block height.

```bash
grpcurl -plaintext -d '{"height": 2189042}' localhost:9067 cash.z.wallet.sdk.rpc.CompactTxStreamer/GetTreeState
```

**Returns**:
```json
{
  "network": "test",
  "height": "2189042",
  "hash": "00000000...",
  "time": 1701234567,
  "saplingTree": "01f7...",
  "orchardTree": "01a3..."
}
```

**Use case**: Wallet sync requires tree state to construct valid proofs.

#### GetSubtreeRoots (Streaming)
Get Sapling/Orchard subtree roots for wallet sync.

```bash
# Sapling subtrees starting from index 0
grpcurl -plaintext -d '{"shieldedProtocol": "sapling", "startIndex": 0}' \
  localhost:9067 cash.z.wallet.sdk.rpc.CompactTxStreamer/GetSubtreeRoots

# Orchard subtrees
grpcurl -plaintext -d '{"shieldedProtocol": "orchard", "startIndex": 0}' \
  localhost:9067 cash.z.wallet.sdk.rpc.CompactTxStreamer/GetSubtreeRoots
```

**Returns**: Stream of subtree roots with completion heights.

**Use case**: Required for wallet sync - faster than scanning all blocks.

**⚠️ Requires**: zcashd must run with `-experimentalfeatures` and `-lightwalletd` flags.

#### GetAddressTxids (Streaming)
Get transaction IDs for an address within height range.

```bash
TADDR="tmXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
grpcurl -plaintext -d "{
  \"addresses\": [\"$TADDR\"],
  \"range\": {
    \"start\": {\"height\": 2189000},
    \"end\": {\"height\": 2189100}
  }
}" localhost:9067 cash.z.wallet.sdk.rpc.CompactTxStreamer/GetAddressTxids
```

**Returns**: Stream of transaction IDs involving the address.

### Information Methods

#### GetLightdInfo
Get lightwalletd server information.

```bash
grpcurl -plaintext -d '{}' localhost:9067 cash.z.wallet.sdk.rpc.CompactTxStreamer/GetLightdInfo
```

**Returns**:
```json
{
  "version": "0.4.17",
  "vendor": "ECC LightWalletD",
  "taddrSupport": true,
  "chainName": "test",
  "saplingActivationHeight": "280000",
  "orchardActivationHeight": "1842420",
  "consensusBranchId": "e9ff75a6",
  "blockHeight": "2500000"
}
```

#### Ping
Check server liveness.

```bash
grpcurl -plaintext -d '{}' localhost:9067 cash.z.wallet.sdk.rpc.CompactTxStreamer/Ping
```

**Returns**:
```json
{
  "duration": 1
}
```

### Mempool Methods

#### GetMempoolTx (Streaming)
Get transaction from mempool.

```bash
grpcurl -plaintext -d '{}' localhost:9067 cash.z.wallet.sdk.rpc.CompactTxStreamer/GetMempoolTx
```

**Returns**: Stream of pending transactions in mempool.

#### GetMempoolStream (Streaming)
Subscribe to mempool updates.

```bash
grpcurl -plaintext -d '{}' localhost:9067 cash.z.wallet.sdk.rpc.CompactTxStreamer/GetMempoolStream
```

**Returns**: Live stream of new mempool transactions.

---

## Common Use Cases

### Check Lightwalletd Status

```bash
# HTTP endpoint (fastest)
curl -s http://localhost:9068/status | jq '.'

# gRPC endpoint
grpcurl -plaintext -d '{}' localhost:9067 cash.z.wallet.sdk.rpc.CompactTxStreamer/GetLightdInfo | jq '.'
```

### Verify Sync Progress

```bash
# Get lightwalletd height
LWD_HEIGHT=$(curl -s http://localhost:9068/status | jq -r '.saplingHeight')

# Get zcashd height
ZCD_HEIGHT=$(curl -s --user zcashrpc:your_secure_password_here_change_me \
  --data-binary '{"jsonrpc":"1.0","id":"1","method":"getblockcount","params":[]}' \
  http://127.0.0.1:18232/ | jq -r '.result')

echo "Lightwalletd: $LWD_HEIGHT"
echo "Zcashd: $ZCD_HEIGHT"
echo "Gap: $((ZCD_HEIGHT - LWD_HEIGHT)) blocks"
```

### Download Compact Blocks for Wallet Sync

```bash
# Download blocks 2189000-2189100
grpcurl -plaintext -d '{"start": {"height": 2189000}, "end": {"height": 2189100}}' \
  localhost:9067 cash.z.wallet.sdk.rpc.CompactTxStreamer/GetBlockRange | head -20
```

### Get Sapling Subtree Roots (Required for Wallet Init)

```bash
grpcurl -plaintext -d '{"shieldedProtocol": "sapling", "startIndex": 0, "maxEntries": 10}' \
  localhost:9067 cash.z.wallet.sdk.rpc.CompactTxStreamer/GetSubtreeRoots
```

### Broadcast Transaction

```bash
# First, create and sign transaction via zcashd RPC
OPID=$(curl -s --user zcashrpc:your_secure_password_here_change_me \
  --data-binary '{"jsonrpc":"1.0","id":"1","method":"z_sendmany","params":["tmXXX",[{"address":"tmYYY","amount":0.001}]]}' \
  http://127.0.0.1:18232/ | jq -r '.result')

# Wait for operation to complete
sleep 5

# Get transaction hex
TXID=$(curl -s --user zcashrpc:your_secure_password_here_change_me \
  --data-binary "{\"jsonrpc\":\"1.0\",\"id\":\"1\",\"method\":\"z_getoperationstatus\",\"params\":[[\"$OPID\"]]}" \
  http://127.0.0.1:18232/ | jq -r '.result[0].result.txid')

RAW_TX=$(curl -s --user zcashrpc:your_secure_password_here_change_me \
  --data-binary "{\"jsonrpc\":\"1.0\",\"id\":\"1\",\"method\":\"getrawtransaction\",\"params\":[\"$TXID\"]}" \
  http://127.0.0.1:18232/ | jq -r '.result')

# Broadcast via lightwalletd
grpcurl -plaintext -d "{\"data\": \"$RAW_TX\"}" localhost:9067 cash.z.wallet.sdk.rpc.CompactTxStreamer/SendTransaction
```

---

## Docker-Specific Commands

### View Lightwalletd Logs

```bash
# Follow logs
docker logs -f lightwalletd

# Last 100 lines
docker logs lightwalletd --tail 100

# Grep for errors
docker logs lightwalletd 2>&1 | grep -i error
```

### Container Management

```bash
# Stop container
docker stop lightwalletd

# Start container
docker start lightwalletd

# Restart container
docker restart lightwalletd

# Check health status
docker inspect lightwalletd --format='{{.State.Health.Status}}'

# Check container stats
docker stats lightwalletd
```

### Access Lightwalletd Data Directory

```bash
# List cached data
ls -lh /home/botvenom/Desktop/work/web3/mina/projects/professional/Doot/protocol/apps_on_doot/zec_barter/zcash/lightwalletd/data/

# View log file
tail -f /home/botvenom/Desktop/work/web3/mina/projects/professional/Doot/protocol/apps_on_doot/zec_barter/zcash/lightwalletd/data/lightwalletd.log

# Check disk usage
du -sh /home/botvenom/Desktop/work/web3/mina/projects/professional/Doot/protocol/apps_on_doot/zec_barter/zcash/lightwalletd/data/
```

---

## Troubleshooting

### Issue: "GetTreeState: z_gettreestate did not return treestate"

**Cause**: Zcashd hasn't synced enough blocks or missing required features.

**Fix**:
1. Ensure zcashd has `-experimentalfeatures` and `-lightwalletd` flags
2. Wait for zcashd to sync more blocks
3. Verify: `curl --user zcashrpc:pass --data-binary '{"jsonrpc":"1.0","id":"1","method":"z_gettreestate","params":["1"]}' http://127.0.0.1:18232/`

### Issue: "GetSubtreeRoots: z_getsubtreesbyindex is disabled"

**Cause**: Zcashd missing required flags.

**Fix**: Add to zcashd command:
```bash
-experimentalfeatures
-lightwalletd
```

### Issue: HTTP 404 on /status

**Cause**: Lightwalletd hasn't finished initial sync or zcashd not ready.

**Fix**:
1. Check zcashd is running: `docker ps | grep zcashd`
2. Check zcashd sync: `curl --user zcashrpc:pass --data-binary '{"method":"getblockchaininfo"}' http://127.0.0.1:18232/`
3. Wait for lightwalletd to sync with zcashd

### Issue: "connection refused" on port 9067/9068

**Cause**: Lightwalletd not running or network misconfiguration.

**Fix**:
1. Check container: `docker ps | grep lightwalletd`
2. Check network mode: `docker inspect lightwalletd --format='{{.HostConfig.NetworkMode}}'` (should be "host")
3. Check logs: `docker logs lightwalletd`

---

## Installing grpcurl (Optional)

For testing gRPC endpoints:

```bash
# Linux
wget https://github.com/fullstorydev/grpcurl/releases/download/v1.8.9/grpcurl_1.8.9_linux_x86_64.tar.gz
tar -xvf grpcurl_1.8.9_linux_x86_64.tar.gz
sudo mv grpcurl /usr/local/bin/
chmod +x /usr/local/bin/grpcurl

# macOS
brew install grpcurl

# Verify
grpcurl --version
```

### List Available gRPC Methods

```bash
grpcurl -plaintext localhost:9067 list
grpcurl -plaintext localhost:9067 list cash.z.wallet.sdk.rpc.CompactTxStreamer
```

---

## Resources

- **Lightwalletd GitHub**: https://github.com/zcash/lightwalletd
- **gRPC Protocol Definition**: https://github.com/zcash/lightwalletd/blob/master/walletrpc/compact_formats.proto
- **Zcash Light Client Protocol**: https://zips.z.cash/zip-0307
- **Wallet SDK Documentation**: https://github.com/zcash/librustzcash

---

**Last Updated**: 2025-12-02
**Zcashd Version**: Latest (electriccoinco/zcashd:latest)
**Lightwalletd Version**: Latest (electriccoinco/lightwalletd:latest)
**Network**: Testnet
