import { describe, it, expect } from 'vitest';
import {
  selectCommitments,
  MAX_COMMITMENTS_PER_WITHDRAWAL,
  type WithdrawableCommitment,
  type SelectedCommitment,
} from '../src/selection';

// -- test helpers ------------------------------------------------------------

/** Create a commitment with the given value (wei). */
function commitment(
  value: bigint,
  depositIndex = 0n,
  withdrawalIndex = 0n
): WithdrawableCommitment {
  return {
    depositIndex,
    withdrawalIndex,
    commitment: BigInt(depositIndex) * 1000n + BigInt(withdrawalIndex),
    label: 99999n,
    value,
  };
}

/**
 * Build a DESC-sorted commitment list from values.
 * Each commitment gets a unique depositIndex.
 */
function commitments(...values: bigint[]): WithdrawableCommitment[] {
  return values
    .sort((a, b) => (b > a ? 1 : b < a ? -1 : 0))
    .map((v, i) => commitment(v, BigInt(i)));
}

/** Sum of all withdrawalAmounts in a selection. */
function totalWithdrawn(selected: SelectedCommitment[]): bigint {
  return selected.reduce((sum, s) => sum + s.withdrawalAmount, 0n);
}

/** Assert every selected commitment has withdrawalAmount === value. */
function assertAllFullyConsumed(selected: SelectedCommitment[]) {
  for (const s of selected) {
    expect(s.withdrawalAmount).toBe(s.value);
  }
}

// -- tests -------------------------------------------------------------------

