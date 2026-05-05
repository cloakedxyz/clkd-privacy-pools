/**
 * Chain scanner for Privacy Pools deposits.
 *
 * Indexes LeafInserted and Deposited events to reconstruct the state tree
 * and recover deposit metadata. Used for both normal operation and recovery.
 */

import type { Address, PublicClient } from 'viem';
import { POOL_ABI } from './abi.js';

export interface DepositRecord {
  commitment: bigint;
  label: bigint;
  value: bigint;
  /** Block number where the Deposited event was emitted, when available. */
  blockNumber?: bigint;
}

/**
 * Record of a withdrawal, parsed from a Withdrawn event.
 * Used for spent detection and change commitment tracing.
 */
export interface WithdrawalRecord {
  /** Amount withdrawn from the commitment. */
  withdrawnValue: bigint;
  /** Hash of the new change commitment (from the Withdrawn event). */
  newCommitment: bigint;
  /** Block number where the Withdrawn event was emitted, when available. */
  blockNumber?: bigint;
}

export interface ScanResult {
  /** All state tree leaves in insertion order. */
  leaves: bigint[];
  /** Deposits indexed by precommitment hash. */
  depositsByPrecommitment: Map<bigint, DepositRecord>;
}

const LEAF_INSERTED_EVENT = {
  type: 'event' as const,
  name: 'LeafInserted',
  inputs: [
    { name: '_index', type: 'uint256', indexed: false },
    { name: '_leaf', type: 'uint256', indexed: false },
    { name: '_root', type: 'uint256', indexed: false },
  ],
};

const DEPOSITED_EVENT = {
  type: 'event' as const,
  name: 'Deposited',
  inputs: [
    { name: '_depositor', type: 'address', indexed: true },
    { name: '_commitment', type: 'uint256', indexed: false },
    { name: '_label', type: 'uint256', indexed: false },
    { name: '_value', type: 'uint256', indexed: false },
    { name: '_precommitmentHash', type: 'uint256', indexed: false },
  ],
};

const WITHDRAWN_EVENT = {
  type: 'event' as const,
  name: 'Withdrawn',
  inputs: [
    { name: '_withdrawer', type: 'address', indexed: true },
    { name: '_spentNullifier', type: 'uint256', indexed: false },
    { name: '_value', type: 'uint256', indexed: false },
    { name: '_newCommitment', type: 'uint256', indexed: false },
  ],
};

type EventLog = {
  args?: Record<string, unknown>;
  blockNumber?: bigint | null;
};

type GetLogsParams = Parameters<PublicClient['getLogs']>[0] & {
  fromBlock: bigint;
  toBlock: bigint;
};

interface GetLogsResult {
  logs: EventLog[];
  toBlock: bigint;
  clamped: boolean;
}

function isBeyondCurrentHeadError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.toLowerCase().includes('beyond current head');
}

async function getLogsWithHeadClamp(
  client: PublicClient,
  params: GetLogsParams
): Promise<GetLogsResult> {
  try {
    const logs = (await client.getLogs(params)) as EventLog[];
    return { logs, toBlock: params.toBlock, clamped: false };
  } catch (error) {
    if (!isBeyondCurrentHeadError(error)) {
      throw error;
    }

    const headBlock = await client.getBlockNumber();
    const safeToBlock =
      params.toBlock > headBlock
        ? headBlock
        : headBlock > 0n
          ? headBlock - 1n
          : headBlock;

    if (safeToBlock < params.fromBlock) {
      return { logs: [], toBlock: safeToBlock, clamped: true };
    }

    const logs = (await client.getLogs({
      ...params,
      toBlock: safeToBlock,
    })) as EventLog[];

    return { logs, toBlock: safeToBlock, clamped: true };
  }
}

function chunkEnd(start: bigint, toBlock: bigint, chunkSize: bigint): bigint {
  const end = start + chunkSize - 1n;
  return end > toBlock ? toBlock : end;
}

/**
 * Scan a range of blocks for LeafInserted and Deposited events.
 *
 * @param client - viem PublicClient
 * @param poolAddress - Privacy Pool contract address
 * @param fromBlock - Start block (inclusive)
 * @param toBlock - End block (inclusive)
 * @param chunkSize - Max blocks per getLogs query (default 1000, safe for public RPCs)
 * @param onProgress - Optional callback with (scannedBlocks, totalBlocks) for progress tracking
 */
