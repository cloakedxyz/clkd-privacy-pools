/**
 * Chain scanner for Privacy Pools deposits.
 *
 * Indexes LeafInserted and Deposited events to reconstruct the state tree
 * and recover deposit metadata. Used for both normal operation and recovery.
 */

import type { PublicClient } from 'viem';
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
 * @param chunkSize - Max blocks per getLogs query (default 50000)
 */
export async function scanPoolEvents(
  client: PublicClient,
  poolAddress: `0x${string}`,
  fromBlock: bigint,
  toBlock: bigint,
  chunkSize = 50000n
): Promise<ScanResult> {
  const depositsByPrecommitment = new Map<bigint, DepositRecord>();
  const leafByIndex = new Map<bigint, bigint>();

  for (let start = fromBlock; start <= toBlock; start += chunkSize) {
    const end =
      start + chunkSize - 1n > toBlock ? toBlock : start + chunkSize - 1n;

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

  const sortedIndices = [...leafByIndex.keys()].sort(
    (a, b) => Number(a - b)
  );
  const leaves = sortedIndices.map((idx) => leafByIndex.get(idx)!);

  return { leaves, depositsByPrecommitment };
}

/**
 * Find all deposits made by a specific wallet by iterating through
 * deposit indices and checking precommitments.
 *
 * Used for recovery: given a wallet signature, re-derive secrets for
 * index 0, 1, 2, ... and scan the chain for matching deposits.
 *
 * @param scanResult - Pre-scanned chain data
 * @param computePrecommitment - Function that computes precommitment for a given index
 * @param maxIndex - Maximum index to check (default 100)
 */
export function findUserDeposits(
  scanResult: ScanResult,
  computePrecommitment: (index: bigint) => bigint,
  maxIndex = 100
): Array<{ index: bigint; deposit: DepositRecord }> {
  const found: Array<{ index: bigint; deposit: DepositRecord }> = [];
  let consecutiveMisses = 0;

  for (let i = 0; i < maxIndex; i++) {
    const idx = BigInt(i);
    const precommitment = computePrecommitment(idx);
    const deposit = scanResult.depositsByPrecommitment.get(precommitment);

    if (deposit) {
      found.push({ index: idx, deposit });
      consecutiveMisses = 0;
    } else {
      consecutiveMisses++;
      // Stop after 10 consecutive misses — user likely didn't deposit beyond this
      if (consecutiveMisses >= 10 && found.length > 0) {
        break;
      }
    }
  }

  return found;
}

/**
 * Read the pool's current state from on-chain.
 */
export async function getPoolState(
  client: PublicClient,
  poolAddress: `0x${string}`
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
