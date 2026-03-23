/**
 * ZK proof generation and formatting for Privacy Pools.
 *
 * Wraps the 0xbow SDK's proof functions and handles the Groth16
 * proof formatting required by the Solidity verifier (pi_b swap).
 */

import {
  generateMerkleProof,
  calculateContext,
  Circuits,
  PrivacyPoolSDK,
  bigintToHash,
} from '@0xbow/privacy-pools-core-sdk';
import type { MasterKeys } from '@0xbow/privacy-pools-core-sdk';
import type { Address, Hex } from 'viem';
import { deriveWithdrawalSecrets, buildCommitment } from './keys.js';

export interface FormattedProof {
  pA: [bigint, bigint];
  pB: [[bigint, bigint], [bigint, bigint]];
  pC: [bigint, bigint];
  pubSignals: bigint[];
}

/**
 * Format a Groth16 proof for the Solidity verifier.
 * pi_b elements are swapped per the pairing check convention.
 */
export function formatProof(
  proof: any,
  publicSignals: string[]
): FormattedProof {
  return {
    pA: [BigInt(proof.pi_a[0]), BigInt(proof.pi_a[1])],
    pB: [
      [BigInt(proof.pi_b[0][1]), BigInt(proof.pi_b[0][0])],
      [BigInt(proof.pi_b[1][1]), BigInt(proof.pi_b[1][0])],
    ],
    pC: [BigInt(proof.pi_c[0]), BigInt(proof.pi_c[1])],
    pubSignals: publicSignals.map((s) => BigInt(s)),
  };
}

/**
 * Create a PrivacyPoolSDK instance.
 *
 * @param artifactsBaseUrl - URL to the directory containing WASM and zkey files.
 *   For Node.js: file:// URL to node_modules/@0xbow/privacy-pools-core-sdk/dist/node/
 *   For browser: URL to hosted artifacts or a bundled path
 * @param browser - Whether running in a browser environment
 */
export function createSdk(
  artifactsBaseUrl: string,
  browser = false
): PrivacyPoolSDK {
  const circuits = new Circuits({ browser, baseUrl: artifactsBaseUrl });
  return new PrivacyPoolSDK(circuits);
}

/**
 * Generate a commitment proof for ragequit.
 * Simpler than a withdrawal proof — no Merkle proofs needed.
 */
export async function generateCommitmentProof(
  sdk: PrivacyPoolSDK,
  value: bigint,
  label: bigint,
  nullifier: bigint,
  secret: bigint
): Promise<{ proof: FormattedProof; raw: any }> {
  const commitmentProof = await sdk.proveCommitment(
    value,
    label,
    nullifier,
    secret
  );

  return {
    proof: formatProof(commitmentProof.proof, commitmentProof.publicSignals),
    raw: commitmentProof,
  };
}

/**
 * Generate a full withdrawal proof.
 * Requires Merkle proofs for both the state tree and ASP tree.
 *
 * @param params.data - Optional withdrawal data (hex). For direct withdrawals
 *   this is '0x' (the default). For relayed withdrawals via Entrypoint.relay(),
 *   this must be the ABI-encoded RelayData struct so the context hash matches.
 */
export async function generateWithdrawalProof(
  sdk: PrivacyPoolSDK,
  params: {
    masterKeys: MasterKeys;
    value: bigint;
    label: bigint;
    nullifier: bigint;
    secret: bigint;
    scope: bigint;
    stateLeaves: bigint[];
    aspLeaves: bigint[];
    recipient: Address;
    /** Withdrawal data field. Defaults to '0x' for direct withdrawals.
     *  For relayed withdrawals, pass the ABI-encoded RelayData. */
    data?: Hex;
  }
): Promise<{ proof: FormattedProof; raw: any }> {
  const commitment = buildCommitment(
    params.value,
    params.label,
    params.nullifier,
    params.secret
  );

  const stateMerkleProof = generateMerkleProof(
    params.stateLeaves,
    commitment.hash
  );
  const aspMerkleProof = generateMerkleProof(params.aspLeaves, params.label);

  const { nullifier: newNullifier, secret: newSecret } =
    deriveWithdrawalSecrets(params.masterKeys, params.label, 0n);

  const scopeHash = bigintToHash(params.scope);
  const withdrawal = {
    processooor: params.recipient,
    data: params.data ?? ('0x' as Hex),
  };
  const context = calculateContext(withdrawal, scopeHash);

  const withdrawalProofInput = {
    context: BigInt(context),
    withdrawalAmount: params.value,
    stateMerkleProof,
    aspMerkleProof,
    stateRoot: stateMerkleProof.root as any,
    stateTreeDepth: BigInt(stateMerkleProof.siblings.length),
    aspRoot: aspMerkleProof.root as any,
    aspTreeDepth: BigInt(aspMerkleProof.siblings.length),
    newSecret,
    newNullifier,
  };

  const withdrawalProof = await sdk.proveWithdrawal(
    commitment,
    withdrawalProofInput
  );

  return {
    proof: formatProof(withdrawalProof.proof, withdrawalProof.publicSignals),
    raw: withdrawalProof,
  };
}

export { generateMerkleProof, calculateContext };
