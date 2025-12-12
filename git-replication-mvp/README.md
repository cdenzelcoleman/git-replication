# Git Replication MVP

Minimal viable prototype demonstrating synchronous replication between Git servers using 2-phase commit protocol.

## Features

- ✅ 2-server synchronous replication
- ✅ 2-phase commit protocol (prepare → commit)
- ✅ Quorum-based writes (configurable)
- ✅ Health check endpoints
- ✅ Repository creation with automatic replication
- ✅ Independent storage per server

## Architecture

```
┌──────────────┐          ┌──────────────┐
│  Server 1    │◄────────►│  Server 2    │
│  Port: 3001  │          │  Port: 3002  │
│              │          │              │
│  Storage:    │          │  Storage:    │
│  data-srv1/  │          │  data-srv2/  │
└──────────────┘          └──────────────┘
       │                         │
       └─────────┬───────────────┘
                 │
           Sync Replication
        (2-Phase Commit)
```

## Quick Start

### Install Dependencies

```bash
npm install
```

### Run Tests

```bash
npm test
```

### Start Two Servers

Terminal 1 (Server 1):
```bash
PORT=3001 SERVER_ID=server-1 DATA_DIR=./data-server1 PEER_URLS=http://localhost:3002 npm run dev
```

Terminal 2 (Server 2):
```bash
PORT=3002 SERVER_ID=server-2 DATA_DIR=./data-server2 PEER_URLS=http://localhost:3001 npm run dev
```

### Test Replication

```bash
# Create a repository on server 1
curl -X POST http://localhost:3001/repos \
  -H "Content-Type: application/json" \
  -d '{"repo_id": "testuser/hello-world"}'

# Verify it exists on server 2
curl http://localhost:3002/repos/testuser/hello-world

# Expected response:
# {"repo_id":"testuser/hello-world","exists":true,"path":"..."}
```

## API Endpoints

### Health Check

```bash
GET /health
```

Response:
```json
{
  "status": "healthy",
  "server_id": "server-1",
  "timestamp": "2025-12-11T10:30:00.000Z",
  "load": {
    "cpu": 15.5,
    "memory": 45.2
  },
  "peers": 1
}
```

### Create Repository

```bash
POST /repos
Content-Type: application/json

{
  "repo_id": "user/repo-name"
}
```

Response:
```json
{
  "repo_id": "user/repo-name",
  "created": true,
  "replicated": true,
  "peers_confirmed": 1
}
```

### Get Repository

```bash
GET /repos/:user/:repo
```

Response:
```json
{
  "repo_id": "user/repo-name",
  "exists": true,
  "path": "./data/user/repo-name.git"
}
```

### List All Repositories

```bash
GET /repos
```

Response:
```json
{
  "repos": ["user1/repo1", "user2/repo2"],
  "count": 2
}
```

## Replication Protocol

### 2-Phase Commit

1. **Phase 1: Prepare**
   - Coordinator sends prepare request to all peers
   - Each peer validates and stages the write
   - Peers respond with acknowledgment
   - Quorum check: Need N/2 + 1 confirmations

2. **Phase 2: Commit**
   - If quorum reached, coordinator sends commit
   - All peers finalize the write
   - If quorum not reached, send abort

### Quorum Rules

- **2 servers:** Need 1 peer confirmation (self + 1 = quorum of 2)
- **6 servers:** Need 2 peer confirmations (self + 2 = quorum of 3)

## Testing

Run all tests:
```bash
npm test
```

Run specific test file:
```bash
npm test storage.test.ts
```

Watch mode:
```bash
npm run test:watch
```

## Project Structure

```
git-replication-mvp/
├── src/
│   ├── server.ts              # Main Express server
│   ├── storage.ts             # Repository storage layer
│   ├── replication.ts         # Replication coordinator
│   ├── replication-handler.ts # Replication API handlers
│   ├── git-server.ts          # Git server logic
│   └── *.test.ts              # Unit tests
├── data-server1/              # Server 1 storage (gitignored)
├── data-server2/              # Server 2 storage (gitignored)
├── package.json
├── tsconfig.json
└── README.md
```

## Environment Variables

- `PORT` - Server port (default: 3000)
- `SERVER_ID` - Unique server identifier (default: "server-1")
- `DATA_DIR` - Data storage directory (default: "./data")
- `PEER_URLS` - Comma-separated peer URLs (e.g., "http://localhost:3002,http://localhost:3003")

## Limitations (MVP)

This is a minimal prototype with the following limitations:

- ⚠️ No actual Git operations (clone/push/pull) - only repo creation
- ⚠️ In-memory transaction log (not persisted)
- ⚠️ No authentication or authorization
- ⚠️ No distributed lock service (etcd/Consul)
- ⚠️ No monitoring or observability
- ⚠️ Single datacenter only
- ⚠️ No production-grade error handling

## Next Steps

To evolve this into a production system:

1. **Git Operations:** Integrate actual Git HTTP/SSH protocols
2. **Distributed Locks:** Add etcd/Consul for coordination
3. **Authentication:** Implement user auth and access control
4. **Persistence:** Persist transaction logs to disk
5. **Monitoring:** Add Prometheus metrics and Grafana dashboards
6. **Scale:** Test with 6 servers and load testing
7. **Recovery:** Implement catch-up sync for failed servers

## License

MIT
