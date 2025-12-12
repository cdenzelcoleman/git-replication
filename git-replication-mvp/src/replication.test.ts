import axios from 'axios';
import { ReplicationCoordinator, ReplicationResult } from './replication';

// Mock axios
jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('ReplicationCoordinator', () => {
  let coordinator: ReplicationCoordinator;
  const serverId = 'server-1';
  const peerUrls = ['http://localhost:3001', 'http://localhost:3002'];

  beforeEach(() => {
    coordinator = new ReplicationCoordinator(serverId, peerUrls);
    jest.clearAllMocks();
  });

  describe('replicateWrite', () => {
    it('should successfully replicate to all peers', async () => {
      const writeData = {
        repo_id: 'user/repo',
        ref: 'refs/heads/main',
        commit: 'abc123'
      };

      // Mock successful responses from all peers
      mockedAxios.post.mockResolvedValue({
        status: 200,
        data: { status: 'prepared' }
      });

      const result = await coordinator.replicateWrite(writeData);

      expect(result.success).toBe(true);
      expect(result.peersConfirmed).toBe(2);
      expect(result.peersRequired).toBe(1); // Quorum for 3 servers is 2 (self + 1)
      expect(mockedAxios.post).toHaveBeenCalledTimes(4); // 2 prepare + 2 commit
    });

    it('should succeed with quorum (1 peer down, 1 peer up)', async () => {
      const writeData = {
        repo_id: 'user/repo',
        ref: 'refs/heads/main',
        commit: 'abc123'
      };

      // First peer succeeds, second peer fails
      mockedAxios.post
        .mockResolvedValueOnce({ status: 200, data: { status: 'prepared' } })
        .mockRejectedValueOnce(new Error('Connection refused'));

      const result = await coordinator.replicateWrite(writeData);

      expect(result.success).toBe(true);
      expect(result.peersConfirmed).toBe(1);
      expect(result.peersRequired).toBe(1); // Minimum quorum
    });

    it('should fail when quorum not reached (both peers down)', async () => {
      const writeData = {
        repo_id: 'user/repo',
        ref: 'refs/heads/main',
        commit: 'abc123'
      };

      // Both peers fail
      mockedAxios.post.mockRejectedValue(new Error('Connection refused'));

      const result = await coordinator.replicateWrite(writeData);

      expect(result.success).toBe(false);
      expect(result.peersConfirmed).toBe(0);
      expect(result.error).toContain('Quorum not reached');
    });

    it('should use 2-phase commit protocol', async () => {
      const writeData = {
        repo_id: 'user/repo',
        ref: 'refs/heads/main',
        commit: 'abc123'
      };

      mockedAxios.post.mockResolvedValue({
        status: 200,
        data: { status: 'prepared' }
      });

      await coordinator.replicateWrite(writeData);

      // Verify prepare phase
      expect(mockedAxios.post).toHaveBeenCalledWith(
        'http://localhost:3001/replicate/prepare',
        expect.objectContaining(writeData),
        expect.any(Object)
      );

      // Verify commit phase
      expect(mockedAxios.post).toHaveBeenCalledWith(
        'http://localhost:3001/replicate/commit',
        expect.objectContaining({ transaction_id: expect.any(String) }),
        expect.any(Object)
      );
    });
  });

  describe('getQuorumSize', () => {
    it('should require at least 1 peer for 2 peers total', () => {
      const quorum = coordinator.getQuorumSize();
      expect(quorum).toBe(1); // 2 peers, need 1 (self + 1 peer = quorum)
    });

    it('should require at least 2 peers for 5 peers total', () => {
      const largePeerList = [
        'http://localhost:3001',
        'http://localhost:3002',
        'http://localhost:3003',
        'http://localhost:3004',
        'http://localhost:3005'
      ];
      const largeCoordinator = new ReplicationCoordinator('server-1', largePeerList);
      const quorum = largeCoordinator.getQuorumSize();
      expect(quorum).toBe(2); // 5 peers, need 2 (self + 2 peers = quorum of 3/6)
    });
  });
});
