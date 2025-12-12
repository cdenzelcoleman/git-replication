import { Request, Response } from 'express';

interface Transaction {
  transaction_id: string;
  coordinator_id: string;
  repo_id: string;
  ref: string;
  commit: string;
  timestamp: string;
  status: 'prepared' | 'committed' | 'aborted';
}

class ReplicationHandler {
  private transactions: Map<string, Transaction> = new Map();
  private serverId: string;

  constructor(serverId: string) {
    this.serverId = serverId;
  }

  async handlePrepare(req: Request, res: Response): Promise<void> {
    const { transaction_id, coordinator_id, repo_id, ref, commit } = req.body;

    // Validate required fields
    if (!transaction_id || !coordinator_id || !repo_id) {
      res.status(400).json({
        error: 'Missing required fields: transaction_id, coordinator_id, repo_id'
      });
      return;
    }

    // Store transaction in prepared state
    const transaction: Transaction = {
      transaction_id,
      coordinator_id,
      repo_id,
      ref,
      commit,
      timestamp: new Date().toISOString(),
      status: 'prepared'
    };

    this.transactions.set(transaction_id, transaction);

    res.status(200).json({
      status: 'prepared',
      transaction_id,
      server_id: this.serverId
    });
  }

  async handleCommit(req: Request, res: Response): Promise<void> {
    const { transaction_id, coordinator_id } = req.body;

    // Validate required fields
    if (!transaction_id || !coordinator_id) {
      res.status(400).json({
        error: 'Missing required fields: transaction_id, coordinator_id'
      });
      return;
    }

    // Check if transaction exists
    const transaction = this.transactions.get(transaction_id);
    if (!transaction) {
      res.status(404).json({
        error: `Transaction not found: ${transaction_id}`
      });
      return;
    }

    // Update transaction status
    transaction.status = 'committed';
    this.transactions.set(transaction_id, transaction);

    res.status(200).json({
      status: 'committed',
      transaction_id,
      server_id: this.serverId
    });
  }

  async handleAbort(req: Request, res: Response): Promise<void> {
    const { transaction_id, coordinator_id } = req.body;

    // Validate required fields
    if (!transaction_id || !coordinator_id) {
      res.status(400).json({
        error: 'Missing required fields: transaction_id, coordinator_id'
      });
      return;
    }

    // Check if transaction exists (optional - can succeed even if not found)
    const transaction = this.transactions.get(transaction_id);
    if (transaction) {
      transaction.status = 'aborted';
      this.transactions.set(transaction_id, transaction);
    }

    res.status(200).json({
      status: 'aborted',
      transaction_id,
      server_id: this.serverId
    });
  }

  getTransactionCount(): number {
    return this.transactions.size;
  }

  clearTransactions(): void {
    this.transactions.clear();
  }
}

export { ReplicationHandler, Transaction };