export async function scanPoolEvents(
  client: PublicClient,
  poolAddress: Address,
  fromBlock: bigint,
  toBlock: bigint,
  chunkSize = 1000n,
  onProgress?: (scanned: bigint, total: bigint) => void
): Promise<ScanResult> {
  const depositsByPrecommitment = new Map<bigint, DepositRecord>();
  const leafByIndex = new Map<bigint, bigint>();
  const totalBlocks = toBlock - fromBlock;

  for (let start = fromBlock; start <= toBlock; start += chunkSize) {
    const end = chunkEnd(start, toBlock, chunkSize);

    if (onProgress) {
      onProgress(start - fromBlock, totalBlocks);
    }

    let leafResult = await getLogsWithHeadClamp(client, {
      address: poolAddress,
      event: LEAF_INSERTED_EVENT,
      fromBlock: start,
      toBlock: end,
    });

    if (leafResult.toBlock < start) break;

    const depositResult = await getLogsWithHeadClamp(client, {
      address: poolAddress,
      event: DEPOSITED_EVENT,
      fromBlock: start,
      toBlock: leafResult.toBlock,
    });

    if (depositResult.toBlock < start) break;

    if (depositResult.toBlock < leafResult.toBlock) {
      leafResult = await getLogsWithHeadClamp(client, {
        address: poolAddress,
        event: LEAF_INSERTED_EVENT,
        fromBlock: start,
        toBlock: depositResult.toBlock,
      });
    }

    for (const e of leafResult.logs) {
      const args = e.args as any;
      leafByIndex.set(args._index as bigint, args._leaf as bigint);
    }

    for (const e of depositResult.logs) {
      const args = e.args as any;
      depositsByPrecommitment.set(args._precommitmentHash as bigint, {
        commitment: args._commitment as bigint,
        label: args._label as bigint,
        value: args._value as bigint,
        blockNumber: e.blockNumber ?? undefined,
      });
    }

    if (leafResult.clamped || depositResult.clamped) break;
  }

  const sortedIndices = [...leafByIndex.keys()].sort((a, b) => Number(a - b));
  const leaves = sortedIndices.map((idx) => leafByIndex.get(idx)!);

  return { leaves, depositsByPrecommitment };
}

/**
 * Find all deposits made by a specific address by filtering Deposited events.
 *
 * This is the most reliable recovery method — it uses the indexed `_depositor`
 * field to filter events directly via getLogs, so it finds every deposit
 * regardless of index. No brute-forcing needed.
 *
 * @param client - viem PublicClient
 * @param poolAddress - Privacy Pool contract address
 * @param depositorAddress - The address that made the deposits
 * @param fromBlock - Start block (inclusive)
 * @param toBlock - End block (inclusive)
 * @param chunkSize - Max blocks per getLogs query (default 1000)
 * @param onProgress - Optional progress callback
 */
export async function findDepositsByAddress(
  client: PublicClient,
  poolAddress: Address,
  depositorAddress: Address,
  fromBlock: bigint,
  toBlock: bigint,
  chunkSize = 1000n,
  onProgress?: (scanned: bigint, total: bigint) => void
): Promise<DepositRecord[]> {
  const deposits: DepositRecord[] = [];
  const totalBlocks = toBlock - fromBlock;

  for (let start = fromBlock; start <= toBlock; start += chunkSize) {
    const end = chunkEnd(start, toBlock, chunkSize);

    if (onProgress) {
      onProgress(start - fromBlock, totalBlocks);
    }

    const result = await getLogsWithHeadClamp(client, {
      address: poolAddress,
      event: DEPOSITED_EVENT,
      args: { _depositor: depositorAddress },
      fromBlock: start,
      toBlock: end,
    });

    for (const e of result.logs) {
      const args = e.args as any;
      deposits.push({
        commitment: args._commitment as bigint,
        label: args._label as bigint,
        value: args._value as bigint,
        blockNumber: e.blockNumber ?? undefined,
      });
    }

    if (result.clamped) break;
  }

  return deposits;
}

/**
 * Scan a range of blocks for Withdrawn events.
 *
 * @returns Withdrawals keyed by spent nullifier hash.
 */
export async function scanPoolWithdrawals(
  client: PublicClient,
  poolAddress: Address,
  fromBlock: bigint,
  toBlock: bigint,
  chunkSize = 1000n,
  onProgress?: (scanned: bigint, total: bigint) => void
): Promise<Map<bigint, WithdrawalRecord>> {
  const withdrawalsByNullifier = new Map<bigint, WithdrawalRecord>();
  const totalBlocks = toBlock - fromBlock;

  for (let start = fromBlock; start <= toBlock; start += chunkSize) {
    const end = chunkEnd(start, toBlock, chunkSize);

    if (onProgress) {
      onProgress(start - fromBlock, totalBlocks);
    }

    const result = await getLogsWithHeadClamp(client, {
      address: poolAddress,
      event: WITHDRAWN_EVENT,
      fromBlock: start,
      toBlock: end,
    });

    for (const e of result.logs) {
      const args = e.args as any;
      withdrawalsByNullifier.set(args._spentNullifier as bigint, {
        withdrawnValue: args._value as bigint,
        newCommitment: args._newCommitment as bigint,
        blockNumber: e.blockNumber ?? undefined,
      });
    }

    if (result.clamped) break;
  }

  return withdrawalsByNullifier;
}

/**
 * Read the pool's current state from on-chain.
 */
export async function getPoolState(
  client: PublicClient,
  poolAddress: Address
): Promise<{ scope: bigint; currentRoot: bigint; treeSize: bigint }> {
  const [scope, currentRoot, treeSize] = await Promise.all([
    client.readContract({
      address: poolAddress,
      abi: POOL_ABI,
      functionName: 'SCOPE',
    }) as Promise<bigint>,
    client.readContract({
      address: poolAddress,
      abi: POOL_ABI,
      functionName: 'currentRoot',
    }) as Promise<bigint>,
    client.readContract({
      address: poolAddress,
      abi: POOL_ABI,
      functionName: 'currentTreeSize',
    }) as Promise<bigint>,
  ]);

  return { scope, currentRoot, treeSize };
}
