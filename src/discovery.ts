/**
 * Client-side commitment discovery for Privacy Pools.
 *
 * Discovers which pool commitments belong to the current user by
 * re-deriving deposit secrets from master keys and matching precommitments
 * against known deposits. Filters out spent commitments using nullifier
 * hashes.
 *
 * Key insight: the precommitment hash (poseidon(nullifier, secret)) is used
 * for deposit matching, while the nullifier hash (poseidon(nullifier)) is
 * the value emitted as `_spentNullifier` in Withdrawn events. These are
 * different values — both are derived from the same deposit secrets.
 *
 * Typical usage:
 * ```ts
 * // 1. Scan chain or fetch from server
 * const scanResult = await scanPoolEvents(client, pool, from, to);
 * const spentNullifiers = await getSpentNullifiers(...); // from Withdrawn events
 *
 * // 2. Discover user's unspent commitments
 * const masterKeys = deriveMasterKeys(mnemonic);
 * const available = discoverCommitments(
 *   masterKeys, scope,
 *   scanResult.depositsByPrecommitment,
 *   spentNullifiers,
 * );
 *
 * // 3. Select for withdrawal
 * const selected = selectCommitments(available, amount);
 * ```
 */

import type { MasterKeys } from '@0xbow/privacy-pools-core-sdk';
import {
  deriveDepositSecrets,
  computePrecommitment,
  computeNullifierHash,
} from './keys.js';
import type { DepositRecord } from './scanner.js';
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
}

/**
 * Discover the user's unspent pool commitments.
 *
 * Iterates deposit indices from 0, deriving secrets and matching
 * precommitments against the provided deposit map. Commitments whose
 * nullifier hash appears in `spentNullifiers` are excluded.
 *
 * The on-chain `_spentNullifier` (from Withdrawn events) is
 * `poseidon([nullifier])` — a single-input hash of the raw nullifier,
 * NOT the precommitment hash `poseidon([nullifier, secret])`.
 *
 * @param masterKeys - User's master keys (from deriveMasterKeys).
 * @param scope - Pool scope (from getPoolState or chain config).
 * @param deposits - Deposits indexed by precommitment hash
 *   (e.g. from scanPoolEvents().depositsByPrecommitment).
 * @param spentNullifiers - Set of spent nullifier hashes, i.e. the
 *   `_spentNullifier` values from Withdrawn events (or a server endpoint).
 *   These are `poseidon([nullifier])` — NOT precommitment hashes.
 * @param options - Scanning limits.
 * @returns Unspent commitments sorted descending by value,
 *   ready for {@link selectCommitments}.
 */
export function discoverCommitments(
  masterKeys: MasterKeys,
  scope: bigint,
  deposits: ReadonlyMap<bigint, DepositRecord>,
  spentNullifiers: ReadonlySet<bigint>,
  options?: DiscoverOptions
): WithdrawableCommitment[] {
  const maxIndex = options?.maxIndex ?? 100;
  const gapLimit = options?.gapLimit ?? 20;

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

    // The on-chain _spentNullifier is poseidon([nullifier]) — a single-input
    // Poseidon hash of the raw nullifier. This is different from the
    // precommitment hash which is poseidon([nullifier, secret]).
    const nullifierHash = computeNullifierHash(secrets.nullifier as bigint);
    if (spentNullifiers.has(nullifierHash)) {
      continue;
    }

    found.push({
      depositIndex: index,
      withdrawalIndex: 0n,
      commitment: deposit.commitment,
      label: deposit.label,
      value: deposit.value,
    });
  }

  // Sort descending by value for selectCommitments
  found.sort((a, b) => (b.value > a.value ? 1 : b.value < a.value ? -1 : 0));

  return found;
}
