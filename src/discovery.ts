/**
 * Client-side commitment discovery for Privacy Pools.
 *
 * Discovers which pool commitments belong to the current user by
 * re-deriving deposit secrets from master keys and matching precommitments
 * against known deposits. Filters out spent commitments using nullifier
 * hashes.
 *
 * When withdrawal records are provided (as a Map instead of a Set),
 * also traces partial-withdrawal chains to discover change commitments.
 *
 * Typical usage:
 * ```ts
 * // 1. Scan chain or fetch from server
 * const scanResult = await scanPoolEvents(client, pool, from, to);
 *
 * // 2. Build withdrawals map from Withdrawn events
 * const withdrawals = new Map<bigint, WithdrawalRecord>();
 * // ... populate from Withdrawn events
 *
 * // 3. Discover user's unspent commitments (including change commitments)
 * const masterKeys = deriveMasterKeys(mnemonic);
 * const available = discoverCommitments(
 *   masterKeys, scope,
 *   scanResult.depositsByPrecommitment,
 *   withdrawals,
 * );
 *
 * // 4. Select for withdrawal
 * const selected = selectCommitments(available, amount);
 * ```
 */

import type { MasterKeys } from '@0xbow/privacy-pools-core-sdk';
import {
  deriveDepositSecrets,
  deriveWithdrawalSecrets,
  computePrecommitment,
  computeNullifierHash,
  buildCommitment,
} from './keys.js';
import type { DepositRecord, WithdrawalRecord } from './scanner.js';
import type { WithdrawableCommitment } from './selection.js';

export interface DiscoverOptions {
  /**
   * Maximum deposit index to check.
   * @default 100
   */
  maxIndex?: number;

  /**
   * Stop scanning after this many consecutive misses.
   * Set to 0 to always scan up to maxIndex.
   * @default 20
   */
  gapLimit?: number;

  /**
   * Maximum depth for change commitment chains.
   * Each partial withdrawal creates a change commitment that can itself
   * be partially withdrawn. This limits how deep the chain is followed.
   * @default 10
   */
  maxChainDepth?: number;

  /**
   * Set of ASP-approved labels. When provided, only deposits whose label
   * appears in this set are included. Deposits that failed or were declined
   * by the ASP are filtered out — they can't be withdrawn (only ragequit).
   *
   * Pass the `aspLeaves` from the 0xbow API or from `getAspLeaves()`.
   */
  aspLabels?: ReadonlySet<bigint>;
}

/**
 * Spent nullifiers can be provided as:
 * - `Set<bigint>` — basic spent filtering only (no change commitment tracing)
 * - `Map<bigint, WithdrawalRecord>` — enables change commitment discovery
 *   by providing the withdrawn value and new commitment hash for each spent
 *   nullifier
 */
export type SpentNullifiers =
  | ReadonlySet<bigint>
  | ReadonlyMap<bigint, WithdrawalRecord>;

/**
 * Discover the user's unspent pool commitments.
 *
 * Iterates deposit indices from 0, deriving secrets and matching
 * precommitments against the provided deposit map. Commitments whose
 * nullifier hash appears in the spent set are excluded — unless
 * withdrawal records are provided (Map), in which case partial
 * withdrawals are traced to discover change commitments.
 *
 * @param masterKeys - User's master keys (from deriveMasterKeys).
 * @param scope - Pool scope (from getPoolState or chain config).
 * @param deposits - Deposits indexed by precommitment hash
 *   (e.g. from scanPoolEvents().depositsByPrecommitment).
 * @param spentNullifiers - Either a Set of spent nullifier hashes
 *   (basic filtering) or a Map from nullifier hash to WithdrawalRecord
 *   (enables change commitment discovery).
 * @param options - Scanning limits.
 * @returns Unspent commitments sorted descending by value,
 *   ready for {@link selectCommitments}.
 */
export function discoverCommitments(
  masterKeys: MasterKeys,
  scope: bigint,
  deposits: ReadonlyMap<bigint, DepositRecord>,
  spentNullifiers: SpentNullifiers,
  options?: DiscoverOptions
): WithdrawableCommitment[] {
  const maxIndex = options?.maxIndex ?? 100;
  const gapLimit = options?.gapLimit ?? 20;
  const maxChainDepth = options?.maxChainDepth ?? 10;
  const aspLabels = options?.aspLabels;

  const isMap = spentNullifiers instanceof Map;
  const found: WithdrawableCommitment[] = [];
  let consecutiveMisses = 0;

  for (let i = 0; i < maxIndex; i++) {
    const index = BigInt(i);
    const secrets = deriveDepositSecrets(masterKeys, scope, index);
    const precommitment = computePrecommitment(
      secrets.nullifier as bigint,
      secrets.secret as bigint
    );

    const deposit = deposits.get(precommitment);
    if (!deposit) {
      consecutiveMisses++;
      if (gapLimit > 0 && consecutiveMisses >= gapLimit && found.length > 0) {
        break;
      }
      continue;
    }

    consecutiveMisses = 0;

    // Skip deposits not approved by the ASP (failed/declined/pending).
    // These can only be recovered via ragequit, not withdrawn normally.
    if (aspLabels && !aspLabels.has(deposit.label)) {
      continue;
    }

    const nullifierHash = computeNullifierHash(secrets.nullifier as bigint);

    if (!spentNullifiers.has(nullifierHash)) {
      // Unspent original deposit
      found.push({
        depositIndex: index,
        withdrawalIndex: 0n,
        commitment: deposit.commitment,
        label: deposit.label,
        value: deposit.value,
      });
      continue;
    }

    // Spent — trace change commitment chain if withdrawal records available
    if (isMap) {
      traceChangeCommitments(
        masterKeys,
        index,
        deposit.label,
        deposit.value,
        nullifierHash,
        spentNullifiers as ReadonlyMap<bigint, WithdrawalRecord>,
        found,
        maxChainDepth
      );
    }
  }

  found.sort((a, b) => (b.value > a.value ? 1 : b.value < a.value ? -1 : 0));

  return found;
}

