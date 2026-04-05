import { describe, it, expect } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';
import {
  deriveMnemonic,
  deriveMasterKeys,
  deriveDepositSecrets,
  deriveWithdrawalSecrets,
  computePrecommitment,
  computeNullifierHash,
  buildCommitment,
} from '../src/keys';
import {
  discoverCommitments,
  discoverChangeCommitments,
} from '../src/discovery';
import type { DepositRecord, WithdrawalRecord } from '../src/scanner';

// Deterministic test key — Anvil's first default account
const TEST_PK =
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const TEST_ACCOUNT = privateKeyToAccount(TEST_PK);

const TEST_SCOPE = 12345n;

async function getTestMasterKeys() {
  const sig = await TEST_ACCOUNT.signMessage({
    message: 'test-message-for-derivation',
  });
  const mnemonic = await deriveMnemonic({ signature: sig });
  return deriveMasterKeys(mnemonic);
}

/**
 * Build a deposits map for the given deposit indices, simulating
 * what scanPoolEvents().depositsByPrecommitment would return.
 */
function buildDepositsMap(
  masterKeys: Awaited<ReturnType<typeof getTestMasterKeys>>,
  scope: bigint,
  indices: number[],
  valuePerDeposit = 1000000000000000000n // 1 ETH
): Map<bigint, DepositRecord> {
  const map = new Map<bigint, DepositRecord>();
  for (const i of indices) {
    const secrets = deriveDepositSecrets(masterKeys, scope, BigInt(i));
    const precommitment = computePrecommitment(
      secrets.nullifier as bigint,
      secrets.secret as bigint
    );
    map.set(precommitment, {
      commitment: BigInt(i) * 1000n + 1n,
      label: BigInt(i) * 1000n + 2n,
      value: valuePerDeposit,
    });
  }
  return map;
}

/**
 * Compute the nullifier hash (= precommitment) for a given deposit index.
 */
function getNullifierHash(
  masterKeys: Awaited<ReturnType<typeof getTestMasterKeys>>,
  scope: bigint,
  index: number
): bigint {
  const secrets = deriveDepositSecrets(masterKeys, scope, BigInt(index));
  return computeNullifierHash(secrets.nullifier as bigint);
}

