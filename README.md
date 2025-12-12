# Git Replication System

Distributed Git hosting platform with synchronous replication across multiple servers.

## Documentation

- **[Implementation Plan](docs/plans/2025-12-11-git-replication-mvp.md)** - Step-by-step MVP implementation guide
- **[System Design](docs/plans/2025-12-11-github-storage-system-design.md)** - Complete architecture for 100M repositories

## Status

🚧 **In Development** - MVP implementation in progress

## Quick Start

To execute the implementation plan:

1. Open this repository in Claude Code
2. Run: `Execute the plan at docs/plans/2025-12-11-git-replication-mvp.md`
3. Claude will use the executing-plans skill to build the MVP

## Project Goals

Build a minimal viable prototype demonstrating:
- ✅ 2-server synchronous replication
- ✅ 2-phase commit protocol
- ✅ Quorum-based writes
- ✅ Health monitoring
- ✅ Repository storage and management

## License

MIT
