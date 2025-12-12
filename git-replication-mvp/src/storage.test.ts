import fs from 'fs/promises';
import path from 'path';
import { RepoStorage } from './storage';

describe('RepoStorage', () => {
  let storage: RepoStorage;
  const testDataDir = './test-data';

  beforeEach(async () => {
    storage = new RepoStorage(testDataDir);
    await storage.initialize();
  });

  afterEach(async () => {
    // Clean up test data
    await fs.rm(testDataDir, { recursive: true, force: true });
  });

  describe('initialize', () => {
    it('should create data directory if not exists', async () => {
      const exists = await fs.access(testDataDir)
        .then(() => true)
        .catch(() => false);

      expect(exists).toBe(true);
    });
  });

  describe('repoExists', () => {
    it('should return false for non-existent repo', async () => {
      const exists = await storage.repoExists('user/repo');
      expect(exists).toBe(false);
    });

    it('should return true for existing repo', async () => {
      await storage.createRepo('user/repo');
      const exists = await storage.repoExists('user/repo');
      expect(exists).toBe(true);
    });
  });

  describe('createRepo', () => {
    it('should create a bare git repository', async () => {
      await storage.createRepo('user/test-repo');

      const repoPath = path.join(testDataDir, 'user', 'test-repo.git');
      const gitDirExists = await fs.access(repoPath)
        .then(() => true)
        .catch(() => false);

      expect(gitDirExists).toBe(true);
    });

    it('should throw error if repo already exists', async () => {
      await storage.createRepo('user/repo');

      await expect(storage.createRepo('user/repo'))
        .rejects.toThrow('Repository already exists');
    });
  });

  describe('getRepoPath', () => {
    it('should return correct path for repo', () => {
      const repoPath = storage.getRepoPath('user/test-repo');
      expect(repoPath).toBe(path.join(testDataDir, 'user', 'test-repo.git'));
    });
  });

  describe('listRepos', () => {
    it('should return empty array when no repos exist', async () => {
      const repos = await storage.listRepos();
      expect(repos).toEqual([]);
    });

    it('should list all repositories', async () => {
      await storage.createRepo('user1/repo1');
      await storage.createRepo('user1/repo2');
      await storage.createRepo('user2/repo1');

      const repos = await storage.listRepos();
      expect(repos).toHaveLength(3);
      expect(repos).toContain('user1/repo1');
      expect(repos).toContain('user1/repo2');
      expect(repos).toContain('user2/repo1');
    });
  });
});
