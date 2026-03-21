/**
 * Live on-chain verification of deployment addresses.
 * Skipped in CI — run manually with: pnpm vitest run test/config.live.test.ts
 */
import { describe, it, expect } from 'vitest';
import { createPublicClient, http } from 'viem';
import { mainnet, sepolia } from 'viem/chains';
import { CHAIN_CONFIGS } from '../src/config';
import { POOL_ABI, ENTRYPOINT_ABI } from '../src/abi';

const CHAINS = {
  1: { chain: mainnet, rpc: 'https://ethereum-rpc.publicnode.com' },
  11155111: {
    chain: sepolia,
    rpc: 'https://ethereum-sepolia-rpc.publicnode.com',
  },
} as const;

describe.skipIf(process.env.CI === 'true')(
  'on-chain address verification',
  () => {
    for (const [chainIdStr, config] of Object.entries(CHAIN_CONFIGS)) {
      const chainId = Number(chainIdStr) as keyof typeof CHAINS;
      const chainInfo = CHAINS[chainId];
      if (!chainInfo) continue;

      const client = createPublicClient({
        chain: chainInfo.chain,
        transport: http(chainInfo.rpc),
      });

      it(`${config.chainId}: entrypoint responds to latestRoot()`, async () => {
        const root = await client.readContract({
          address: config.entrypoint,
          abi: ENTRYPOINT_ABI,
          functionName: 'latestRoot',
        });
        expect(root).toBeTypeOf('bigint');
        expect(root).toBeGreaterThan(0n);
      });

      for (const [asset, pool] of Object.entries(config.pools)) {
        it(`${config.chainId}: ${asset} pool responds to SCOPE()`, async () => {
          const scope = await client.readContract({
            address: pool.address as `0x${string}`,
            abi: POOL_ABI,
            functionName: 'SCOPE',
          });
          expect(scope).toBeTypeOf('bigint');
          expect(scope).toBeGreaterThan(0n);
        });
      }
    }
  }
);
