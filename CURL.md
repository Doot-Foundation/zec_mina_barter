# ZEC Barter cURL Commands Reference

## Zcash RPC Commands

### Check Blockchain Info
```bash
curl -u zcashrpc:your_secure_password_here_change_me \
  --data-binary '{"jsonrpc":"1.0","id":"info","method":"getblockchaininfo"}' \
  -H 'content-type:text/plain;' \
  http://127.0.0.1:18232/
```

### List All Addresses
```bash
curl -u zcashrpc:your_secure_password_here_change_me \
  --data-binary '{"jsonrpc":"1.0","id":"listaddr","method":"listaddresses"}' \
  -H 'content-type:text/plain;' \
  http://127.0.0.1:18232/
```

### Check Balance for Account
```bash
# Account 0
curl -u zcashrpc:your_secure_password_here_change_me \
  --data-binary '{"jsonrpc":"1.0","id":"bal","method":"z_getbalanceforaccount","params":[0]}' \
  -H 'content-type:text/plain;' \
  http://127.0.0.1:18232/

# Account 1
curl -u zcashrpc:your_secure_password_here_change_me \
  --data-binary '{"jsonrpc":"1.0","id":"bal","method":"z_getbalanceforaccount","params":[1]}' \
  -H 'content-type:text/plain;' \
  http://127.0.0.1:18232/
```

### Send ZEC (z_sendmany)
```bash
# Replace YOUR_SOURCE_ADDRESS, DESTINATION_ADDRESS, AMOUNT, and HEX_MEMO
curl -u zcashrpc:your_secure_password_here_change_me \
  --data-binary '{"jsonrpc":"1.0","id":"fund","method":"z_sendmany","params":["YOUR_SOURCE_ADDRESS",[{"address":"DESTINATION_ADDRESS","amount":AMOUNT,"memo":"HEX_MEMO"}],1,null,"AllowRevealedAmounts"]}' \
  -H 'content-type:text/plain;' \
  http://127.0.0.1:18232/
```

**Example (Account to Account Transfer):**
```bash
curl -u zcashrpc:your_secure_password_here_change_me \
  --data-binary '{"jsonrpc":"1.0","id":"transfer","method":"z_sendmany","params":["utest1ttt7ggr22jutu4dlvw8649j6a5c70ljj3ec5tymtaqmrl69rx7vruup73wy5ujydfvzst0qq2f0kup88wrhtp7uamrzw708hxpgumy7l5hzywr9z9freszdnqpvjp9cfrgjphs2me5cpc39j7ts4ywyxk2659er8xju34yxmkk08wk8q2hqvftjx7tx6hjd7nxkhrf30ja2c2v4xppk",[{"address":"utest15dsyyx0mnx7tgnewau68lxsylcyttmxvd2sddpjjctscjmdqld5dwj76mcggymhg32hk8jxr398hmwxj2cf6skpnxyhy8v2yw8j97h04pzjassln94mgeuf2h9v9mp0gmhd5cxtqcz84dm856tp5pkp6q7tld9pe3y3dcrdmw5sqa7lq8hwp8der5209el4rcp7vjpjrgl7fxrucwk2","amount":0.3}]]}' \
  -H 'content-type:text/plain;' \
  http://127.0.0.1:18232/
```

### Check Operation Status
```bash
# Check specific operation
curl -u zcashrpc:your_secure_password_here_change_me \
  --data-binary '{"jsonrpc":"1.0","id":"status","method":"z_getoperationstatus","params":[["OPID_HERE"]]}' \
  -H 'content-type:text/plain;' \
  http://127.0.0.1:18232/

# Check all recent operations
curl -u zcashrpc:your_secure_password_here_change_me \
  --data-binary '{"jsonrpc":"1.0","id":"status","method":"z_getoperationstatus"}' \
  -H 'content-type:text/plain;' \
  http://127.0.0.1:18232/
```

### Get Transaction Details
```bash
curl -u zcashrpc:your_secure_password_here_change_me \
  --data-binary '{"jsonrpc":"1.0","id":"tx","method":"gettransaction","params":["TXID_HERE"]}' \
  -H 'content-type:text/plain;' \
  http://127.0.0.1:18232/
```

## escrowdv2 Commands

### Check escrowdv2 Status
```bash
# Replace PORT with actual escrowdv2 instance port
curl http://127.0.0.1:PORT/status
```

### Get escrowdv2 Address
```bash
curl http://127.0.0.1:PORT/address
```

### Verify ZEC Funding (POST)
```bash
# Replace PORT, API_KEY, and ORIGIN_ADDRESS
curl -X POST http://127.0.0.1:PORT/funding/shielded \
  -H 'Content-Type: application/json' \
  -d '{"api_key":"API_KEY","memo":"API_KEY","origin_address":"ORIGIN_ADDRESS"}'
```

## Docker Commands

### Check Lightwalletd Logs
```bash
# Last 20 lines
docker logs lightwalletd --tail 20

# Follow logs live
docker logs lightwalletd -f

# Check for errors
docker logs lightwalletd 2>&1 | grep -i "error\|fatal" | tail -30
```

### Check zcashd Container Logs
```bash
docker logs zcashd-testnet --tail 30
```

### Restart Lightwalletd
```bash
docker restart lightwalletd && sleep 2 && docker logs lightwalletd --tail 50
```

## Middleware API Commands

### Check Middleware Health
```bash
curl http://127.0.0.1:3000/health
```

### Spawn escrowdv2 Instance
```bash
curl -X POST http://127.0.0.1:3000/api/spawn-escrowd \
  -H 'Content-Type: application/json' \
  -d '{"tradeId":"TRADE_UUID","apiKey":"API_KEY"}'
```

### Get escrowdv2 Instance Status via Middleware
```bash
curl http://127.0.0.1:3000/api/escrowd/TRADE_ID/status
```

### Kill escrowdv2 Instance
```bash
curl -X DELETE http://127.0.0.1:3000/api/escrowd/TRADE_ID
```

## Utility Commands

### Generate Hex-Encoded Memo from API Key
```bash
echo -n "YOUR_API_KEY" | xxd -p
```

### Check Port Usage
```bash
lsof -ti:PORT
```

### Kill Process on Port
```bash
lsof -ti:PORT | xargs -r kill -9
```

## Notes

- **Privacy Policy**: Use `"AllowRevealedAmounts"` when sending between shielded pools (Sapling ↔ Orchard)
- **Minimum ZEC**: Always send at least 0.001 ZEC (funding minimum)
- **Memo Format**: Must be hex-encoded for z_sendmany
- **Address Types**:
  - Transparent: starts with `t`
  - Shielded Sapling: starts with `zs`
  - Unified Address: starts with `u` (testnet: `utest`)
- **Port Range**: escrowdv2 instances use sequential ports starting from 9000