describe('discoverCommitments', () => {
  describe('basic discovery', () => {
    it('finds deposits that match user keys', async () => {
      const keys = await getTestMasterKeys();
      const deposits = buildDepositsMap(keys, TEST_SCOPE, [0, 1, 2]);

      const result = discoverCommitments(keys, TEST_SCOPE, deposits, new Set());

      expect(result).toHaveLength(3);
    });

    it('returns empty array when no deposits match', async () => {
      const keys = await getTestMasterKeys();
      // Empty deposits map
      const result = discoverCommitments(
        keys,
        TEST_SCOPE,
        new Map(),
        new Set()
      );

      expect(result).toHaveLength(0);
    });

    it('ignores deposits from other users', async () => {
      const keys = await getTestMasterKeys();
      // Deposits with random precommitment hashes (not derived from our keys)
      const otherDeposits = new Map<bigint, DepositRecord>();
      otherDeposits.set(99999n, {
        commitment: 1n,
        label: 2n,
        value: 1000n,
      });

      const result = discoverCommitments(
        keys,
        TEST_SCOPE,
        otherDeposits,
        new Set()
      );

      expect(result).toHaveLength(0);
    });

    it('finds deposits among other users deposits', async () => {
      const keys = await getTestMasterKeys();
      const deposits = buildDepositsMap(keys, TEST_SCOPE, [0, 2]);
      // Add some deposits from "other users"
      deposits.set(888888n, {
        commitment: 100n,
        label: 200n,
        value: 5000n,
      });
      deposits.set(999999n, {
        commitment: 101n,
        label: 201n,
        value: 6000n,
      });

      const result = discoverCommitments(keys, TEST_SCOPE, deposits, new Set());

      expect(result).toHaveLength(2);
    });
  });

  describe('spent filtering', () => {
    it('excludes spent commitments', async () => {
      const keys = await getTestMasterKeys();
      const deposits = buildDepositsMap(keys, TEST_SCOPE, [0, 1, 2]);

      // Mark deposit 1 as spent
      const spentNullifier = getNullifierHash(keys, TEST_SCOPE, 1);
      const spent = new Set([spentNullifier]);

      const result = discoverCommitments(keys, TEST_SCOPE, deposits, spent);

      expect(result).toHaveLength(2);
      const indices = result.map((c) => c.depositIndex);
      expect(indices).not.toContain(1n);
    });

    it('returns empty when all commitments are spent', async () => {
      const keys = await getTestMasterKeys();
      const deposits = buildDepositsMap(keys, TEST_SCOPE, [0, 1]);

      const spent = new Set([
        getNullifierHash(keys, TEST_SCOPE, 0),
        getNullifierHash(keys, TEST_SCOPE, 1),
      ]);

      const result = discoverCommitments(keys, TEST_SCOPE, deposits, spent);

      expect(result).toHaveLength(0);
    });

    it('does not filter by unrelated nullifiers', async () => {
      const keys = await getTestMasterKeys();
      const deposits = buildDepositsMap(keys, TEST_SCOPE, [0]);

      // Spent nullifiers from other users
      const spent = new Set([11111n, 22222n, 33333n]);

      const result = discoverCommitments(keys, TEST_SCOPE, deposits, spent);

      expect(result).toHaveLength(1);
    });
  });

  describe('gap limit', () => {
    it('stops scanning after consecutive misses', async () => {
      const keys = await getTestMasterKeys();
      // Deposit at index 0 only; gap limit 5 means stops at index 5
      const deposits = buildDepositsMap(keys, TEST_SCOPE, [0]);

      const result = discoverCommitments(
        keys,
        TEST_SCOPE,
        deposits,
        new Set(),
        { gapLimit: 5, maxIndex: 1000 }
      );

      // Should find only index 0, stop after 5 misses (indices 1-5)
      expect(result).toHaveLength(1);
    });

    it('does not stop on gap before finding any deposit', async () => {
      const keys = await getTestMasterKeys();
      // Deposit at index 25 only, gap limit 20
      const deposits = buildDepositsMap(keys, TEST_SCOPE, [25]);

      const result = discoverCommitments(
        keys,
        TEST_SCOPE,
        deposits,
        new Set(),
        { gapLimit: 20, maxIndex: 100 }
      );

      // Should find index 25 (gap limit doesn't apply before first find)
      expect(result).toHaveLength(1);
      expect(result[0].depositIndex).toBe(25n);
    });

    it('resets gap counter on each find', async () => {
      const keys = await getTestMasterKeys();
      // Deposits at 0 and 15 with gap limit 20
      const deposits = buildDepositsMap(keys, TEST_SCOPE, [0, 15]);

      const result = discoverCommitments(
        keys,
        TEST_SCOPE,
        deposits,
        new Set(),
        { gapLimit: 20, maxIndex: 100 }
      );

      expect(result).toHaveLength(2);
    });

    it('respects gapLimit: 0 to scan all indices', async () => {
      const keys = await getTestMasterKeys();
      // Deposits at 0 and 90 with gapLimit disabled
      const deposits = buildDepositsMap(keys, TEST_SCOPE, [0, 90]);

      const result = discoverCommitments(
        keys,
        TEST_SCOPE,
        deposits,
        new Set(),
        { gapLimit: 0, maxIndex: 100 }
      );

      expect(result).toHaveLength(2);
    });
  });

  describe('maxIndex', () => {
    it('limits scanning range', async () => {
      const keys = await getTestMasterKeys();
      // Deposit at index 50, but maxIndex is 10
      const deposits = buildDepositsMap(keys, TEST_SCOPE, [50]);

      const result = discoverCommitments(
        keys,
        TEST_SCOPE,
        deposits,
        new Set(),
        { maxIndex: 10 }
      );

      expect(result).toHaveLength(0);
    });

    it('defaults to 100', async () => {
      const keys = await getTestMasterKeys();
      // Deposit at index 99 (within default maxIndex of 100)
      const deposits = buildDepositsMap(keys, TEST_SCOPE, [99]);

      const result = discoverCommitments(
        keys,
        TEST_SCOPE,
        deposits,
        new Set(),
        { gapLimit: 0 }
      );

      expect(result).toHaveLength(1);
    });
  });

  describe('output shape', () => {
    it('returns commitments sorted descending by value', async () => {
      const keys = await getTestMasterKeys();
      const deposits = new Map<bigint, DepositRecord>();

      // Create deposits with different values
      for (const [i, value] of [
        [0, 500n],
        [1, 1000n],
        [2, 200n],
      ] as const) {
        const secrets = deriveDepositSecrets(keys, TEST_SCOPE, BigInt(i));
        const precommitment = computePrecommitment(
          secrets.nullifier as bigint,
          secrets.secret as bigint
        );
        deposits.set(precommitment, {
          commitment: BigInt(i) * 1000n + 1n,
          label: BigInt(i) * 1000n + 2n,
          value,
        });
      }

      const result = discoverCommitments(keys, TEST_SCOPE, deposits, new Set());

      expect(result).toHaveLength(3);
      expect(result[0].value).toBe(1000n);
      expect(result[1].value).toBe(500n);
      expect(result[2].value).toBe(200n);
    });

    it('sets withdrawalIndex to 0 for original deposits', async () => {
      const keys = await getTestMasterKeys();
      const deposits = buildDepositsMap(keys, TEST_SCOPE, [0, 1]);

      const result = discoverCommitments(keys, TEST_SCOPE, deposits, new Set());

      for (const c of result) {
        expect(c.withdrawalIndex).toBe(0n);
      }
    });

    it('preserves deposit commitment and label', async () => {
      const keys = await getTestMasterKeys();
      const secrets = deriveDepositSecrets(keys, TEST_SCOPE, 0n);
      const precommitment = computePrecommitment(
        secrets.nullifier as bigint,
        secrets.secret as bigint
      );

      const deposits = new Map<bigint, DepositRecord>();
      deposits.set(precommitment, {
        commitment: 42n,
        label: 99n,
        value: 1000n,
      });

      const result = discoverCommitments(keys, TEST_SCOPE, deposits, new Set());

      expect(result).toHaveLength(1);
      expect(result[0].commitment).toBe(42n);
      expect(result[0].label).toBe(99n);
      expect(result[0].value).toBe(1000n);
      expect(result[0].depositIndex).toBe(0n);
    });
  });

  describe('scope isolation', () => {
    it('does not find deposits from a different scope', async () => {
      const keys = await getTestMasterKeys();
      const otherScope = 99999n;

      // Deposits made under otherScope
      const deposits = buildDepositsMap(keys, otherScope, [0, 1]);

      // Discover with TEST_SCOPE — should find nothing
      const result = discoverCommitments(keys, TEST_SCOPE, deposits, new Set());

      expect(result).toHaveLength(0);
    });
  });

  describe('ASP label filtering', () => {
    it('excludes deposits not in ASP labels set', async () => {
      const keys = await getTestMasterKeys();
      const deposits = buildDepositsMap(keys, TEST_SCOPE, [0, 1, 2]);

      // Only deposit 1's label is ASP-approved
      const dep1Label = deposits.values().next().value!; // get any deposit
      // Build a set with only the label from deposit index 1
      const dep1Secrets = deriveDepositSecrets(keys, TEST_SCOPE, 1n);
      const dep1Precommitment = computePrecommitment(
        dep1Secrets.nullifier as bigint,
        dep1Secrets.secret as bigint
      );
      const dep1Record = deposits.get(dep1Precommitment)!;
      const aspLabels = new Set([dep1Record.label]);

      const result = discoverCommitments(
        keys,
        TEST_SCOPE,
        deposits,
        new Set(),
        {
          gapLimit: 0,
          aspLabels,
        }
      );

      expect(result).toHaveLength(1);
      expect(result[0].label).toBe(dep1Record.label);
    });

    it('returns all deposits when aspLabels is not provided', async () => {
      const keys = await getTestMasterKeys();
      const deposits = buildDepositsMap(keys, TEST_SCOPE, [0, 1, 2]);

      const result = discoverCommitments(
        keys,
        TEST_SCOPE,
        deposits,
        new Set(),
        {
          gapLimit: 0,
        }
      );

      expect(result).toHaveLength(3);
    });

    it('returns empty when no deposits are ASP-approved', async () => {
      const keys = await getTestMasterKeys();
      const deposits = buildDepositsMap(keys, TEST_SCOPE, [0, 1]);

      const aspLabels = new Set([999999999n]); // no deposit has this label

      const result = discoverCommitments(
        keys,
        TEST_SCOPE,
        deposits,
        new Set(),
        {
          gapLimit: 0,
          aspLabels,
        }
      );

      expect(result).toHaveLength(0);
    });
  });

  describe('change commitment discovery', () => {
    /**
     * Simulate a partial withdrawal: build the deposits map, the
     * withdrawals map, and return everything needed for discovery.
     */
    async function simulatePartialWithdrawal(opts: {
      depositValue: bigint;
      withdrawnAmount: bigint;
      depositIndex: number;
    }) {
      const keys = await getTestMasterKeys();
      const { depositValue, withdrawnAmount, depositIndex } = opts;
      const idx = BigInt(depositIndex);

      // Build the original deposit
      const depositSecrets = deriveDepositSecrets(keys, TEST_SCOPE, idx);
      const precommitment = computePrecommitment(
        depositSecrets.nullifier as bigint,
        depositSecrets.secret as bigint
      );
      const depositLabel = idx * 1000n + 2n;
      const deposits = new Map<bigint, DepositRecord>();
      deposits.set(precommitment, {
        commitment: idx * 1000n + 1n,
        label: depositLabel,
        value: depositValue,
      });

      // Compute the nullifier hash (what appears in Withdrawn event)
      const nullifierHash = computeNullifierHash(
        depositSecrets.nullifier as bigint
      );

      // Derive the change commitment (created by the pool contract)
      const remainingValue = depositValue - withdrawnAmount;
      const changeSecrets = deriveWithdrawalSecrets(keys, depositLabel, 0n);
      const changeCommitment = buildCommitment(
        remainingValue,
        depositLabel,
        changeSecrets.nullifier as bigint,
        changeSecrets.secret as bigint
      );

      // Build the withdrawals map
      const withdrawals = new Map<bigint, WithdrawalRecord>();
      withdrawals.set(nullifierHash, {
        withdrawnValue: withdrawnAmount,
        newCommitment: changeCommitment.hash as bigint,
      });

      return {
        keys,
        deposits,
        withdrawals,
        depositLabel,
        changeSecrets,
        changeCommitment,
        remainingValue,
      };
    }

    it('discovers change commitment from partial withdrawal', async () => {
      const { keys, deposits, withdrawals, remainingValue } =
        await simulatePartialWithdrawal({
          depositValue: 100n,
          withdrawnAmount: 60n,
          depositIndex: 0,
        });

      const result = discoverCommitments(
        keys,
        TEST_SCOPE,
        deposits,
        withdrawals,
        { gapLimit: 0 }
      );

      expect(result).toHaveLength(1);
      expect(result[0].value).toBe(remainingValue);
      expect(result[0].withdrawalIndex).toBe(1n);
      expect(result[0].depositIndex).toBe(0n);
    });

    it('does not discover change commitment with Set (backwards compat)', async () => {
      const { keys, deposits, withdrawals } = await simulatePartialWithdrawal({
        depositValue: 100n,
        withdrawnAmount: 60n,
        depositIndex: 0,
      });

      // Convert to Set — loses withdrawal details, no change tracing
      const spentSet = new Set(withdrawals.keys());

      const result = discoverCommitments(keys, TEST_SCOPE, deposits, spentSet, {
        gapLimit: 0,
      });

      // Original is spent, change not discoverable without Map
      expect(result).toHaveLength(0);
    });

    it('skips full withdrawal (no change commitment)', async () => {
      const { keys, deposits, withdrawals } = await simulatePartialWithdrawal({
        depositValue: 100n,
        withdrawnAmount: 100n,
        depositIndex: 0,
      });

      const result = discoverCommitments(
        keys,
        TEST_SCOPE,
        deposits,
        withdrawals,
        { gapLimit: 0 }
      );

      // Full withdrawal — no change commitment
      expect(result).toHaveLength(0);
    });

    it('discovers unspent original + change from different deposits', async () => {
      const keys = await getTestMasterKeys();

      // Deposit 0: partially withdrawn
      const dep0Secrets = deriveDepositSecrets(keys, TEST_SCOPE, 0n);
      const dep0Precommitment = computePrecommitment(
        dep0Secrets.nullifier as bigint,
        dep0Secrets.secret as bigint
      );
      const dep0Label = 1000n;
      const dep0NullifierHash = computeNullifierHash(
        dep0Secrets.nullifier as bigint
      );
      const change0Secrets = deriveWithdrawalSecrets(keys, dep0Label, 0n);
      const change0 = buildCommitment(
        40n,
        dep0Label,
        change0Secrets.nullifier as bigint,
        change0Secrets.secret as bigint
      );

      // Deposit 1: unspent
      const dep1Secrets = deriveDepositSecrets(keys, TEST_SCOPE, 1n);
      const dep1Precommitment = computePrecommitment(
        dep1Secrets.nullifier as bigint,
        dep1Secrets.secret as bigint
      );

      const deposits = new Map<bigint, DepositRecord>();
      deposits.set(dep0Precommitment, {
        commitment: 1n,
        label: dep0Label,
        value: 100n,
      });
      deposits.set(dep1Precommitment, {
        commitment: 2n,
        label: 2000n,
        value: 50n,
      });

      const withdrawals = new Map<bigint, WithdrawalRecord>();
      withdrawals.set(dep0NullifierHash, {
        withdrawnValue: 60n,
        newCommitment: change0.hash as bigint,
      });

      const result = discoverCommitments(
        keys,
        TEST_SCOPE,
        deposits,
        withdrawals,
        { gapLimit: 0 }
      );

      expect(result).toHaveLength(2);
      // Sorted by value: 50n (original), 40n (change)
      expect(result[0].value).toBe(50n);
      expect(result[0].withdrawalIndex).toBe(0n);
      expect(result[1].value).toBe(40n);
      expect(result[1].withdrawalIndex).toBe(1n);
    });

    it('traces two-deep change commitment chain', async () => {
      const keys = await getTestMasterKeys();
      const depositIndex = 0n;
      const label = 5000n;

      // Original deposit: 100 wei
      const dep = deriveDepositSecrets(keys, TEST_SCOPE, depositIndex);
      const precommitment = computePrecommitment(
        dep.nullifier as bigint,
        dep.secret as bigint
      );
      const depNullifierHash = computeNullifierHash(dep.nullifier as bigint);

      // First partial withdrawal: 30 from 100 → change of 70
      const change0Secrets = deriveWithdrawalSecrets(keys, label, 0n);
      const change0 = buildCommitment(
        70n,
        label,
        change0Secrets.nullifier as bigint,
        change0Secrets.secret as bigint
      );
      const change0NullifierHash = computeNullifierHash(
        change0Secrets.nullifier as bigint
      );

      // Second partial withdrawal: 20 from 70 → change of 50
      const change1Secrets = deriveWithdrawalSecrets(keys, label, 1n);
      const change1 = buildCommitment(
        50n,
        label,
        change1Secrets.nullifier as bigint,
        change1Secrets.secret as bigint
      );

      const deposits = new Map<bigint, DepositRecord>();
      deposits.set(precommitment, {
        commitment: 1n,
        label,
        value: 100n,
      });

      const withdrawals = new Map<bigint, WithdrawalRecord>();
      withdrawals.set(depNullifierHash, {
        withdrawnValue: 30n,
        newCommitment: change0.hash as bigint,
      });
      withdrawals.set(change0NullifierHash, {
        withdrawnValue: 20n,
        newCommitment: change1.hash as bigint,
      });

      const result = discoverCommitments(
        keys,
        TEST_SCOPE,
        deposits,
        withdrawals,
        { gapLimit: 0 }
      );

      expect(result).toHaveLength(1);
      expect(result[0].value).toBe(50n);
      expect(result[0].withdrawalIndex).toBe(2n);
      expect(result[0].depositIndex).toBe(0n);
    });
  });
});

