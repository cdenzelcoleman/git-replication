# Git Replication MVP Architecture

## Overview

This MVP demonstrates synchronous replication between Git servers using a 2-phase commit protocol. The system ensures data consistency across multiple servers by requiring quorum-based acknowledgment before confirming writes.

### Key Concepts

- **Synchronous Replication**: Writes complete only after peer servers confirm receipt
- **2-Phase Commit**: Prepare phase stages writes, commit phase finalizes them
- **Quorum-Based Writes**: Configurable minimum number of servers must acknowledge writes
- **Bare Git Repositories**: Storage uses Git's native format for repository data
- **Independent Storage**: Each server maintains its own isolated storage directory

## Components

### 1. Git Server (`src/git-server.ts`)

High-level coordinator that handles incoming client requests and orchestrates storage and replication.

**Responsibilities:**
- Accept HTTP requests for repository operations
- Coordinate local storage operations
- Trigger replication to peer servers
- Handle replication failures with rollback logic

**Key Methods:**
- `handleCreateRepo()`: Creates repository locally and replicates to peers
- `handleGetRepo()`: Checks if repository exists locally
- `handleListRepos()`: Lists all repositories in local storage

**Replication Flow:**
1. Create repository in local storage
2. If peers configured, initiate 2-phase commit
3. If replication fails, return error (rollback would happen in production)
4. If replication succeeds, return success with peer confirmation count

### 2. Storage Layer (`src/storage.ts`)

Manages Git repository creation and access using isomorphic-git.

**Responsibilities:**
- Initialize storage directory structure
- Create bare Git repositories
- Check repository existence
- List all repositories
- Provide repository paths

**Storage Structure:**
```
data-server1/
├── user1/
│   ├── repo1.git/
│   │   ├── HEAD
│   │   ├── config
│   │   ├── objects/
│   │   └── refs/
│   └── repo2.git/
└── user2/
    └── repo3.git/
```

**Key Methods:**
- `initialize()`: Creates root data directory if missing
- `createRepo(repo_id)`: Creates bare Git repository at path `data/user/repo.git`
- `repoExists(repo_id)`: Checks if repository directory exists
- `listRepos()`: Recursively finds all `.git` directories
- `getRepoPath(repo_id)`: Converts `user/repo` to `data/user/repo.git`

### 3. Replication Coordinator (`src/replication.ts`)

Implements 2-phase commit protocol for synchronous replication.

**Responsibilities:**
- Calculate quorum size based on cluster size
- Execute prepare phase across all peers
- Verify quorum reached before committing
- Execute commit phase on successful peers
- Send abort to all peers if quorum not reached

**Quorum Calculation:**
```typescript
getQuorumSize(): number {
  const totalServers = 1 + this.peerUrls.length;
  // For 2 servers: need 1 peer confirmation
  // For 3+ servers: need majority (ceil(N/2) - 1 peers)
  return totalServers === 2 ? 1 : Math.ceil(totalServers / 2) - 1;
}
```

**Examples:**
- 2 servers: quorum = 1 (self + 1 peer = 2 total)
- 3 servers: quorum = 2 (self + 2 peers = 3 total)
- 6 servers: quorum = 2 (self + 2 peers = 3 total, which is majority)

**2-Phase Commit Protocol:**

Phase 1: Prepare
```
Coordinator                Peer 1              Peer 2
    |                         |                   |
    |--- POST /prepare ------>|                   |
    |--- POST /prepare ----------------------->|
    |                         |                   |
    |<--- 200 OK -------------|                   |
    |<--- 200 OK ---------------------------|
    |                         |                   |
    | Check quorum (need 1/2) |                   |
    |                         |                   |
```

Phase 2: Commit (if quorum reached)
```
Coordinator                Peer 1              Peer 2
    |                         |                   |
    |--- POST /commit ------->|                   |
    |--- POST /commit ------------------------>|
    |                         |                   |
    |<--- 200 OK -------------|                   |
    |<--- 200 OK ---------------------------|
    |                         |                   |
```

Phase 2: Abort (if quorum not reached)
```
Coordinator                Peer 1              Peer 2
    |                         |                   |
    |--- POST /abort -------->|                   |
    |--- POST /abort ------------------------->|
    |                         |                   |
```

