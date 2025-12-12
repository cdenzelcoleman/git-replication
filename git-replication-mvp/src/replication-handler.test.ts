import axios from 'axios';
import { stopServer, waitForServer } from './test-helpers';

describe('Replication Endpoints', () => {
  const serverUrl = 'http://localhost:3000';

  beforeAll(async () => {
    process.env.SERVER_ID = 'test-server';
    require('./server');
    await waitForServer(1000);
  });

  afterAll(async () => {
    await stopServer();
  });

  describe('POST /replicate/prepare', () => {
    it('should accept prepare request and store transaction', async () => {
      const prepareData = {
        transaction_id: 'txn-123',
        coordinator_id: 'server-1',
        repo_id: 'user/repo',
        ref: 'refs/heads/main',
        commit: 'abc123'
      };

      const response = await axios.post(`${serverUrl}/replicate/prepare`, prepareData);

      expect(response.status).toBe(200);
      expect(response.data).toEqual({
        status: 'prepared',
        transaction_id: 'txn-123',
        server_id: expect.any(String)
      });
    });

    it('should reject prepare request with missing transaction_id', async () => {
      const invalidData = {
        coordinator_id: 'server-1',
        repo_id: 'user/repo'
      };

      await expect(
        axios.post(`${serverUrl}/replicate/prepare`, invalidData)
      ).rejects.toMatchObject({
        response: { status: 400 }
      });
    });
  });

  describe('POST /replicate/commit', () => {
    it('should commit previously prepared transaction', async () => {
      // First prepare
      const prepareData = {
        transaction_id: 'txn-456',
        coordinator_id: 'server-1',
        repo_id: 'user/repo',
        ref: 'refs/heads/main',
        commit: 'def456'
      };
      await axios.post(`${serverUrl}/replicate/prepare`, prepareData);

      // Then commit
      const commitData = {
        transaction_id: 'txn-456',
        coordinator_id: 'server-1'
      };

      const response = await axios.post(`${serverUrl}/replicate/commit`, commitData);

      expect(response.status).toBe(200);
      expect(response.data).toEqual({
        status: 'committed',
        transaction_id: 'txn-456',
        server_id: expect.any(String)
      });
    });

    it('should reject commit for non-existent transaction', async () => {
      const commitData = {
        transaction_id: 'txn-nonexistent',
        coordinator_id: 'server-1'
      };

      await expect(
        axios.post(`${serverUrl}/replicate/commit`, commitData)
      ).rejects.toMatchObject({
        response: { status: 404 }
      });
    });
  });

  describe('POST /replicate/abort', () => {
    it('should abort prepared transaction', async () => {
      // First prepare
      const prepareData = {
        transaction_id: 'txn-789',
        coordinator_id: 'server-1',
        repo_id: 'user/repo',
        ref: 'refs/heads/main',
        commit: 'ghi789'
      };
      await axios.post(`${serverUrl}/replicate/prepare`, prepareData);

      // Then abort
      const abortData = {
        transaction_id: 'txn-789',
        coordinator_id: 'server-1'
      };

      const response = await axios.post(`${serverUrl}/replicate/abort`, abortData);

      expect(response.status).toBe(200);
      expect(response.data).toEqual({
        status: 'aborted',
        transaction_id: 'txn-789',
        server_id: expect.any(String)
      });
    });
  });
});