describe('discoverChangeCommitments', () => {
  it('returns empty when no commitments are spent', async () => {
    const keys = await getTestMasterKeys();

    const result = discoverChangeCommitments(
      keys,
      TEST_SCOPE,
      [{ depositIndex: 0n, withdrawalIndex: 0n, label: 1000n, value: 100n }],
      new Map()
    );

    expect(result).toHaveLength(0);
  });

  it('discovers change commitment from partial withdrawal', async () => {
    const keys = await getTestMasterKeys();
    const label = 1000n;

    // Compute nullifier for deposit index 0
    const secrets = deriveDepositSecrets(keys, TEST_SCOPE, 0n);
    const nullifierHash = computeNullifierHash(secrets.nullifier as bigint);

    // Build the change commitment (what the pool contract created)
    const changeSecrets = deriveWithdrawalSecrets(keys, label, 0n);
    const change = buildCommitment(
      40n,
      label,
      changeSecrets.nullifier as bigint,
      changeSecrets.secret as bigint
    );

    const withdrawals = new Map<bigint, WithdrawalRecord>();
    withdrawals.set(nullifierHash, {
      withdrawnValue: 60n,
      newCommitment: change.hash as bigint,
    });

    const result = discoverChangeCommitments(
      keys,
      TEST_SCOPE,
      [{ depositIndex: 0n, withdrawalIndex: 0n, label, value: 100n }],
      withdrawals
    );

    expect(result).toHaveLength(1);
    expect(result[0].value).toBe(40n);
    expect(result[0].withdrawalIndex).toBe(1n);
    expect(result[0].depositIndex).toBe(0n);
  });

  it('skips change commitments (withdrawalIndex > 0) — traced from original', async () => {
    const keys = await getTestMasterKeys();
    const label = 1000n;

    // Simulate: original (WI=0) spent → change (WI=1) also spent → change (WI=2) unspent
    const dep = deriveDepositSecrets(keys, TEST_SCOPE, 0n);
    const depNullifierHash = computeNullifierHash(dep.nullifier as bigint);

    const change0Secrets = deriveWithdrawalSecrets(keys, label, 0n);
    const change0 = buildCommitment(
      70n,
      label,
      change0Secrets.nullifier as bigint,
      change0Secrets.secret as bigint
    );
    const change0NullifierHash = computeNullifierHash(
      change0Secrets.nullifier as bigint
    );

    const change1Secrets = deriveWithdrawalSecrets(keys, label, 1n);
    const change1 = buildCommitment(
      50n,
      label,
      change1Secrets.nullifier as bigint,
      change1Secrets.secret as bigint
    );

    const withdrawals = new Map<bigint, WithdrawalRecord>();
    withdrawals.set(depNullifierHash, {
      withdrawnValue: 30n,
      newCommitment: change0.hash as bigint,
    });
    withdrawals.set(change0NullifierHash, {
      withdrawnValue: 20n,
      newCommitment: change1.hash as bigint,
    });

    // Provide both the original AND the server-known change commitment
    const commitments = [
      { depositIndex: 0n, withdrawalIndex: 0n, label, value: 100n },
      { depositIndex: 0n, withdrawalIndex: 1n, label, value: 70n },
    ];

    const result = discoverChangeCommitments(
      keys,
      TEST_SCOPE,
      commitments,
      withdrawals
    );

    // Should find WI=2 by tracing from WI=0, skip WI=1
    expect(result).toHaveLength(1);
    expect(result[0].value).toBe(50n);
    expect(result[0].withdrawalIndex).toBe(2n);
  });

  it('skips full withdrawal (no change commitment)', async () => {
    const keys = await getTestMasterKeys();
    const label = 1000n;

    const secrets = deriveDepositSecrets(keys, TEST_SCOPE, 0n);
    const nullifierHash = computeNullifierHash(secrets.nullifier as bigint);

    // Full withdrawal — withdrawn entire value, newCommitment is a zero-value commitment
    const changeSecrets = deriveWithdrawalSecrets(keys, label, 0n);
    const change = buildCommitment(
      0n,
      label,
      changeSecrets.nullifier as bigint,
      changeSecrets.secret as bigint
    );

    const withdrawals = new Map<bigint, WithdrawalRecord>();
    withdrawals.set(nullifierHash, {
      withdrawnValue: 100n,
      newCommitment: change.hash as bigint,
    });

    const result = discoverChangeCommitments(
      keys,
      TEST_SCOPE,
      [{ depositIndex: 0n, withdrawalIndex: 0n, label, value: 100n }],
      withdrawals
    );

    expect(result).toHaveLength(0);
  });

  it('handles multiple deposits with mixed spent/unspent', async () => {
    const keys = await getTestMasterKeys();

    // Deposit 0: spent (partial withdrawal)
    const dep0Label = 1000n;
    const dep0 = deriveDepositSecrets(keys, TEST_SCOPE, 0n);
    const dep0Nullifier = computeNullifierHash(dep0.nullifier as bigint);
    const change0Secrets = deriveWithdrawalSecrets(keys, dep0Label, 0n);
    const change0 = buildCommitment(
      40n,
      dep0Label,
      change0Secrets.nullifier as bigint,
      change0Secrets.secret as bigint
    );

    // Deposit 1: not spent
    const dep1Label = 2000n;

    const withdrawals = new Map<bigint, WithdrawalRecord>();
    withdrawals.set(dep0Nullifier, {
      withdrawnValue: 60n,
      newCommitment: change0.hash as bigint,
    });

    const result = discoverChangeCommitments(
      keys,
      TEST_SCOPE,
      [
        {
          depositIndex: 0n,
          withdrawalIndex: 0n,
          label: dep0Label,
          value: 100n,
        },
        { depositIndex: 1n, withdrawalIndex: 0n, label: dep1Label, value: 50n },
      ],
      withdrawals
    );

    // Only deposit 0's change commitment discovered
    expect(result).toHaveLength(1);
    expect(result[0].value).toBe(40n);
    expect(result[0].depositIndex).toBe(0n);
  });
});
