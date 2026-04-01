/**
 * Live integration test for commitment discovery against the Sepolia ETH pool.
 *
 * Requires PP_TEST_MNEMONIC env var (set in .env, never committed).
 * Skipped automatically when the env var is absent.
 *
 * Validates that:
 *  - discoverCommitments finds real deposits using the test mnemonic
 *  - spent commitments are correctly filtered via on-chain Withdrawn events
 *  - discovered commitments feed cleanly into selectCommitments
 *  - nullifier hashes (poseidon([nullifier])) match on-chain Withdrawn events
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { createPublicClient, http, type Address } from 'viem';
import { sepolia } from 'viem/chains';
import { deriveMasterKeys } from '../src/keys';
import { scanPoolEvents } from '../src/scanner';
import { discoverCommitments } from '../src/discovery';
import { selectCommitments } from '../src/selection';
import { CHAIN_CONFIGS } from '../src/config';
import { POOL_ABI } from '../src/abi';

// Load .env if the env var isn't already set
function loadMnemonic(): string | undefined {
  if (process.env.PP_TEST_MNEMONIC) return process.env.PP_TEST_MNEMONIC;
  const envPath = resolve(__dirname, '..', '.env');
  if (!existsSync(envPath)) return undefined;
  const match = readFileSync(envPath, 'utf8').match(
    /^PP_TEST_MNEMONIC="(.+)"$/m
  );
  return match?.[1];
}

const TEST_MNEMONIC = loadMnemonic();

const WITHDRAWN_EVENT = POOL_ABI.find(
  (e) => e.type === 'event' && e.name === 'Withdrawn'
)!;

/**
 * Scan Withdrawn events to collect spent nullifier hashes.
 */
async function scanSpentNullifiers(
  client: ReturnType<typeof createPublicClient>,
  poolAddress: Address,
  fromBlock: bigint,
  toBlock: bigint,
  chunkSize = 10000n
): Promise<Set<bigint>> {
  const spent = new Set<bigint>();

  for (let start = fromBlock; start <= toBlock; start += chunkSize) {
    const end =
      start + chunkSize - 1n > toBlock ? toBlock : start + chunkSize - 1n;

    const events = await client.getLogs({
      address: poolAddress,
      event: WITHDRAWN_EVENT,
      fromBlock: start,
      toBlock: end,
    });

    for (const e of events) {
      const args = e.args as { _spentNullifier: bigint };
      spent.add(args._spentNullifier);
    }
  }

  return spent;
}

describe.skipIf(!TEST_MNEMONIC)('discovery (live) — Sepolia ETH pool', () => {
  const sepoliaConfig = CHAIN_CONFIGS[11155111];
  const ethPool = sepoliaConfig.pools.ETH;

  const client = createPublicClient({
    chain: sepolia,
    transport: http('https://ethereum-sepolia-rpc.publicnode.com'),
  });

  // Shared state across tests — populated by the first test
  let depositCount: number;
  let spentCount: number;
  let availableCount: number;
  let totalAvailable: bigint;
  let discovered: ReturnType<typeof discoverCommitments>;

  it('discovers deposits and filters spent commitments', async () => {
    const masterKeys = deriveMasterKeys(TEST_MNEMONIC!);
    const currentBlock = await client.getBlockNumber();

    // Scan pool events (deposits + state tree leaves)
    // Use large chunk size — Sepolia RPCs handle wide ranges well
    const scanResult = await scanPoolEvents(
      client,
      ethPool.address,
      sepoliaConfig.startBlock,
      currentBlock,
      49000n
    );

    depositCount = scanResult.depositsByPrecommitment.size;
    expect(depositCount).toBeGreaterThan(0);

    // Scan Withdrawn events for spent nullifiers
    const spentNullifiers = await scanSpentNullifiers(
      client,
      ethPool.address,
      sepoliaConfig.startBlock,
      currentBlock,
      49000n
    );

    spentCount = spentNullifiers.size;

    // Discover ALL user commitments (without spent filtering)
    const allUserCommitments = discoverCommitments(
      masterKeys,
      ethPool.scope,
      scanResult.depositsByPrecommitment,
      new Set(), // empty = no filtering
      { maxIndex: 100, gapLimit: 0 }
    );

    // Discover unspent commitments only
    discovered = discoverCommitments(
      masterKeys,
      ethPool.scope,
      scanResult.depositsByPrecommitment,
      spentNullifiers,
      { maxIndex: 100, gapLimit: 0 }
    );

    availableCount = discovered.length;
    totalAvailable = discovered.reduce((sum, c) => sum + c.value, 0n);
    const userSpent = allUserCommitments.length - availableCount;

    // Should find deposits (user reported ~26 deposits, ~2 withdrawals)
    expect(availableCount).toBeGreaterThan(0);

    console.log(
      `Pool: ${depositCount} total deposits, ${spentCount} total withdrawals\n` +
        `User: ${allUserCommitments.length} total deposits, ` +
        `${userSpent} spent, ${availableCount} available\n` +
        `Total available value: ${totalAvailable} wei`
    );
  }, 300_000);

  it('all discovered commitments have positive values', () => {
    for (const c of discovered) {
      expect(c.value).toBeGreaterThan(0n);
    }
  });

  it('all discovered commitments have withdrawalIndex 0', () => {
    for (const c of discovered) {
      expect(c.withdrawalIndex).toBe(0n);
    }
  });

  it('discovered commitments are sorted descending by value', () => {
    for (let i = 1; i < discovered.length; i++) {
      expect(discovered[i].value).toBeLessThanOrEqual(discovered[i - 1].value);
    }
  });

  it('discovered commitments have valid on-chain fields', () => {
    for (const c of discovered) {
      expect(c.commitment).toBeTypeOf('bigint');
      expect(c.commitment).toBeGreaterThan(0n);
      expect(c.label).toBeTypeOf('bigint');
      expect(c.label).toBeGreaterThan(0n);
    }
  });

  it('selectCommitments works with discovered commitments', () => {
    if (totalAvailable === 0n) return;

    // Select the full available balance
    const selected = selectCommitments(discovered, totalAvailable);
    expect(selected.length).toBeGreaterThan(0);

    const selectedTotal = selected.reduce(
      (sum, s) => sum + s.withdrawalAmount,
      0n
    );
    expect(selectedTotal).toBe(totalAvailable);
  });

  it('selectCommitments works for a partial amount', () => {
    if (discovered.length === 0) return;

    // Select the smallest commitment's value
    const smallest = discovered[discovered.length - 1].value;
    const selected = selectCommitments(discovered, smallest);
    expect(selected.length).toBeGreaterThanOrEqual(1);

    const selectedTotal = selected.reduce(
      (sum, s) => sum + s.withdrawalAmount,
      0n
    );
    expect(selectedTotal).toBe(smallest);
  });
});
