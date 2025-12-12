import fs from 'fs/promises';
import path from 'path';
import git from 'isomorphic-git';

export class RepoStorage {
  private dataDir: string;

  constructor(dataDir: string = './data') {
    this.dataDir = dataDir;
  }

  async initialize(): Promise<void> {
    await fs.mkdir(this.dataDir, { recursive: true });
  }

  async repoExists(repoId: string): Promise<boolean> {
    const repoPath = this.getRepoPath(repoId);
    try {
      await fs.access(repoPath);
      return true;
    } catch {
      return false;
    }
  }

  async createRepo(repoId: string): Promise<void> {
    if (await this.repoExists(repoId)) {
      throw new Error('Repository already exists');
    }

    const repoPath = this.getRepoPath(repoId);
    await fs.mkdir(path.dirname(repoPath), { recursive: true });

    // Initialize bare Git repository
    await git.init({
      fs,
      dir: repoPath,
      bare: true,
      defaultBranch: 'main'
    });
  }

  getRepoPath(repoId: string): string {
    // Convert "user/repo" to "data/user/repo.git"
    return path.join(this.dataDir, `${repoId}.git`);
  }

  async listRepos(): Promise<string[]> {
    const repos: string[] = [];

    try {
      await this.scanDirectory(this.dataDir, '', repos);
    } catch (error) {
      // Directory might not exist yet
      return [];
    }

    return repos;
  }

  private async scanDirectory(dir: string, prefix: string, repos: string[]): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (entry.name.endsWith('.git')) {
          // Found a repo
          const repoName = entry.name.slice(0, -4); // Remove .git
          const repoId = prefix ? `${prefix}/${repoName}` : repoName;
          repos.push(repoId);
        } else {
          // Recurse into subdirectory
          const newPrefix = prefix ? `${prefix}/${entry.name}` : entry.name;
          await this.scanDirectory(path.join(dir, entry.name), newPrefix, repos);
        }
      }
    }
  }
}
