/**
 * Client-side commitment selection for pool withdrawals.
 *
 * Selects which commitments to consume for a given withdrawal amount,
 * minimising fragmentation by preferring exact-sum combinations (which fully
 * consume commitments and create no change) over partial withdrawals.
 *
 * Priority order:
 *  1. Exact single  - one commitment whose value == amount
 *  2. Exact pair    - two commitments summing exactly to amount
 *  3. Exact triple  - three commitments summing exactly to amount
 *  4. Best single   - smallest single commitment >= amount (small change)
 *  5. Greedy largest-first with partial withdrawal on the last commitment
 *
 * This module is designed for client-side use in blind withdrawal flows
 * where the server should not learn which commitments are being consumed.
 */

/**
 * A commitment available for withdrawal.
 *
 * Extends {@link DepositRecord} with the indices needed to re-derive
 * secrets for proof generation.
 */
export interface WithdrawableCommitment {
  /** Deposit index for deterministic secret re-derivation. */
  depositIndex: bigint;
  /** 0 for original deposits, incremented for change commitments. */
  withdrawalIndex: bigint;
  /** On-chain commitment hash. */
  commitment: bigint;
  /** On-chain label (from Deposited event). */
  label: bigint;
  /** Commitment value in wei. */
  value: bigint;
}

/**
 * A commitment selected for withdrawal with the amount to withdraw.
 *
 * For full withdrawals, `withdrawalAmount === value`.
 * For partial withdrawals (greedy fallback), `withdrawalAmount < value`
 * and a change commitment will be created on-chain.
 */
export interface SelectedCommitment extends WithdrawableCommitment {
  /** Amount to withdraw from this commitment. */
  withdrawalAmount: bigint;
}

/**
 * Maximum commitments per withdrawal transaction.
 *
 * The pool contract keeps a circular buffer of the last 64 state roots.
 * Each withdrawal in a multicall inserts a new leaf (advancing the root),
 * so the 65th proof would reference an evicted root and revert.
 */
export const MAX_COMMITMENTS_PER_WITHDRAWAL = 64;

/**
 * Select commitments to cover `amount`, minimising change-commitment creation.
 *
 * Commitments must be sorted descending by value. The function tries
 * progressively less optimal strategies until it finds one that works:
 *
 * 1. Exact single match (no change commitment)
 * 2. Exact pair that sums to amount (no change)
 * 3. Exact triple that sums to amount (no change)
 * 4. Smallest single commitment >= amount (minimal change)
 * 5. Greedy largest-first, partial withdrawal on the last commitment
 *
 * @param commitments - Available commitments, **sorted descending by value**.
 * @param amount - Withdrawal amount in wei (must be positive).
 * @returns Selected commitments with per-commitment `withdrawalAmount`.
 * @throws If amount is not positive, balance is insufficient, or selection
 *         exceeds {@link MAX_COMMITMENTS_PER_WITHDRAWAL}.
 */
export function selectCommitments(
  commitments: readonly WithdrawableCommitment[],
  amount: bigint
): SelectedCommitment[] {
  if (amount <= 0n) {
    throw new Error('Amount must be positive');
  }

  if (commitments.length === 0) {
    throw new Error('No commitments available for withdrawal');
  }

  // 1. Exact single match - no change commitment
  for (const c of commitments) {
    if (c.value === amount) {
      return [withAmount(c, c.value)];
    }
  }

  // 2. Exact pair - no change commitment
  const pair = findExactPair(commitments, amount);
  if (pair) return pair;

  // 3. Exact triple - no change commitment
  const triple = findExactTriple(commitments, amount);
  if (triple) return triple;

  // 4. Best single - smallest commitment >= amount (minimises change)
  for (let i = commitments.length - 1; i >= 0; i--) {
    if (commitments[i].value >= amount) {
      return [withAmount(commitments[i], amount)];
    }
  }

  // 5. Greedy largest-first
  return greedySelect(commitments, amount);
}

// -- helpers -----------------------------------------------------------------

function withAmount(
  c: WithdrawableCommitment,
  withdrawalAmount: bigint
): SelectedCommitment {
  return { ...c, withdrawalAmount };
}

/**
 * Two-pointer scan for a pair summing exactly to `amount`.
 * Requires descending-sorted input.
 */
function findExactPair(
  commitments: readonly WithdrawableCommitment[],
  amount: bigint
): SelectedCommitment[] | null {
  let left = 0;
  let right = commitments.length - 1;

  while (left < right) {
    const sum = commitments[left].value + commitments[right].value;
    if (sum === amount) {
      return [
        withAmount(commitments[left], commitments[left].value),
        withAmount(commitments[right], commitments[right].value),
      ];
    }
    if (sum > amount) left++;
    else right--;
  }
  return null;
}

/**
 * Fix one element, two-pointer scan for the remaining pair.
 * O(n^2) - fine for typical commitment counts (< 100).
 */
function findExactTriple(
  commitments: readonly WithdrawableCommitment[],
  amount: bigint
): SelectedCommitment[] | null {
  for (let i = 0; i < commitments.length - 2; i++) {
    // Skip if this single value already covers the amount (handled earlier)
    if (commitments[i].value >= amount) continue;

    const target = amount - commitments[i].value;
    let left = i + 1;
    let right = commitments.length - 1;

    while (left < right) {
      const sum = commitments[left].value + commitments[right].value;
      if (sum === target) {
        return [
          withAmount(commitments[i], commitments[i].value),
          withAmount(commitments[left], commitments[left].value),
          withAmount(commitments[right], commitments[right].value),
        ];
      }
      if (sum > target) left++;
      else right--;
    }
  }
  return null;
}

/**
 * Greedy largest-first selection with partial withdrawal on the last
 * commitment if the total exceeds the requested amount.
 */
function greedySelect(
  commitments: readonly WithdrawableCommitment[],
  amount: bigint
): SelectedCommitment[] {
  let remaining = amount;
  const selected: SelectedCommitment[] = [];

  for (const c of commitments) {
    if (remaining <= 0n) break;
    const toWithdraw = c.value <= remaining ? c.value : remaining;
    selected.push(withAmount(c, toWithdraw));
    remaining -= toWithdraw;
  }

  if (remaining > 0n) {
    throw new Error('Insufficient pooled balance for withdrawal');
  }

  if (selected.length > MAX_COMMITMENTS_PER_WITHDRAWAL) {
    throw new Error(
      `Withdrawal requires ${selected.length} commitments ` +
        `but the maximum is ${MAX_COMMITMENTS_PER_WITHDRAWAL} per transaction`
    );
  }

  return selected;
}
