import { describe, it, expect } from 'vitest';
import { getChainConfig, CHAIN_CONFIGS } from '../src/config';

describe('getChainConfig', () => {
  it('returns mainnet config', () => {
    const config = getChainConfig(1);
    expect(config.chainId).toBe(1);
    expect(config.entrypoint).toBe(
      '0x6818809eefce719e480a7526d76bd3e561526b46'
    );
    expect(config.pools['ETH']).toBeDefined();
    expect(config.pools['ETH']!.type).toBe('simple');
    expect(config.aspApiBase).toBe('https://api.0xbow.io');
  });

  it('returns sepolia config', () => {
    const config = getChainConfig(11155111);
    expect(config.chainId).toBe(11155111);
    expect(config.entrypoint).toBe(
      '0x34a2068192b1297f2a7f85d7d8cde66f8f0921cb'
    );
    expect(config.pools['ETH']).toBeDefined();
    expect(config.pools['USDC']).toBeDefined();
    expect(config.pools['USDT']).toBeDefined();
    expect(config.aspApiBase).toBe('https://dw.0xbow.io');
  });

  it('throws for unsupported chain', () => {
    expect(() => getChainConfig(999)).toThrow(
      'No Privacy Pools deployment for chain 999'
    );
  });

  it('all configs have required fields', () => {
    for (const [chainIdStr, config] of Object.entries(CHAIN_CONFIGS)) {
      expect(config.chainId).toBe(Number(chainIdStr));
      expect(config.entrypoint).toMatch(/^0x[a-f0-9]{40}$/);
      expect(config.startBlock).toBeTypeOf('bigint');
      expect(config.aspApiBase).toMatch(/^https:\/\//);
      expect(config.relayerApiBase).toMatch(/^https:\/\//);
      expect(Object.keys(config.pools).length).toBeGreaterThan(0);

      for (const [, pool] of Object.entries(config.pools)) {
        expect(pool.address).toMatch(/^0x[a-f0-9]{40}$/);
        expect(['simple', 'complex']).toContain(pool.type);
        expect(pool.assetAddress).toMatch(/^0x[a-fA-F0-9]{40}$/);
      }
    }
  });
});
