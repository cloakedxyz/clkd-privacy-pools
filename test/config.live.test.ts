/**
 * Live on-chain verification of deployment configuration.
 * Verifies every address, scope, and cross-reference in CHAIN_CONFIGS
 * against the actual deployed contracts.
 */
import { describe, it, expect } from 'vitest';
import { createPublicClient, http, getAddress } from 'viem';
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

describe('on-chain address verification', () => {
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
      it(`${config.chainId}: ${asset} pool has deployed bytecode`, async () => {
        const code = await client.getCode({
          address: pool.address as `0x${string}`,
        });
        expect(code).toBeDefined();
        expect(code!.length).toBeGreaterThan(2); // more than just '0x'
      });

      it(`${config.chainId}: ${asset} precomputed scope matches on-chain SCOPE()`, async () => {
        const onChainScope = await client.readContract({
          address: pool.address as `0x${string}`,
          abi: POOL_ABI,
          functionName: 'SCOPE',
        });
        expect(pool.scope).toBe(onChainScope);
      });

      it(`${config.chainId}: ${asset} pool ASSET() matches configured assetAddress`, async () => {
        const onChainAsset = await client.readContract({
          address: pool.address as `0x${string}`,
          abi: POOL_ABI,
          functionName: 'ASSET',
        });
        expect(getAddress(onChainAsset as string)).toBe(
          getAddress(pool.assetAddress)
        );
      });

      it(`${config.chainId}: ${asset} entrypoint assetConfig routes to configured pool`, async () => {
        const [poolFromEntrypoint] = (await client.readContract({
          address: config.entrypoint,
          abi: ENTRYPOINT_ABI,
          functionName: 'assetConfig',
          args: [pool.assetAddress],
        })) as [string, bigint, bigint, bigint];
        expect(getAddress(poolFromEntrypoint)).toBe(getAddress(pool.address));
      });
    }
  }
});