### 4. Replication Handler (`src/replication-handler.ts`)

Handles incoming replication requests from peer servers acting as coordinators.

**Responsibilities:**
- Receive and validate prepare requests
- Execute storage operations during prepare phase
- Track transactions in memory
- Confirm commit/abort requests
- Update transaction status

**Transaction Lifecycle:**
```
Prepare Request → Validate → Execute Operation → Store as "prepared"
                                                          ↓
Commit Request → Find Transaction → Mark "committed" → Respond
                                                          ↓
Abort Request → Find Transaction → Mark "aborted" → Respond
```

**Transaction Structure:**
```typescript
interface Transaction {
  transaction_id: string;      // UUID
  coordinator_id: string;       // Server ID of coordinator
  repo_id: string;             // e.g., "user/repo"
  ref: string;                 // Git ref (e.g., "refs/heads/main")
  commit: string;              // Commit hash or "initial"
  operation: string;           // e.g., "create"
  timestamp: string;           // ISO 8601
  status: 'prepared' | 'committed' | 'aborted';
}
```

### 5. Express Server (`src/server.ts`)

HTTP server that wires together all components and exposes REST API.

**Endpoints:**
- `GET /health` - Health check with load metrics
- `POST /repos` - Create repository with replication
- `GET /repos/:user/:repo` - Get repository info
- `GET /repos` - List all repositories
- `POST /replicate/prepare` - Replication prepare phase
- `POST /replicate/commit` - Replication commit phase
- `POST /replicate/abort` - Replication abort phase

**Initialization:**
```typescript
const storage = new RepoStorage(DATA_DIR);
const replicationHandler = new ReplicationHandler(SERVER_ID, storage);
const gitServer = new GitServer(DATA_DIR, SERVER_ID, PEER_URLS);

gitServer.initialize(); // Creates storage directory
```

## Data Flow: Repository Creation

### Step-by-Step Flow

```
Client                  Server 1 (Coordinator)           Server 2 (Peer)
  |                             |                              |
  |-- POST /repos ------------->|                              |
  |    {repo_id: "user/repo"}   |                              |
  |                             |                              |
  |                             | 1. Check if exists locally   |
  |                             | 2. Create bare Git repo      |
  |                             |                              |
  |                             | 3. Generate transaction ID   |
  |                             |                              |
  |                             |--- POST /replicate/prepare ->|
  |                             |    {transaction_id,          |
  |                             |     repo_id,                 |
  |                             |     operation: "create"}     |
  |                             |                              |
  |                             |                              | 4. Validate request
  |                             |                              | 5. Create repo
  |                             |                              | 6. Store transaction
  |                             |                              |
  |                             |<-- 200 OK -------------------|
  |                             |    {status: "prepared"}      |
  |                             |                              |
  |                             | 7. Check quorum (1/2 needed) |
  |                             | 8. Quorum reached!           |
  |                             |                              |
  |                             |--- POST /replicate/commit -->|
  |                             |    {transaction_id}          |
  |                             |                              |
  |                             |                              | 9. Mark committed
  |                             |                              |
  |                             |<-- 200 OK -------------------|
  |                             |                              |
  |<-- 201 Created -------------|                              |
  |    {repo_id,                |                              |
  |     created: true,          |                              |
  |     replicated: true,       |                              |
  |     peers_confirmed: 1}     |                              |
```

### Failure Scenario: Quorum Not Reached

```
Client                  Server 1 (Coordinator)           Server 2 (Peer - Down)
  |                             |                              |
  |-- POST /repos ------------->|                              |
  |                             |                              |
  |                             | 1. Create repo locally       |
  |                             |                              |
  |                             |--- POST /replicate/prepare ->| (timeout)
  |                             |                              |
  |                             | 2. Prepare failed            |
  |                             | 3. Check quorum: 0/1 needed  |
  |                             | 4. Quorum NOT reached        |
  |                             |                              |
  |<-- 500 Error ---------------|                              |
  |    {error: "Replication     |                              |
  |     failed"}                |                              |
```

