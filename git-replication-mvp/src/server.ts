import express, { Request, Response } from 'express';
import os from 'os';
import { ReplicationHandler } from './replication-handler';

const app = express();
const PORT = process.env.PORT || 3000;
const SERVER_ID = process.env.SERVER_ID || 'server-1';

app.use(express.json());

// Initialize replication handler
const replicationHandler = new ReplicationHandler(SERVER_ID);

// Health check endpoint
app.get('/health', (req: Request, res: Response) => {
  const cpus = os.cpus();
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;

  // Calculate average CPU load (simplified)
  let totalIdle = 0;
  let totalTick = 0;
  cpus.forEach(cpu => {
    for (const type in cpu.times) {
      totalTick += cpu.times[type as keyof typeof cpu.times];
    }
    totalIdle += cpu.times.idle;
  });

  const cpuUsage = 100 - (100 * totalIdle / totalTick);
  const memoryUsage = (usedMem / totalMem) * 100;

  res.status(200).json({
    status: 'healthy',
    server_id: SERVER_ID,
    timestamp: new Date().toISOString(),
    load: {
      cpu: parseFloat(cpuUsage.toFixed(2)),
      memory: parseFloat(memoryUsage.toFixed(2))
    }
  });
});

// Replication endpoints
app.post('/replicate/prepare', (req: Request, res: Response) => {
  replicationHandler.handlePrepare(req, res);
});

app.post('/replicate/commit', (req: Request, res: Response) => {
  replicationHandler.handleCommit(req, res);
});

app.post('/replicate/abort', (req: Request, res: Response) => {
  replicationHandler.handleAbort(req, res);
});

const server = app.listen(PORT, () => {
  console.log(`Server ${SERVER_ID} running on port ${PORT}`);
});

export { app, server, replicationHandler };
