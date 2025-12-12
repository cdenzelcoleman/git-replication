import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';

export interface WriteData {
  repo_id: string;
  ref: string;
  commit: string;
  [key: string]: any;
}

export interface ReplicationResult {
  success: boolean;
  peersConfirmed: number;
  peersRequired: number;
  error?: string;
}

export class ReplicationCoordinator {
  private serverId: string;
  private peerUrls: string[];
  private timeout: number = 5000; // 5 second timeout

  constructor(serverId: string, peerUrls: string[]) {
    this.serverId = serverId;
    this.peerUrls = peerUrls;
  }

  getQuorumSize(): number {
    // Total servers = self + peers
    const totalServers = 1 + this.peerUrls.length;

    // Quorum calculation:
    // For 2 servers: need 1 peer (self + 1 = quorum of 2)
    // For 3+ servers: need majority, which is ceil(N/2) - 1 peers
    // For 6 servers: need 2 peers (self + 2 = quorum of 3)
    return totalServers === 2
      ? 1
      : Math.ceil(totalServers / 2) - 1;
  }

  async replicateWrite(writeData: WriteData): Promise<ReplicationResult> {
    const transactionId = uuidv4();
    const quorumSize = this.getQuorumSize();

    // Phase 1: Prepare
    const preparePromises = this.peerUrls.map(peerUrl =>
      this.sendPrepare(peerUrl, transactionId, writeData)
    );

    const prepareResults = await Promise.allSettled(preparePromises);
    const successfulPrepares = prepareResults.filter(
      result => result.status === 'fulfilled'
    );

    // Check if we have quorum
    if (successfulPrepares.length < quorumSize) {
      return {
        success: false,
        peersConfirmed: successfulPrepares.length,
        peersRequired: quorumSize,
        error: `Quorum not reached. Required: ${quorumSize}, Got: ${successfulPrepares.length}`
      };
    }

    // Phase 2: Commit
    // Only commit to peers that prepared successfully
    const peersToCommit = this.peerUrls.filter((_, index) =>
      prepareResults[index].status === 'fulfilled'
    );

    const commitPromises = peersToCommit.map(peerUrl =>
      this.sendCommit(peerUrl, transactionId)
    );

    await Promise.allSettled(commitPromises);

    return {
      success: true,
      peersConfirmed: successfulPrepares.length,
      peersRequired: quorumSize
    };
  }

  private async sendPrepare(
    peerUrl: string,
    transactionId: string,
    writeData: WriteData
  ): Promise<void> {
    await axios.post(
      `${peerUrl}/replicate/prepare`,
      {
        transaction_id: transactionId,
        coordinator_id: this.serverId,
        ...writeData
      },
      { timeout: this.timeout }
    );
  }

  private async sendCommit(
    peerUrl: string,
    transactionId: string
  ): Promise<void> {
    await axios.post(
      `${peerUrl}/replicate/commit`,
      {
        transaction_id: transactionId,
        coordinator_id: this.serverId
      },
      { timeout: this.timeout }
    );
  }
}
