/**
 * Fee calculation for Privacy Pools deposits.
 *
 * The pool deducts a vetting fee from the deposited amount.
 * To get an exact pool value, the user must send amount + fee.
 */

import type { Address, PublicClient } from 'viem';
import { ENTRYPOINT_ABI } from './abi.js';

export interface AssetFeeConfig {
  poolAddress: Address;
  minimumDepositAmount: bigint;
  vettingFeeBPS: bigint;
  maxRelayFeeBPS: bigint;
}

/**
 * Query the on-chain fee configuration for an asset.
 */
export async function getAssetFeeConfig(
  client: PublicClient,
  entrypointAddress: Address,
  assetAddress: Address
): Promise<AssetFeeConfig> {
  const [pool, minimumDepositAmount, vettingFeeBPS, maxRelayFeeBPS] =
    (await client.readContract({
      address: entrypointAddress,
      abi: ENTRYPOINT_ABI,
      functionName: 'assetConfig',
      args: [assetAddress],
    })) as [string, bigint, bigint, bigint];

  return {
    poolAddress: pool as Address,
    minimumDepositAmount,
    vettingFeeBPS,
    maxRelayFeeBPS,
  };
}

/**
 * Calculate the gross deposit amount needed to achieve a desired pool value.
 *
 * grossAmount = desiredPoolValue / (1 - feeBPS / 10000)
 *             = desiredPoolValue * 10000 / (10000 - feeBPS)
 *
 * Example (Sepolia, 100 BPS = 1%):
 *   desired 0.01 ETH → gross 0.010101... ETH → pool records 0.01 ETH
 *
 * Example (Mainnet, 50 BPS = 0.5%):
 *   desired 0.01 ETH → gross 0.010050... ETH → pool records 0.01 ETH
 */
export function calculateGrossDeposit(
  desiredPoolValue: bigint,
  feeBPS: bigint
): bigint {
  return (desiredPoolValue * 10000n) / (10000n - feeBPS);
}

/**
 * Calculate the fee amount for a given gross deposit.
 */
export function calculateFeeAmount(
  grossDeposit: bigint,
  feeBPS: bigint
): bigint {
  return (grossDeposit * feeBPS) / 10000n;
}

/**
 * Calculate the net pool value after fee deduction.
 */
export function calculateNetPoolValue(
  grossDeposit: bigint,
  feeBPS: bigint
): bigint {
  return grossDeposit - calculateFeeAmount(grossDeposit, feeBPS);
}