## Testing Strategy

### Unit Tests

Each component has isolated unit tests:

1. **Storage Tests** (`storage.test.ts`): 8 tests
   - Directory initialization
   - Repository creation
   - Duplicate detection
   - Existence checks
   - Listing repositories

2. **Replication Coordinator Tests** (`replication.test.ts`): 6 tests
   - Quorum calculation for different cluster sizes
   - 2-phase commit success flow
   - 2-phase commit failure handling
   - Prepare phase timeout handling

3. **Replication Handler Tests** (`replication-handler.test.ts`): 5 tests
   - Prepare request validation
   - Commit request handling
   - Abort request handling
   - Transaction storage and retrieval

4. **Health Check Tests** (`health.test.ts`): 2 tests
   - Basic health endpoint response
   - Load metrics validation

### Integration Tests

While not in separate files, the tests exercise full integration:
- Server startup and shutdown
- HTTP request/response flow
- Component interaction (server → git-server → storage/replication)

### Test Helpers (`test-helpers.ts`)

- `waitForServer()`: Polls server until ready (max 5 seconds)
- `stopServer()`: Gracefully shuts down Express server

### Running Tests

```bash
# All tests
npm test

# Specific test file
npm test storage.test.ts

# Watch mode
npm run test:watch
```

## Scalability Considerations

### Current MVP Limitations

1. **In-Memory Transactions**: Transaction log not persisted to disk
2. **No Distributed Locks**: Race conditions possible with concurrent writes
3. **Synchronous Blocking**: Client waits for all replication before response
4. **No Retry Logic**: Network failures abort immediately
5. **Single-Threaded**: Node.js event loop handles all requests

### Scaling to Production

**Horizontal Scaling (6+ servers):**
- Quorum formula already supports N servers
- Add load balancer with health-based routing
- Implement distributed consensus (Raft/Paxos)

**Performance Optimizations:**
- Async replication for read-heavy workloads
- Write-ahead log (WAL) for durability
- Connection pooling for peer requests
- Request batching for bulk operations

**Consistency Improvements:**
- Distributed lock service (etcd/Consul)
- Transaction log persistence (PostgreSQL/RocksDB)
- Catch-up sync for recovered servers
- Conflict resolution for split-brain scenarios

## Security Considerations

### MVP (Not Implemented)

The following are **NOT** implemented in this MVP:

- **Authentication**: No user login or API keys
- **Authorization**: No access control or permissions
- **Encryption**: No TLS/SSL for peer communication
- **Input Validation**: Minimal validation on repo_id format
- **Rate Limiting**: No protection against abuse
- **Audit Logging**: No record of who did what

### Production Requirements

1. **Authentication**:
   - OAuth 2.0 / JWT tokens
   - API key management
   - Service-to-service auth for peer communication

2. **Authorization**:
   - Role-based access control (RBAC)
   - Repository-level permissions
   - Organization/team management

3. **Encryption**:
   - TLS 1.3 for all HTTP traffic
   - Certificate pinning for peer connections
   - Encryption at rest for Git objects

4. **Input Validation**:
   - Strict repo_id format enforcement
   - Path traversal prevention
   - Request size limits

5. **Audit Logging**:
   - All write operations logged
   - User attribution
   - Compliance reporting (SOC2, GDPR)

## Monitoring Metrics

### Current Health Metrics

The `/health` endpoint exposes:
- **CPU Usage**: Percentage of total CPU cycles used
- **Memory Usage**: Percentage of total RAM used
- **Peer Count**: Number of configured peer servers
- **Timestamp**: Current server time

### Production Metrics (Recommended)

**Performance:**
- Request latency (p50, p95, p99)
- Throughput (requests/sec)
- Error rate (4xx, 5xx)

**Replication:**
- Prepare phase success rate
- Commit phase success rate
- Quorum achievement rate
- Replication lag (time difference between servers)

**Storage:**
- Disk usage per repository
- Total repository count
- Average repository size
- I/O operations per second

**System:**
- Network throughput (bytes/sec)
- TCP connection count
- Open file descriptors
- Go routines / Node.js event loop lag

