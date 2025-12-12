# GitHub Storage System Design
**Date:** 2025-12-11
**Scale:** 100 million repositories
**Architecture:** High-availability with synchronous replication

---

## Overview

A distributed Git hosting platform designed to manage 100 million repositories with full Git operations (clone, push, pull, fork). The system prioritizes data durability and availability through 6-way synchronous replication across independent servers.

---

## High-Level Architecture

### Three-Layer Design

**1. Load Balancer Layer**
- Health-checks all 6 Git servers (3 primary + 3 backup)
- Routes requests to the strongest available server based on CPU, memory, network, and health status
- Uses weighted round-robin or least-connections algorithm
- Maintains connection draining for graceful failover

**2. Git Application Layer (6 servers)**
- Each server runs Git server software (GitLab, Gitea, or custom Git HTTP/SSH server)
- Handles Git protocol operations (clone, fetch, push)
- Manages authentication and authorization
- Coordinates synchronous replication to peer servers
- Each primary server paired with a hot standby backup

**3. Storage Layer**
- Each server has dedicated object storage (MinIO, Ceph, or S3-compatible)
- Stores Git bare repositories as objects
- 5PB capacity per server minimum (100M repos × 50MB average)
- Each server's storage is independent
- Total system storage: 30PB across 6 servers

---

## Replication Protocol

### Synchronous 6-Way Replication

**Write Path (Git Push):**

1. Developer pushes to any available server via load balancer
2. Receiving server becomes the **coordinator** for that write
3. Coordinator validates the push (authentication, conflicts, pre-receive hooks)
4. Coordinator initiates 2-phase commit:
   - **Phase 1 (Prepare):** Send Git objects to all 5 peer servers, wait for acknowledgments
   - **Phase 2 (Commit):** Once quorum reached, coordinator commits locally and tells peers to commit
5. Coordinator responds success to developer only after quorum commits

**Quorum Rules:**
- **Optimal:** All 6 servers confirm (strongest durability)
- **Degraded:** 5/6 or 4/6 servers confirm (acceptable, allows 1-2 failures)
- **Failure:** < 4 servers available → reject write and return error to developer

**Conflict Prevention:**
- Distributed lock service (etcd, Consul, or ZooKeeper) ensures only one push to a repo happens at a time
- Lock spans all 6 servers to prevent split-brain scenarios
- Lock timeout: 60 seconds per push operation

**Consistency Guarantees:**
- Strong consistency for reads (all servers have identical data)
- No stale reads possible due to synchronous replication
- Linearizable writes through distributed locking

---

## Read Path & Failover

### Read Operations (Git Clone/Fetch)

1. Load balancer routes to strongest available server
2. Server reads directly from its local object storage (no coordination needed)
3. Strong consistency guaranteed - all servers have identical data
4. Read performance scales linearly - can serve from any of the 6 servers
5. Typical read latency: < 100ms for metadata, streaming for large clones

### Failover Mechanism

**Primary Server Failure:**
- Load balancer detects failure via health checks (TCP probe + HTTP `/health` endpoint every 3 seconds)
- Immediately stops routing to failed primary
- Hot standby backup automatically promoted (already has all data)
- Backup takes over primary's role in load balancer pool
- No data loss since backup has all committed writes
- Failover time: < 10 seconds

**Backup Server Failure:**
- Primary continues serving traffic unaffected
- Failed backup marked for recovery
- Once restored, catches up from its primary via delta sync
- No impact to user-facing operations

**Multiple Failures:**
- System remains available if ≥4 servers operational
- Writes rejected if <4 servers available (safety threshold to prevent data divergence)
- Load balancer continues serving reads from remaining servers

**Split-Brain Prevention:**
- Distributed lock service provides cluster membership
- Minimum quorum of 4/6 servers required for writes
- Network partitions result in write failures rather than data inconsistency

---

## Recovery & Catch-Up

### When a Server Comes Back Online

**1. Delta Sync Process:**
- Failed server queries operational servers for latest commit log
- Identifies missing transactions since it went down (using transaction ID watermarks)
- Streams missing Git objects from healthy peer server
- Replays transactions in order to catch up
- Typical catch-up: 1-10 minutes depending on downtime

**2. Read-Only Mode During Catch-Up:**
- Recovering server can serve reads from its (slightly stale) data
- Marked as "catching up" - excluded from write quorum
- Rejoins write quorum once fully synchronized
- Health check endpoint returns "degraded" status

**3. Bootstrap New Server:**
- For completely new servers or catastrophic failures
- Full sync from existing healthy server
- Copy entire object storage dataset (5PB per server)
- Use distributed copy tools (rsync, rclone) or object storage replication
- Estimated bootstrap time: 24-48 hours for 5PB over 10Gbps network

---

## Authentication & User Management