/**
 * Discover unspent change commitments for server-provided commitments.
 *
 * When the server provides the user's known commitments directly (no need
 * for index-scanning discovery), this function handles the one thing the
 * server can't know about blind withdrawals: change commitments from
 * partial withdrawals.
 *
 * For each provided commitment, computes its nullifier hash. If the
 * nullifier is spent (appears in the spentNullifiers map), traces the
 * change commitment chain to find unspent change commitments.
 *
 * Returns only the discovered change commitments — the caller should
 * combine these with the unspent originals from the server.
 *
 * @param masterKeys - User's master keys (from deriveMasterKeys).
 * @param scope - Pool scope (from getPoolState or chain config).
 * @param commitments - Server-provided commitments for this account.
 * @param spentNullifiers - Map from nullifier hash to WithdrawalRecord
 *   (from on-chain Withdrawn events). Must be a Map (not Set) to enable
 *   change commitment tracing.
 * @param options - Chain depth limit.
 * @returns Unspent change commitments sorted descending by value.
 */
export function discoverChangeCommitments(
  masterKeys: MasterKeys,
  scope: bigint,
  commitments: ReadonlyArray<{
    depositIndex: bigint;
    withdrawalIndex: bigint;
    label: bigint;
    value: bigint;
  }>,
  spentNullifiers: ReadonlyMap<bigint, WithdrawalRecord>,
  options?: { maxChainDepth?: number }
): WithdrawableCommitment[] {
  const maxChainDepth = options?.maxChainDepth ?? 10;
  const found: WithdrawableCommitment[] = [];

  for (const c of commitments) {
    // Only trace from original deposits (withdrawalIndex=0).
    // traceChangeCommitments walks the full chain from the original,
    // so change commitments provided by the server are already covered
    // by tracing from their original deposit.
    if (c.withdrawalIndex !== 0n) continue;

    const secrets = deriveDepositSecrets(masterKeys, scope, c.depositIndex);
    const nullifierHash = computeNullifierHash(secrets.nullifier as bigint);

    if (!spentNullifiers.has(nullifierHash)) {
      // Not spent — no change commitment to trace
      continue;
    }

    // Spent — trace the change commitment chain
    traceChangeCommitments(
      masterKeys,
      c.depositIndex,
      c.label,
      c.value,
      nullifierHash,
      spentNullifiers,
      found,
      maxChainDepth
    );
  }

  found.sort((a, b) => (b.value > a.value ? 1 : b.value < a.value ? -1 : 0));
  return found;
}

/**
 * Trace a chain of partial withdrawals to find unspent change commitments.
 *
 * When a commitment is partially withdrawn, the pool contract creates a
 * change commitment with the remaining value. This function follows the
 * chain: original → change → change → ... until it finds an unspent
 * commitment or the chain ends.
 *
 * Change commitment secrets are derived from:
 *   `deriveWithdrawalSecrets(masterKeys, label, withdrawalIndex)`
 * where withdrawalIndex increments for each link in the chain.
 */
function traceChangeCommitments(
  masterKeys: MasterKeys,
  depositIndex: bigint,
  label: bigint,
  parentValue: bigint,
  parentNullifierHash: bigint,
  withdrawals: ReadonlyMap<bigint, WithdrawalRecord>,
  found: WithdrawableCommitment[],
  maxDepth: number
): void {
  let currentValue = parentValue;
  let currentNullifierHash = parentNullifierHash;

  for (let depth = 0; depth < maxDepth; depth++) {
    const withdrawal = withdrawals.get(currentNullifierHash);
    if (!withdrawal) break;

    const remainingValue = currentValue - withdrawal.withdrawnValue;
    if (remainingValue <= 0n) break; // Full withdrawal — no change

    // The change commitment was created with withdrawalIndex = depth
    // (first change = 0, second = 1, etc.)
    const changeSecrets = deriveWithdrawalSecrets(
      masterKeys,
      label,
      BigInt(depth)
    );

    // Verify the derived commitment matches the on-chain change commitment
    const derived = buildCommitment(
      remainingValue,
      label,
      changeSecrets.nullifier as bigint,
      changeSecrets.secret as bigint
    );
    if (derived.hash !== withdrawal.newCommitment) break;

    // Check if this change commitment is itself spent
    const changeNullifierHash = computeNullifierHash(
      changeSecrets.nullifier as bigint
    );

    if (!withdrawals.has(changeNullifierHash)) {
      // Unspent change commitment
      found.push({
        depositIndex,
        withdrawalIndex: BigInt(depth + 1),
        commitment: withdrawal.newCommitment,
        label,
        value: remainingValue,
      });
      return;
    }

    // This change commitment was also spent — continue tracing
    currentValue = remainingValue;
    currentNullifierHash = changeNullifierHash;
  }
}
