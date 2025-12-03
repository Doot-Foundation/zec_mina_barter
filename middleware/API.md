# Middleware API Documentation

The middleware exposes a REST API for spawning and managing escrowdv2 instances.

## Base URL

```
http://127.0.0.1:3000
```

(Configurable via `API_HOST` and `API_PORT` environment variables)

---

## Endpoints

### 1. Health Check

**GET** `/health`

Returns the health status of the middleware.

**Response:**
```json
{
  "status": "ok",
  "service": "mina-zec-barter-middleware",
  "timestamp": "2025-12-03T12:00:00.000Z"
}
```

---

### 2. Spawn Escrowdv2 Instance

**POST** `/api/spawn-escrowd`

Spawns a new escrowdv2 instance for a trade on a deterministic port.

**Request Body:**
```json
{
  "tradeId": "550e8400-e29b-41d4-a716-446655440000",
  "apiKey": "your-api-key-here"
}
```

**Parameters:**
- `tradeId` (required): Trade UUID that determines the port via Poseidon hash
- `apiKey` (required): API key for the escrowdv2 instance

**Response (Success):**
```json
{
  "success": true,
  "port": 8123,
  "message": "Instance spawned successfully"
}
```

**Response (Already Running):**
```json
{
  "success": true,
  "port": 8123,
  "message": "Instance already running"
}
```

**Response (Error):**
```json
{
  "success": false,
  "port": 8123,
  "message": "Failed to spawn: error details"
}
```

**Example Usage:**
```bash
curl -X POST http://127.0.0.1:3000/api/spawn-escrowd \
  -H "Content-Type: application/json" \
  -d '{
    "tradeId": "550e8400-e29b-41d4-a716-446655440000",
    "apiKey": "test-api-key-123"
  }'
```

---

### 3. Get Escrowdv2 Instance Status

**GET** `/api/escrowd/:tradeId/status`

Queries the status of an escrowdv2 instance.

**Parameters:**
- `tradeId` (path): Trade UUID

**Response (Success):**
```json
{
  "success": true,
  "port": 8123,
  "status": {
    "verified": true,
    "in_transit": false,
    "origin_address": "tmXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
    "origin_type": "shielded",
    "received_amount": 1000000,
    "expected_amount": 1000000
  }
}
```

**Response (Not Found):**
```json
{
  "success": false,
  "error": "Instance not found or not responding",
  "port": 8123
}
```

**Example Usage:**
```bash
curl http://127.0.0.1:3000/api/escrowd/550e8400-e29b-41d4-a716-446655440000/status
```

---

### 4. Kill Escrowdv2 Instance

**DELETE** `/api/escrowd/:tradeId`

Terminates an escrowdv2 instance managed by the middleware.

**Parameters:**
- `tradeId` (path): Trade UUID

**Response:**
```json
{
  "success": true,
  "message": "Instance killed"
}
```

**Example Usage:**
```bash
curl -X DELETE http://127.0.0.1:3000/api/escrowd/550e8400-e29b-41d4-a716-446655440000
```

---

### 5. List Managed Instances

**GET** `/api/escrowd/instances`

Lists all escrowdv2 instances currently managed by the middleware.

**Response:**
```json
{
  "success": true,
  "count": 2,
  "instances": [
    {
      "tradeId": "550e8400-e29b-41d4-a716-446655440000",
      "pid": 12345
    },
    {
      "tradeId": "660e8400-e29b-41d4-a716-446655440001",
      "pid": 12346
    }
  ]
}
```

**Example Usage:**
```bash
curl http://127.0.0.1:3000/api/escrowd/instances
```

---

## Port Calculation

Ports are calculated deterministically from trade UUIDs using the same Poseidon hash algorithm as the zkApp:

```typescript
port = basePort + (Poseidon(hash(uuid_chunks)) % portRange)
```

**Default Configuration:**
- Base Port: `8000`
- Port Range: `10000`
- Result: Ports between `8000-18000`