### Database Architecture

**PostgreSQL (Neon) - Primary Auth Database:**

Recommended for user management due to:
- Strong ACID guarantees for auth data
- Better support for relational queries (user → repos, permissions)
- Mature authentication libraries
- Row-level security for multi-tenancy

**Schema:**
```sql
-- Users
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  username VARCHAR(255) UNIQUE NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- SSH Keys
CREATE TABLE ssh_keys (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  public_key TEXT NOT NULL,
  fingerprint VARCHAR(255) UNIQUE NOT NULL,
  name VARCHAR(255),
  created_at TIMESTAMP DEFAULT NOW()
);

-- Access Tokens
CREATE TABLE access_tokens (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  token_hash VARCHAR(255) UNIQUE NOT NULL,
  scopes TEXT[], -- ['repo:read', 'repo:write', 'admin']
  expires_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Repositories
CREATE TABLE repositories (
  id SERIAL PRIMARY KEY,
  repo_id VARCHAR(255) UNIQUE NOT NULL, -- e.g., "user/repo-name"
  owner_id INTEGER REFERENCES users(id),
  name VARCHAR(255) NOT NULL,
  visibility VARCHAR(50) DEFAULT 'private', -- 'public', 'private', 'internal'
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Repository Collaborators
CREATE TABLE repo_collaborators (
  repo_id INTEGER REFERENCES repositories(id),
  user_id INTEGER REFERENCES users(id),
  permission VARCHAR(50) NOT NULL, -- 'read', 'write', 'admin'
  PRIMARY KEY (repo_id, user_id)
);
```

**MongoDB - Analytics & Audit Logs:**

Use cases:
- Git operation logs (who pushed/pulled what, when)
- Audit trails for compliance
- Usage metrics and statistics (repo size over time, popular repos)
- Real-time activity feeds

**Collections:**
```javascript
// git_operations
{
  _id: ObjectId,
  user_id: 12345,
  repo_id: "user/repo",
  operation: "push", // push, pull, clone, fork
  timestamp: ISODate("2025-12-11T10:30:00Z"),
  server_id: "server-1",
  bytes_transferred: 5242880,
  duration_ms: 1523,
  ip_address: "192.168.1.100"
}

// audit_trail
{
  _id: ObjectId,
  user_id: 12345,
  action: "repo.delete",
  resource: "user/old-repo",
  timestamp: ISODate("2025-12-11T10:30:00Z"),
  metadata: {
    reason: "user requested",
    admin_approved: true
  }
}
```

### Authentication System Components

**1. Web Authentication Pages:**
- `/login` - Username/password login
- `/register` - New user registration
- `/settings/ssh-keys` - SSH key management
- `/settings/tokens` - Personal access token generation
- `/logout` - Session termination

**2. Authentication Methods:**

**Git HTTPS:**
- Basic authentication: `https://username:token@git.example.com/user/repo.git`
- Personal access tokens (recommended over passwords)
- Token scopes limit permissions

**Git SSH:**
- Public key authentication
- SSH keys stored in PostgreSQL, matched against `authorized_keys` or via custom SSH server
- Format: `git@git.example.com:user/repo.git`

**Web UI:**
- Session-based authentication with secure HTTP-only cookies
- JWT tokens for API access
- 2FA support (TOTP-based)

**3. Authorization Model:**
- Repository-level permissions: read, write, admin
- Organization/team support (future extension)
- Public repos accessible without authentication
- Private repos require authentication + authorization check

**4. Auth Flow Example (Git Push over HTTPS):**
1. User runs: `git push https://git.example.com/user/repo.git`
2. Git client sends credentials (username + token)
3. Git server validates token against PostgreSQL `access_tokens` table
4. Check user has write permission on repo in `repo_collaborators` table
5. If authorized, proceed with push and replication
6. Log operation to MongoDB `git_operations` collection

---

## Technology Stack

### Git Application Layer
- **Gitea** (recommended) or **GitLab CE** (feature-rich) or **Gogs** (lightweight)
- Alternatively: Custom solution using **libgit2** + Go/Rust for maximum control
- Protocols: SSH (port 22) + HTTPS (port 443)
- Language: Go (Gitea/Gogs) or Ruby (GitLab)

### Object Storage
- **MinIO** (S3-compatible, self-hosted, high performance)
- Each of 6 servers runs its own MinIO instance
- Git repos stored as objects in buckets
- Bucket structure: `/repos/{user}/{repo}.git/`
- Alternative: **Ceph** for larger enterprise deployments

### Distributed Coordination
- **etcd** (recommended - used by Kubernetes, battle-tested)
- Or **Consul** (service mesh integration)
- Or **ZooKeeper** (mature, widely adopted)
- Purpose: Distributed locks, cluster membership, configuration
- 3 or 5 node cluster for etcd (separate from Git servers)

