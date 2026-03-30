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
    const end =
      start + chunkSize - 1n > toBlock ? toBlock : start + chunkSize - 1n;

    if (onProgress) {
      onProgress(start - fromBlock, totalBlocks);
    }

    const leafEvents = await client.getLogs({
      address: poolAddress,
      event: LEAF_INSERTED_EVENT,
      fromBlock: start,
      toBlock: end,
    });

    for (const e of leafEvents) {
      const args = e.args as any;
      leafByIndex.set(args._index as bigint, args._leaf as bigint);
    }

    const depositEvents = await client.getLogs({
      address: poolAddress,
      event: DEPOSITED_EVENT,
      fromBlock: start,
      toBlock: end,
    });

    for (const e of depositEvents) {
      const args = e.args as any;
      depositsByPrecommitment.set(args._precommitmentHash as bigint, {
        commitment: args._commitment as bigint,
        label: args._label as bigint,
        value: args._value as bigint,
      });
    }
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
    const end =
      start + chunkSize - 1n > toBlock ? toBlock : start + chunkSize - 1n;

    if (onProgress) {
      onProgress(start - fromBlock, totalBlocks);
    }

    const events = await client.getLogs({
      address: poolAddress,
      event: DEPOSITED_EVENT,
      args: { _depositor: depositorAddress },
      fromBlock: start,
      toBlock: end,
    });

    for (const e of events) {
      const args = e.args as any;
      deposits.push({
        commitment: args._commitment as bigint,
        label: args._label as bigint,
        value: args._value as bigint,
      });
    }
  }

  return deposits;
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