describe('selectCommitments', () => {
  describe('input validation', () => {
    it('throws on zero amount', () => {
      expect(() => selectCommitments(commitments(100n), 0n)).toThrow(
        'Amount must be positive'
      );
    });

    it('throws on negative amount', () => {
      expect(() => selectCommitments(commitments(100n), -1n)).toThrow(
        'Amount must be positive'
      );
    });

    it('throws on empty commitments', () => {
      expect(() => selectCommitments([], 100n)).toThrow(
        'No commitments available'
      );
    });

    it('throws when balance is insufficient', () => {
      expect(() => selectCommitments(commitments(50n, 30n), 100n)).toThrow(
        'Insufficient pooled balance'
      );
    });
  });

  describe('exact single match', () => {
    it('selects single commitment matching exactly', () => {
      const result = selectCommitments(commitments(100n, 200n, 50n), 100n);
      expect(result).toHaveLength(1);
      expect(result[0].value).toBe(100n);
      expect(result[0].withdrawalAmount).toBe(100n);
    });

    it('prefers exact match over larger single', () => {
      const result = selectCommitments(commitments(500n, 100n, 50n), 100n);
      expect(result).toHaveLength(1);
      expect(result[0].withdrawalAmount).toBe(100n);
      assertAllFullyConsumed(result);
    });

    it('works when only commitment matches exactly', () => {
      const result = selectCommitments(commitments(42n), 42n);
      expect(result).toHaveLength(1);
      expect(result[0].withdrawalAmount).toBe(42n);
    });
  });

  describe('exact pair match', () => {
    it('finds two commitments summing exactly to amount', () => {
      const result = selectCommitments(commitments(70n, 30n, 10n), 100n);
      expect(result).toHaveLength(2);
      expect(totalWithdrawn(result)).toBe(100n);
      assertAllFullyConsumed(result);
    });

    it('finds pair even with many commitments', () => {
      const result = selectCommitments(
        commitments(90n, 80n, 60n, 40n, 20n, 10n),
        100n
      );
      // 90+10, 80+20, or 60+40 are all valid pairs
      expect(result).toHaveLength(2);
      expect(totalWithdrawn(result)).toBe(100n);
      assertAllFullyConsumed(result);
    });
  });

  describe('exact triple match', () => {
    it('finds three commitments summing exactly to amount', () => {
      // No single >= 100, no pair sums to 100
      const result = selectCommitments(commitments(50n, 30n, 20n, 5n), 100n);
      expect(result).toHaveLength(3);
      expect(totalWithdrawn(result)).toBe(100n);
      assertAllFullyConsumed(result);
    });

    it('skips triple if exact pair exists', () => {
      // 60+40 is an exact pair, should prefer that over 50+30+20
      const result = selectCommitments(
        commitments(60n, 50n, 40n, 30n, 20n),
        100n
      );
      expect(result).toHaveLength(2);
      expect(totalWithdrawn(result)).toBe(100n);
    });
  });

  describe('best single (smallest >= amount)', () => {
    it('picks smallest commitment that covers amount', () => {
      // No exact single, pair, or triple. Falls to best single.
      const result = selectCommitments(commitments(500n, 200n, 150n), 120n);
      expect(result).toHaveLength(1);
      expect(result[0].value).toBe(150n);
      expect(result[0].withdrawalAmount).toBe(120n);
    });

    it('partial withdrawal creates change', () => {
      const result = selectCommitments(commitments(100n), 60n);
      expect(result).toHaveLength(1);
      expect(result[0].withdrawalAmount).toBe(60n);
      expect(result[0].value).toBe(100n);
      // change = 100 - 60 = 40
    });
  });

  describe('greedy largest-first', () => {
    it('combines multiple commitments when no single covers', () => {
      const result = selectCommitments(commitments(40n, 35n, 30n), 100n);
      expect(result).toHaveLength(3);
      expect(totalWithdrawn(result)).toBe(100n);
    });

    it('partial withdrawal on last commitment only', () => {
      // 40 + 35 = 75, need 70 total. Takes 40 fully, 30 from 35.
      const result = selectCommitments(commitments(40n, 35n, 20n), 70n);
      expect(totalWithdrawn(result)).toBe(70n);

      // First should be fully consumed
      expect(result[0].withdrawalAmount).toBe(result[0].value);
      // Last may be partial
      const last = result[result.length - 1];
      expect(last.withdrawalAmount).toBeLessThanOrEqual(last.value);
    });

    it('handles many small commitments', () => {
      const small = Array.from({ length: 50 }, (_, i) =>
        commitment(10n, BigInt(i))
      ).sort((a, b) => (b.value > a.value ? 1 : b.value < a.value ? -1 : 0));

      const result = selectCommitments(small, 200n);
      expect(totalWithdrawn(result)).toBe(200n);
      expect(result).toHaveLength(20);
    });
  });

  describe('MAX_COMMITMENTS_PER_WITHDRAWAL', () => {
    it('equals 64', () => {
      expect(MAX_COMMITMENTS_PER_WITHDRAWAL).toBe(64);
    });

    it('throws when selection exceeds maximum', () => {
      // 65 commitments of 1 wei each, requesting 65 wei
      const tiny = Array.from({ length: 65 }, (_, i) =>
        commitment(1n, BigInt(i))
      ).sort((a, b) => (b.value > a.value ? 1 : b.value < a.value ? -1 : 0));

      expect(() => selectCommitments(tiny, 65n)).toThrow(
        'maximum is 64 per transaction'
      );
    });

    it('succeeds at exactly 64 commitments', () => {
      const atLimit = Array.from({ length: 64 }, (_, i) =>
        commitment(1n, BigInt(i))
      ).sort((a, b) => (b.value > a.value ? 1 : b.value < a.value ? -1 : 0));

      const result = selectCommitments(atLimit, 64n);
      expect(result).toHaveLength(64);
      expect(totalWithdrawn(result)).toBe(64n);
    });
  });

  describe('selection priority', () => {
    it('exact single > exact pair', () => {
      // Has both exact single (100) and exact pair (60+40)
      const result = selectCommitments(commitments(100n, 60n, 40n), 100n);
      expect(result).toHaveLength(1);
    });

    it('exact pair > exact triple', () => {
      // Has exact pair (70+30) and exact triple (50+30+20)
      const result = selectCommitments(commitments(70n, 50n, 30n, 20n), 100n);
      expect(result).toHaveLength(2);
    });

    it('exact triple > best single', () => {
      // Has exact triple (50+30+20) and best single (150)
      // No exact single at 100, no exact pair
      const result = selectCommitments(commitments(150n, 50n, 30n, 20n), 100n);
      expect(result).toHaveLength(3);
      assertAllFullyConsumed(result);
    });

    it('best single > greedy when available', () => {
      // No exact match/pair/triple. Has single >= amount (110).
      // Greedy would take 90+20 (2 inputs).
      // Best single takes 110 (1 input, small change).
      const result = selectCommitments(commitments(110n, 90n, 20n, 5n), 100n);
      expect(result).toHaveLength(1);
      expect(result[0].value).toBe(110n);
      expect(result[0].withdrawalAmount).toBe(100n);
    });
  });

  describe('withdrawal amount correctness', () => {
    it('total withdrawn always equals requested amount', () => {
      const cases: [WithdrawableCommitment[], bigint][] = [
        [commitments(100n), 100n],
        [commitments(200n, 100n), 100n],
        [commitments(60n, 40n), 100n],
        [commitments(50n, 30n, 20n), 100n],
        [commitments(150n), 100n],
        [commitments(40n, 35n, 30n), 100n],
      ];

      for (const [cs, amount] of cases) {
        const result = selectCommitments(cs, amount);
        expect(totalWithdrawn(result)).toBe(amount);
      }
    });

    it('no commitment has withdrawalAmount > value', () => {
      const result = selectCommitments(commitments(80n, 60n, 40n, 20n), 150n);
      for (const s of result) {
        expect(s.withdrawalAmount).toBeLessThanOrEqual(s.value);
      }
    });

    it('no commitment has withdrawalAmount <= 0', () => {
      const result = selectCommitments(commitments(80n, 60n, 40n, 20n), 150n);
      for (const s of result) {
        expect(s.withdrawalAmount).toBeGreaterThan(0n);
      }
    });
  });

  describe('commitment metadata preserved', () => {
    it('preserves depositIndex and withdrawalIndex', () => {
      const c = commitment(100n, 5n, 2n);
      const result = selectCommitments([c], 100n);
      expect(result[0].depositIndex).toBe(5n);
      expect(result[0].withdrawalIndex).toBe(2n);
    });

    it('preserves commitment hash and label', () => {
      const c: WithdrawableCommitment = {
        depositIndex: 0n,
        withdrawalIndex: 0n,
        commitment: 123456789n,
        label: 987654321n,
        value: 100n,
      };
      const result = selectCommitments([c], 100n);
      expect(result[0].commitment).toBe(123456789n);
      expect(result[0].label).toBe(987654321n);
    });
  });

  describe('edge cases', () => {
    it('handles single commitment of value 1', () => {
      const result = selectCommitments(commitments(1n), 1n);
      expect(result).toHaveLength(1);
      expect(result[0].withdrawalAmount).toBe(1n);
    });

    it('handles very large values', () => {
      const large = 10n ** 30n; // much larger than any realistic ETH amount
      const result = selectCommitments(commitments(large), large);
      expect(result).toHaveLength(1);
      expect(result[0].withdrawalAmount).toBe(large);
    });

    it('handles commitments with identical values', () => {
      const result = selectCommitments(commitments(50n, 50n, 50n), 100n);
      expect(result).toHaveLength(2);
      expect(totalWithdrawn(result)).toBe(100n);
    });

    it('handles change commitments (withdrawalIndex > 0)', () => {
      const cs = [
        commitment(80n, 0n, 1n), // change commitment from prior withdrawal
        commitment(50n, 1n, 0n), // original deposit
      ];
      const result = selectCommitments(cs, 80n);
      expect(result).toHaveLength(1);
      expect(result[0].withdrawalIndex).toBe(1n);
    });
  });
});
