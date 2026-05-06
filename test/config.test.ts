import { describe, it, expect } from 'vitest';
import { getChainConfig, CHAIN_CONFIGS, computeScope } from '../src/config';

describe('getChainConfig', () => {
  it('returns mainnet config', () => {
    const config = getChainConfig(1);
    expect(config.chainId).toBe(1);
    expect(config.entrypoint).toBe(
      '0x6818809eefce719e480a7526d76bd3e561526b46'
    );
    expect(config.pools['ETH']).toBeDefined();
    expect(config.pools['ETH']!.type).toBe('simple');
    expect(config.pools['USDC']).toBeDefined();
    expect(config.pools['USDT']).toBeDefined();
    expect(config.aspApiBase).toBe('https://api.0xbow.io');
  });

  it('includes mainnet USDT pool config', () => {
    const config = getChainConfig(1);
    const pool = config.pools['USDT'];

    expect(pool).toMatchObject({
      address: '0xe859c0bd25f260baee534fb52e307d3b64d24572',
      type: 'complex',
      assetAddress: '0xdac17f958d2ee523a2206206994597c13d831ec7',
    });
    expect(pool!.scope).toBe(
      computeScope(
        '0xe859c0bd25f260baee534fb52e307d3b64d24572',
        1,
        '0xdac17f958d2ee523a2206206994597c13d831ec7'
      )
    );
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
        expect(pool.scope).toBeTypeOf('bigint');
        expect(pool.scope).toBeGreaterThan(0n);
      }
    }
  });
});

describe('computeScope', () => {
  it('matches the Solidity formula: keccak256(poolAddress, chainId, asset) % SNARK_SCALAR_FIELD', () => {
    // Sepolia ETH pool — verified against on-chain SCOPE()
    const scope = computeScope(
      '0x644d5a2554d36e27509254f32ccfebe8cd58861f',
      11155111,
      '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE'
    );
    expect(scope).toBe(
      13541713702858359530363969798588891965037210808099002426745892519913535247342n
    );
  });

  it('is deterministic — same inputs always produce same scope', () => {
    const a = computeScope(
      '0x644d5a2554d36e27509254f32ccfebe8cd58861f',
      11155111,
      '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE'
    );
    const b = computeScope(
      '0x644d5a2554d36e27509254f32ccfebe8cd58861f',
      11155111,
      '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE'
    );
    expect(a).toBe(b);
  });

  it('different pool addresses produce different scopes', () => {
    const a = computeScope(
      '0x644d5a2554d36e27509254f32ccfebe8cd58861f',
      11155111,
      '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE'
    );
    const b = computeScope(
      '0x0b062fe33c4f1592d8ea63f9a0177fca44374c0f',
      11155111,
      '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE'
    );
    expect(a).not.toBe(b);
  });

  it('different chain IDs produce different scopes', () => {
    const a = computeScope(
      '0x644d5a2554d36e27509254f32ccfebe8cd58861f',
      1,
      '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE'
    );
    const b = computeScope(
      '0x644d5a2554d36e27509254f32ccfebe8cd58861f',
      11155111,
      '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE'
    );
    expect(a).not.toBe(b);
  });

  it('precomputed scopes in CHAIN_CONFIGS match computeScope output', () => {
    for (const config of Object.values(CHAIN_CONFIGS)) {
      for (const [, pool] of Object.entries(config.pools)) {
        const expected = computeScope(
          pool.address,
          config.chainId,
          pool.assetAddress
        );
        expect(pool.scope).toBe(expected);
      }
    }
  });
});
