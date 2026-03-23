/**
 * Per-chain Privacy Pools deployment configuration.
 *
 * Addresses sourced from:
 * https://github.com/0xmatthewb/privacy-pools-core/blob/docs-ai-visibility/docs/docs/deployments.md
 *
 * Pool scope values are precomputed from the contract's constructor formula:
 *   SCOPE = uint256(keccak256(abi.encodePacked(address(this), block.chainid, _asset))) % SNARK_SCALAR_FIELD
 * and verified against the deployed contracts in config.live.test.ts.
 */

import { type Address, keccak256, encodePacked } from 'viem';

/**
 * BN254 scalar field — matches Constants.SNARK_SCALAR_FIELD in the Privacy Pools contracts.
 */
const SNARK_SCALAR_FIELD =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

/**
 * Compute a pool's SCOPE value using the same formula as the Solidity constructor.
 *
 * SCOPE = uint256(keccak256(abi.encodePacked(poolAddress, chainId, assetAddress))) % SNARK_SCALAR_FIELD
 */
export function computeScope(
  poolAddress: Address,
  chainId: number,
  assetAddress: Address
): bigint {
  const hash = keccak256(
    encodePacked(
      ['address', 'uint256', 'address'],
      [poolAddress, BigInt(chainId), assetAddress]
    )
  );
  return BigInt(hash) % SNARK_SCALAR_FIELD;
}

export interface PoolConfig {
  address: Address;
  type: 'simple' | 'complex';
  assetAddress: Address;
  /** Precomputed pool scope — keccak256(poolAddress, chainId, assetAddress) % SNARK_SCALAR_FIELD */
  scope: bigint;
}

export interface ChainConfig {
  chainId: number;
  entrypoint: Address;
  startBlock: bigint;
  aspApiBase: string;
  relayerApiBase: string;
  pools: Record<string, PoolConfig>;
}

const ETH_ASSET = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE' as Address;

export const CHAIN_CONFIGS: Record<number, ChainConfig> = {
  // Ethereum Mainnet
  1: {
    chainId: 1,
    entrypoint: '0x6818809eefce719e480a7526d76bd3e561526b46',
    startBlock: 22153714n,
    aspApiBase: 'https://api.0xbow.io',
    relayerApiBase: 'https://fastrelay.xyz',
    pools: {
      ETH: {
        address: '0xf241d57c6debae225c0f2e6ea1529373c9a9c9fb',
        type: 'simple',
        assetAddress: ETH_ASSET,
        scope: computeScope(
          '0xf241d57c6debae225c0f2e6ea1529373c9a9c9fb',
          1,
          ETH_ASSET
        ),
      },
      USDC: {
        address: '0xb419c2867ab3cbc78921660cb95150d95a94ce86',
        type: 'complex',
        assetAddress: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
        scope: computeScope(
          '0xb419c2867ab3cbc78921660cb95150d95a94ce86',
          1,
          '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'
        ),
      },
    },
  },

  // Sepolia Testnet
  11155111: {
    chainId: 11155111,
    entrypoint: '0x34a2068192b1297f2a7f85d7d8cde66f8f0921cb',
    startBlock: 8461454n,
    aspApiBase: 'https://dw.0xbow.io',
    relayerApiBase: 'https://testnet-relayer.privacypools.com',
    pools: {
      ETH: {
        address: '0x644d5a2554d36e27509254f32ccfebe8cd58861f',
        type: 'simple',
        assetAddress: ETH_ASSET,
        scope: computeScope(
          '0x644d5a2554d36e27509254f32ccfebe8cd58861f',
          11155111,
          ETH_ASSET
        ),
      },
      USDC: {
        address: '0x0b062fe33c4f1592d8ea63f9a0177fca44374c0f',
        type: 'complex',
        assetAddress: '0x1c7d4b196cb0c7b01d743fbc6116a902379c7238',
        scope: computeScope(
          '0x0b062fe33c4f1592d8ea63f9a0177fca44374c0f',
          11155111,
          '0x1c7d4b196cb0c7b01d743fbc6116a902379c7238'
        ),
      },
      USDT: {
        address: '0x6709277e170dee3e54101cdb73a450e392adff54',
        type: 'complex',
        assetAddress: '0xaa8e23fb1079ea71e0a56f48a2aa51851d8433d0',
        scope: computeScope(
          '0x6709277e170dee3e54101cdb73a450e392adff54',
          11155111,
          '0xaa8e23fb1079ea71e0a56f48a2aa51851d8433d0'
        ),
      },
    },
  },
};

export function getChainConfig(chainId: number): ChainConfig {
  const config = CHAIN_CONFIGS[chainId];
  if (!config) {
    throw new Error(
      `No Privacy Pools deployment for chain ${chainId}. ` +
        `Supported: ${Object.keys(CHAIN_CONFIGS).join(', ')}`
    );
  }
  return config;
}