### Load Balancer
- **HAProxy** (high performance, advanced health checks)
- Or **NGINX Plus** (simpler config, HTTP/2 support)
- Health check configuration:
  - Active checks every 3 seconds
  - `/health` endpoint on each Git server
  - Checks: HTTP 200, response time < 500ms, server load < 80%
- SSL/TLS termination at load balancer
- Rate limiting and DDoS protection

### Databases
- **PostgreSQL (Neon)** - User authentication, repo metadata, permissions
  - Hosted on Neon for managed backups and scaling
  - Connection pooling via PgBouncer
  - Read replicas for scaling read-heavy queries
- **MongoDB** - Logs, analytics, audit trails
  - Self-hosted or MongoDB Atlas
  - TTL indexes for automatic log rotation
  - Aggregation pipelines for analytics

### Replication Agent
- **Custom service in Go or Rust**
- Responsibilities:
  - Intercepts Git writes
  - Implements 2-phase commit protocol
  - Manages peer-to-peer replication
  - Handles catch-up sync
- Sits between Git server and MinIO storage
- Exposes metrics for monitoring (Prometheus format)

### Monitoring & Observability
- **Prometheus** - Metrics collection
- **Grafana** - Dashboards and visualization
- **Loki** or **ELK** - Log aggregation
- **Alertmanager** - Alerting and on-call

**Key Metrics:**
- Replication lag per server
- Write success/failure rate
- Quorum health (how many servers in quorum)
- Storage utilization per server
- Git operation latency (p50, p95, p99)
- Active connections per server

---

## Capacity Planning

### Storage Requirements
- **Per Server:** 5PB (100M repos × 50MB average)
- **Total System:** 30PB (5PB × 6 servers)
- **Growth Buffer:** Plan for 50% headroom = 45PB total provisioned
- **Object Storage Overhead:** MinIO erasure coding adds ~20% overhead

### Network Requirements
- **Bandwidth per Server:** 10 Gbps minimum, 40 Gbps recommended
- **Replication Bandwidth:** Each write replicated to 5 peers
  - Average push: 10MB → 50MB transferred per push
  - 100 concurrent pushes = 5 Gbps sustained
- **Inter-server Network:** Low latency (<1ms) preferred, same datacenter recommended

### Compute Requirements per Server
- **CPU:** 32-64 cores (handle concurrent Git operations + replication)
- **RAM:** 128-256 GB (caching frequently accessed repos)
- **Disk:** NVMe SSDs for MinIO metadata, HDD for object storage data

### Database Sizing
- **PostgreSQL:** 100M users × 1KB avg = 100GB, minimal compared to Git storage
- **MongoDB:** Audit logs grow over time, plan for 10TB+ with compression and TTL policies

---

## Deployment Topology

### Recommended Layout

**Datacenter Requirements:**
- Single datacenter deployment (minimizes replication latency)
- Separate racks for primary and backup servers
- Redundant network switches and power

**Server Placement:**
- Primary-1 + Backup-1 on separate racks
- Primary-2 + Backup-2 on separate racks
- Primary-3 + Backup-3 on separate racks
- Ensures rack-level failure tolerance

**Network Topology:**
- Load balancer on redundant pair (HAProxy + keepalived for HA)
- Dedicated replication network (VLAN) between Git servers
- Public-facing network for client access
- Management network for monitoring and operations

**Service Layout per Server:**
```
┌─────────────────────────────┐
│   Git Server (Gitea/GitLab) │
│   Port: 22 (SSH), 443 (HTTP)│
└──────────┬──────────────────┘
           │
┌──────────▼──────────────────┐
│   Replication Agent         │
│   Port: 9000 (internal)     │
└──────────┬──────────────────┘
           │
┌──────────▼──────────────────┐
│   MinIO Object Storage      │
│   Port: 9001 (S3 API)       │
│   5PB capacity              │
└─────────────────────────────┘
```

---

## Disaster Recovery

### Backup Strategy
- **PostgreSQL:** Daily backups to object storage (Neon handles this)
- **Git Repositories:** Already 6-way replicated, extremely durable
- **Offsite Backup:** Weekly snapshot of 1 complete server to remote datacenter
- **Recovery Time Objective (RTO):** < 10 seconds for single server failure
- **Recovery Point Objective (RPO):** 0 seconds (synchronous replication)

### Catastrophic Failure Scenarios

**Scenario 1: 3+ Servers Lost (Lost Quorum)**
- System enters read-only mode
- Cannot accept writes until quorum restored
- Restore failed servers from backups or bootstrap new servers
- Recovery time: Hours to days depending on server availability

**Scenario 2: Datacenter Failure**
- Requires multi-datacenter deployment (not in current design)
- Restore from offsite backup (weekly snapshot)
- Data loss: Up to 1 week (difference between disaster and last weekly backup)

