import { describe, it, expect } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';
import {
  deriveMnemonic,
  deriveMasterKeys,
  deriveDepositSecrets,
  computePrecommitment,
  computeNullifierHash,
} from '../src/keys';
import { discoverCommitments } from '../src/discovery';
import type { DepositRecord } from '../src/scanner';

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
});
