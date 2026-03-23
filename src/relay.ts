/**
 * Relayed withdrawal helpers.
 *
 * Privacy Pools supports two withdrawal modes:
 *   - Direct: user calls Pool.withdraw() as msg.sender == processooor
 *   - Relayed: anyone calls Entrypoint.relay(), processooor = entrypoint,
 *     and the entrypoint forwards funds to the actual recipient
 *
 * This module provides helpers for the relayed mode, which is what
 * Cloaked uses (our relay wallet submits the tx, not the user).
 */

import {
  type Address,
  type Hex,
  encodeFunctionData,
  encodeAbiParameters,
} from 'viem';
import type { PrivacyPoolSDK, MasterKeys } from '@0xbow/privacy-pools-core-sdk';
import { ENTRYPOINT_ABI } from './abi.js';
import { generateWithdrawalProof, type FormattedProof } from './proofs.js';
import { deriveDepositSecrets, deriveWithdrawalSecrets } from './keys.js';

/**
 * Encode the RelayData struct for the withdrawal's data field.
 *
 * @param recipient - Final recipient of the withdrawn funds
 * @param feeRecipient - Address that receives the relay fee (zero address for no fee)
 * @param relayFeeBPS - Relay fee in basis points (0 for no fee)
 */
export function encodeRelayData(
  recipient: Address,
  feeRecipient: Address = '0x0000000000000000000000000000000000000000',
  relayFeeBPS: bigint = 0n
): Hex {
  return encodeAbiParameters(
    [
      { name: 'recipient', type: 'address' },
      { name: 'feeRecipient', type: 'address' },
      { name: 'relayFeeBPS', type: 'uint256' },
    ],
    [recipient, feeRecipient, relayFeeBPS]
  );
}

/**
 * Build the complete calldata for a relayed withdrawal via Entrypoint.relay().
 *
 * Generates the ZK proof (with the entrypoint as processooor and the
 * encoded RelayData in the withdrawal's data field), then encodes the
 * Entrypoint.relay() calldata ready for submission.
 *
 * @returns The hex-encoded calldata to send to the Entrypoint contract.
 */
export async function buildRelayedWithdrawalCalldata(
  sdk: PrivacyPoolSDK,
  params: {
    masterKeys: MasterKeys;
    /** On-chain commitment value (wei). */
    value: bigint;
    /** On-chain commitment label. */
    label: bigint;
    /** Deposit index (for deriving secrets on original deposits). */
    depositIndex: bigint;
    /** Withdrawal index (0 for original deposits, >0 for change commitments). */
    withdrawalIndex: number;
    /** Pool scope (precomputed from pool address + chain + asset). */
    scope: bigint;
    /** All state tree leaves in insertion order. */
    stateLeaves: bigint[];
    /** ASP-approved labels. */
    aspLeaves: bigint[];
    /** Entrypoint contract address (becomes the processooor). */
    entrypointAddress: Address;
    /** Final recipient address (encoded in RelayData). */
    recipientAddress: Address;
    /** Optional relay fee recipient. Defaults to zero address (no fee). */
    feeRecipient?: Address;
    /** Optional relay fee in basis points. Defaults to 0. */
    relayFeeBPS?: bigint;
  }
): Promise<Hex> {
  // Derive the correct secrets based on whether this is an original
  // deposit or a change commitment from a prior partial withdrawal.
  const secrets =
    params.withdrawalIndex === 0
      ? deriveDepositSecrets(
          params.masterKeys,
          params.scope,
          params.depositIndex
        )
      : deriveWithdrawalSecrets(
          params.masterKeys,
          params.label,
          BigInt(params.withdrawalIndex)
        );

  // Encode the relay data for the withdrawal struct's data field
  const relayData = encodeRelayData(
    params.recipientAddress,
    params.feeRecipient,
    params.relayFeeBPS
  );

  // Generate the ZK proof with entrypoint as processooor and relay data
  const { proof } = await generateWithdrawalProof(sdk, {
    masterKeys: params.masterKeys,
    value: params.value,
    label: params.label,
    nullifier: secrets.nullifier,
    secret: secrets.secret,
    scope: params.scope,
    stateLeaves: params.stateLeaves,
    aspLeaves: params.aspLeaves,
    recipient: params.entrypointAddress,
    data: relayData,
  });

  // Encode Entrypoint.relay() calldata
  return encodeFunctionData({
    abi: ENTRYPOINT_ABI,
    functionName: 'relay',
    args: [
      {
        processooor: params.entrypointAddress,
        data: relayData,
      },
      // FormattedProof.pubSignals is bigint[] but the ABI expects uint256[8]
      proof as any,
      params.scope,
    ],
  });
}