**Alerting:**
- Peer server down > 1 minute
- Quorum not achievable
- Disk usage > 85%
- Error rate > 5%

### Monitoring Stack (Recommended)

- **Metrics Collection**: Prometheus
- **Visualization**: Grafana dashboards
- **Alerting**: Alertmanager
- **Distributed Tracing**: Jaeger / Zipkin
- **Log Aggregation**: ELK stack (Elasticsearch, Logstash, Kibana)

## Future Enhancements

### Phase 2: Git Operations

Implement actual Git protocol support:
- HTTP Smart Protocol (git clone, git push, git pull)
- SSH Protocol support
- Git LFS (Large File Storage)
- Shallow clones and partial clones

**Implementation:**
- Use `git-http-backend` or Node.js equivalent
- Add authentication middleware
- Stream large pack files efficiently

### Phase 3: Advanced Replication

**Asynchronous Replication:**
- Write to local storage immediately
- Replicate to peers in background
- Eventual consistency with conflict resolution

**Multi-Region Support:**
- Primary region + read replicas
- Cross-datacenter replication
- Geographic routing based on client location

**Conflict Resolution:**
- Last-write-wins (LWW) with timestamps
- Vector clocks for causality tracking
- Manual merge for complex conflicts

### Phase 4: High Availability

**Leader Election:**
- Use Raft consensus algorithm
- Automatic failover on leader failure
- Split-brain prevention

**Catch-Up Sync:**
- Detect missing transactions on server recovery
- Bulk sync from peers
- Delta transfer optimization

**Circuit Breaker:**
- Detect unhealthy peers
- Temporarily exclude from quorum
- Automatic re-inclusion when healthy

### Phase 5: Performance

**Caching:**
- Redis cache for repository metadata
- CDN for popular repositories
- Client-side caching with ETags

**Sharding:**
- Partition repositories across servers by hash
- Consistent hashing for rebalancing
- Cross-shard queries via coordinator

**Compression:**
- Git pack file optimization
- Network compression (gzip/brotli)
- Delta encoding for updates

### Phase 6: Observability

**Distributed Tracing:**
- Trace requests across all servers
- Visualize 2-phase commit flow
- Identify performance bottlenecks

**Structured Logging:**
- JSON log format
- Correlation IDs for request tracking
- Log levels (debug, info, warn, error)

**Service Mesh:**
- Istio or Linkerd
- Traffic management and routing
- mTLS between services

## Development Workflow

### Local Development

1. Install dependencies: `npm install`
2. Run tests: `npm test`
3. Start server 1: `PORT=3001 SERVER_ID=server-1 DATA_DIR=./data-server1 PEER_URLS=http://localhost:3002 npm run dev`
4. Start server 2: `PORT=3002 SERVER_ID=server-2 DATA_DIR=./data-server2 PEER_URLS=http://localhost:3001 npm run dev`

### Testing Replication

```bash
# Create repo on server 1
curl -X POST http://localhost:3001/repos \
  -H "Content-Type: application/json" \
  -d '{"repo_id": "alice/project"}'

# Verify on server 2
curl http://localhost:3002/repos/alice/project

# Expected: {"repo_id":"alice/project","exists":true,"path":"..."}
```

### Debugging

**View server logs:**
```bash
# Server 1 terminal shows:
# - Incoming requests
# - Replication prepare/commit calls
# - Quorum calculations

# Server 2 terminal shows:
# - Replication requests received
# - Repository creation
# - Transaction status updates
```

**Inspect storage:**
```bash
ls -la data-server1/
# Shows directory structure with all repositories

ls -la data-server1/alice/project.git/
# Shows bare Git repository structure
```

## Conclusion

This MVP demonstrates the core concepts of synchronous replication using 2-phase commit. While not production-ready, it provides a solid foundation for understanding distributed Git storage systems.

Key takeaways:
- 2-phase commit ensures consistency across servers
- Quorum-based writes provide fault tolerance
- Synchronous replication trades performance for consistency
- Proper component separation enables testing and maintainability

Next steps involve adding actual Git operations, distributed locking, authentication, and operational monitoring to evolve this into a production-grade system capable of handling 100 million repositories.
