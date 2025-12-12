import axios from 'axios';
import { stopServer, waitForServer } from './test-helpers';

describe('Health Check', () => {
  let serverUrl: string;

  beforeAll(async () => {
    serverUrl = 'http://localhost:3000';
    // Import server to start it
    require('./server');
    await waitForServer(1000);
  });

  afterAll(async () => {
    await stopServer();
  });

  it('should return healthy status', async () => {
    const response = await axios.get(`${serverUrl}/health`);

    expect(response.status).toBe(200);
    expect(response.data).toEqual({
      status: 'healthy',
      server_id: expect.any(String),
      timestamp: expect.any(String),
      load: expect.any(Object)
    });
  });

  it('should return server load metrics', async () => {
    const response = await axios.get(`${serverUrl}/health`);

    expect(response.data).toHaveProperty('load');
    expect(response.data.load).toHaveProperty('cpu');
    expect(response.data.load).toHaveProperty('memory');
    expect(response.data.load.cpu).toBeGreaterThanOrEqual(0);
    expect(response.data.load.cpu).toBeLessThanOrEqual(100);
  });
});