**Environment Variables:**
- `ESCROWD_BASE_PORT`: Starting port (default: 8000)
- `ESCROWD_PORT_RANGE`: Range of ports (default: 10000)

---

## Integration Flow

### Mina-Initiated Barter (User buys ZEC with MINA)

1. **User clicks "Buy" on Mina listing**
   ```javascript
   // UI creates trade in database
   const trade = await createTrade({ /* ... */ });

   // UI spawns escrowdv2 instance
   const response = await fetch('http://middleware.local:3000/api/spawn-escrowd', {
     method: 'POST',
     headers: { 'Content-Type': 'application/json' },
     body: JSON.stringify({
       tradeId: trade.id,
       apiKey: trade.apiKey
     })
   });

   const { port } = await response.json();
   ```

2. **Get ZEC escrow address**
   ```javascript
   const addressResponse = await fetch(`http://127.0.0.1:${port}/address`);
   const { transparent_address, shielded_address } = await addressResponse.json();
   ```

3. **User sends ZEC to escrow address**

4. **Middleware detects both sides funded and locks**

5. **After claim, middleware sweeps ZEC to buyer's address**

---

## Error Handling

All endpoints return proper HTTP status codes:

- `200 OK`: Success
- `400 Bad Request`: Missing or invalid parameters
- `404 Not Found`: Resource not found
- `500 Internal Server Error`: Server error

Error responses include a `success: false` field and an `error` message:

```json
{
  "success": false,
  "error": "Detailed error message"
}
```

---

## Configuration

**Required Environment Variables:**
- `OPERATOR_PRIVATE_KEY`: Mina private key for coordinator
- `MINA_GRAPHQL_ENDPOINT`: Mina/Zeko GraphQL endpoint
- `MINA_POOL_ADDRESS`: Pool contract address
- `ESCROWD_OPERATOR_TOKEN`: Token for escrowdv2 operator endpoints
- `SUPABASE_URL`: Supabase database URL
- `SUPABASE_SERVICE_ROLE_KEY`: Supabase service key
- `ORACLE_API_KEY`: Doot oracle API key

**Optional Environment Variables:**
- `API_HOST`: API server host (default: 127.0.0.1)
- `API_PORT`: API server port (default: 3000)
- `ESCROWD_BASE_PORT`: Escrowdv2 base port (default: 8000)
- `ESCROWD_PORT_RANGE`: Port range (default: 10000)
- `ESCROWD_BINARY_PATH`: Path to escrowdv2 binary (default: "cargo")
- `ESCROWD_WORKING_DIR`: Working directory (default: "../zcash/escrowdv2")

---

## Development

### Start the middleware with API server:

```bash
npm run build
npm start
```

The API server will start alongside the coordinator and settlement worker.

### Test the spawn endpoint:

```bash
# Spawn an instance
curl -X POST http://127.0.0.1:3000/api/spawn-escrowd \
  -H "Content-Type: application/json" \
  -d '{
    "tradeId": "550e8400-e29b-41d4-a716-446655440000",
    "apiKey": "test-key"
  }'

# Check its status
curl http://127.0.0.1:3000/api/escrowd/550e8400-e29b-41d4-a716-446655440000/status

# List all instances
curl http://127.0.0.1:3000/api/escrowd/instances

# Kill the instance
curl -X DELETE http://127.0.0.1:3000/api/escrowd/550e8400-e29b-41d4-a716-446655440000
```

---

## Security Considerations

1. **Localhost Only**: By default, the API binds to `127.0.0.1` and is only accessible from localhost

2. **No Authentication**: Currently no authentication on spawn endpoints - suitable for localhost development

3. **Process Management**: The middleware tracks spawned processes and cleans them up on shutdown

4. **Port Determinism**: Ports are deterministically calculated, preventing port conflicts

For production deployments, consider:
- Adding authentication/authorization
- Rate limiting
- Logging and monitoring
- Network isolation