**Scenario 3: Replication Bug/Corruption**
- Distributed lock prevents most corruption scenarios
- If detected, rollback affected repos to last known good state
- Audit logs in MongoDB help identify affected repos

---

## Security Considerations

### Network Security
- TLS 1.3 for all HTTPS traffic
- SSH key-based authentication (no password auth)
- Rate limiting on login endpoints (prevent brute force)
- DDoS protection at load balancer

### Access Control
- Principle of least privilege for repo access
- Personal access tokens with scoped permissions
- 2FA enforcement for admin accounts
- IP allowlisting for sensitive operations

### Data Security
- Encryption at rest for object storage (MinIO KMS integration)
- Encryption in transit (TLS for replication)
- Secrets management (HashiCorp Vault or cloud KMS)
- Regular security audits and penetration testing

### Compliance
- Audit logs in MongoDB for compliance reporting
- Data retention policies (GDPR, CCPA)
- User data deletion workflow (right to be forgotten)

---

## Operational Procedures

### Deployment Process
1. Deploy etcd cluster (3 nodes for quorum)
2. Deploy PostgreSQL (Neon) and MongoDB
3. Deploy 6 Git servers with MinIO storage
4. Configure replication agent on each server
5. Deploy load balancer with health checks
6. Test failover scenarios before production traffic
7. Gradually migrate repos from existing system

### Monitoring Runbook
- Alert if < 5 servers in quorum → Page on-call
- Alert if replication lag > 60 seconds → Investigate
- Alert if storage > 80% → Add capacity
- Weekly capacity planning review

### Maintenance Windows
- Rolling updates: Update 1 server at a time, wait for catch-up
- Zero-downtime deployment possible with proper planning
- Backup server updated first, then promote if successful

---

## Future Enhancements

### Phase 2 Features
- Multi-datacenter deployment for geo-distribution
- Async replication to remote datacenter (disaster recovery)
- CDN integration for popular repos (read optimization)
- Tiered storage (hot/warm/cold) based on access patterns

### Phase 3 Features
- Pull requests, issues, wikis (full GitHub feature parity)
- CI/CD integration (GitHub Actions equivalent)
- Container registry (store Docker images alongside code)
- Package registry (npm, Maven, PyPI hosting)

### Optimization Opportunities
- Deduplication across repos (many repos share common objects)
- Compression optimization (Git already compresses, but can tune)
- Read caching layer (Redis/Memcached for frequently accessed repos)
- Smart routing (route repo to server with cached copy)

---

## Cost Estimation

### Infrastructure Costs (Monthly)
- **Servers:** 6 × $2000/month (bare metal with 5PB storage) = $12,000
- **Network:** 10 Gbps bandwidth × 6 servers = $3,000
- **Load Balancer:** 2 × $500/month (HA pair) = $1,000
- **PostgreSQL (Neon):** $500/month (managed, with replicas)
- **MongoDB:** $1,000/month (Atlas or self-hosted)
- **etcd Cluster:** 3 × $100/month = $300
- **Monitoring:** $500/month (Grafana Cloud, Datadog, or similar)
- **Total:** ~$18,300/month

### Scaling Costs
- Linear scaling with repo count
- 200M repos = 2x storage = ~$30,000/month
- Economies of scale with larger deployments

---

## Success Metrics

### Performance
- Git clone: < 5 seconds for 50MB repo
- Git push: < 10 seconds for 10MB push
- Replication lag: < 1 second across all servers
- Uptime: 99.95% availability (4 hours downtime/year)

### Scalability
- Support 100M repos initially
- Scale to 500M repos with minimal architectural changes
- Handle 10,000 concurrent users
- 1 million Git operations per day

### Reliability
- 0 data loss (synchronous replication)
- < 10 second failover time
- RPO: 0 seconds
- RTO: < 10 seconds for single failure

---

## Conclusion

This design provides a robust, highly available Git hosting platform capable of managing 100 million repositories. The 6-way synchronous replication ensures maximum data durability, while the hot standby architecture provides rapid failover. The system prioritizes consistency and reliability over write performance, making it suitable for environments where data loss is unacceptable.

Key strengths:
- ✅ Zero data loss through synchronous replication
- ✅ Strong consistency across all servers
- ✅ Rapid failover (< 10 seconds)
- ✅ Linear read scalability
- ✅ Simple operational model

Trade-offs:
- ⚠️ Higher write latency due to 6-way sync
- ⚠️ Storage costs (6x replication factor)
- ⚠️ Single datacenter deployment (no geo-distribution in v1)

This architecture serves as a solid foundation. Future phases can add multi-datacenter support, read optimization, and full GitHub-like features on top of this reliable core.
