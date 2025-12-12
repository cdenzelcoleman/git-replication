import { Request, Response } from 'express';
import { RepoStorage } from './storage';

interface Transaction {
  transaction_id: string;
  coordinator_id: string;
  repo_id: string;
  ref: string;
  commit: string;
  operation: string;
  timestamp: string;
  status: 'prepared' | 'committed' | 'aborted';
}

class ReplicationHandler {
  private transactions: Map<string, Transaction> = new Map();
  private serverId: string;
  private storage: RepoStorage;

  constructor(serverId: string, storage: RepoStorage) {
    this.serverId = serverId;
    this.storage = storage;
  }

  async handlePrepare(req: Request, res: Response): Promise<void> {
    const { transaction_id, coordinator_id, repo_id, ref, commit, operation } = req.body;

    // Validate required fields
    if (!transaction_id || !coordinator_id || !repo_id) {
      res.status(400).json({
        error: 'Missing required fields: transaction_id, coordinator_id, repo_id'
      });
      return;
    }

    try {
      // Perform the actual operation (e.g., create repo)
      if (operation === 'create') {
        if (!(await this.storage.repoExists(repo_id))) {
          await this.storage.createRepo(repo_id);
        }
      }

      // Store transaction in prepared state
      const transaction: Transaction = {
        transaction_id,
        coordinator_id,
        repo_id,
        ref,
        commit,
        operation,
        timestamp: new Date().toISOString(),
        status: 'prepared'
      };

      this.transactions.set(transaction_id, transaction);

      res.status(200).json({
        status: 'prepared',
        transaction_id,
        server_id: this.serverId
      });
    } catch (error: any) {
      res.status(500).json({
        error: 'Prepare failed',
        details: error.message
      });
    }
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
