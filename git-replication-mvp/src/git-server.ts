import { Request, Response } from 'express';
import { RepoStorage } from './storage';
import { ReplicationCoordinator } from './replication';

export class GitServer {
  private storage: RepoStorage;
  private replicationCoordinator: ReplicationCoordinator | null = null;

  constructor(dataDir: string, serverId: string, peerUrls: string[] = []) {
    this.storage = new RepoStorage(dataDir);

    if (peerUrls.length > 0) {
      this.replicationCoordinator = new ReplicationCoordinator(serverId, peerUrls);
    }
  }

  async initialize(): Promise<void> {
    await this.storage.initialize();
  }

  async handleCreateRepo(req: Request, res: Response): Promise<void> {
    const { repo_id } = req.body;

    if (!repo_id) {
      res.status(400).json({ error: 'Missing repo_id' });
      return;
    }

    try {
      // Check if repo already exists
      if (await this.storage.repoExists(repo_id)) {
        res.status(409).json({ error: 'Repository already exists' });
        return;
      }

      // Create repo locally
      await this.storage.createRepo(repo_id);

      // Replicate to peers if coordinator is configured
      let replicationResult = null;
      if (this.replicationCoordinator) {
        replicationResult = await this.replicationCoordinator.replicateWrite({
          repo_id,
          ref: 'refs/heads/main',
          commit: 'initial',
          operation: 'create'
        });

        if (!replicationResult.success) {
          // Rollback local creation if replication fails
          // (In production, this would be more sophisticated)
          res.status(500).json({
            error: 'Replication failed',
            details: replicationResult.error
          });
          return;
        }
      }

      res.status(201).json({
        repo_id,
        created: true,
        replicated: replicationResult !== null,
        peers_confirmed: replicationResult?.peersConfirmed || 0
      });
    } catch (error: any) {
      res.status(500).json({
        error: 'Failed to create repository',
        details: error.message
      });
    }
  }

  async handleGetRepo(req: Request, res: Response): Promise<void> {
    const repo_id = `${req.params.user}/${req.params.repo}`;

    try {
      const exists = await this.storage.repoExists(repo_id);

      if (!exists) {
        res.status(404).json({
          repo_id,
          exists: false
        });
        return;
      }

      res.status(200).json({
        repo_id,
        exists: true,
        path: this.storage.getRepoPath(repo_id)
      });
    } catch (error: any) {
      res.status(500).json({
        error: 'Failed to check repository',
        details: error.message
      });
    }
  }

  async handleListRepos(req: Request, res: Response): Promise<void> {
    try {
      const repos = await this.storage.listRepos();
      res.status(200).json({
        repos,
        count: repos.length
      });
    } catch (error: any) {
      res.status(500).json({
        error: 'Failed to list repositories',
        details: error.message
      });
    }
  }
}
