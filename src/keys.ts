/**
 * Privacy Pools key derivation.
 *
 * Derives a deterministic BIP39 mnemonic from a wallet signature,
 * then uses the 0xbow SDK to generate deposit/withdrawal secrets.
 *
 * Flow: wallet signature → keccak256 → 16 bytes entropy → BIP39 mnemonic
 *       mnemonic → masterKeys → depositSecrets(scope, index)
 *
 * The same wallet + same message = same mnemonic = same secrets.
 * Nothing to store — everything re-derives from the wallet.
 */

import { keccak256, hexToBytes, type Hex } from 'viem';
import { english } from 'viem/accounts';
import {
  generateMasterKeys,
  generateDepositSecrets,
  generateWithdrawalSecrets,
  hashPrecommitment,
  bigintToHash,
  getCommitment,
  type MasterKeys,
} from '@0xbow/privacy-pools-core-sdk';

export const PP_SIGN_MESSAGE = 'Cloaked Privacy Pools Key Derivation v1';

/**
 * Minimal BIP39 entropyToMnemonic.
 * Takes 16 bytes of entropy and produces a 12-word mnemonic.
 */
async function entropyToMnemonic(
  entropy: Uint8Array,
  wordlist: string[]
): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', entropy as any);
  const hash = new Uint8Array(hashBuffer);
  const checksumBits = entropy.length / 4;

  let bits = '';
  for (const byte of entropy) bits += byte.toString(2).padStart(8, '0');
  for (let i = 0; i < Math.ceil(checksumBits / 8); i++) {
    bits += hash[i].toString(2).padStart(8, '0');
  }
  bits = bits.slice(0, entropy.length * 8 + checksumBits);

  const words: string[] = [];
  for (let i = 0; i < bits.length; i += 11) {
    words.push(wordlist[parseInt(bits.slice(i, i + 11), 2)]);
  }
  return words.join(' ');
}

/**
 * Derive a Privacy Pools mnemonic from a wallet signature.
 *
 * In the Cloaked app, the signature comes from:
 * - Wallet + PIN flow: wallet signs a PIN-derived message
 * - PRF flow: same wallet signature, different auth to unlock it
 *
 * The signature is hashed to produce 16 bytes of entropy,
 * which is converted to a 12-word BIP39 mnemonic.
 */
export async function deriveMnemonic(signature: Hex): Promise<string> {
  const sigHash = keccak256(signature);
  const entropy = hexToBytes(sigHash).slice(0, 16);
  return entropyToMnemonic(entropy, english);
}

/**
 * Derive master keys from a mnemonic.
 */
export function deriveMasterKeys(mnemonic: string): MasterKeys {
  return generateMasterKeys(mnemonic);
}

/**
 * Derive deposit secrets (nullifier + secret) for a specific deposit index.
 */
export function deriveDepositSecrets(
  masterKeys: MasterKeys,
  scope: bigint,
  index: bigint
) {
  const scopeHash = bigintToHash(scope);
  return generateDepositSecrets(masterKeys, scopeHash, index);
}

/**
 * Derive withdrawal secrets for the new zero-value commitment.
 */
export function deriveWithdrawalSecrets(
  masterKeys: MasterKeys,
  label: bigint,
  index: bigint
) {
  const labelHash = bigintToHash(label);
  return generateWithdrawalSecrets(masterKeys, labelHash as any, index);
}

/**
 * Compute a precommitment hash from nullifier and secret.
 * This is submitted with the deposit tx to bind secrets without revealing them.
 */
export function computePrecommitment(
  nullifier: bigint,
  secret: bigint
): bigint {
  const maxU256 = (1n << 256n) - 1n;
  return hashPrecommitment(nullifier as any, secret as any) & maxU256;
}

/**
 * Build a commitment object from deposit parameters.
 * Used for proof generation during withdrawal and ragequit.
 */
export function buildCommitment(
  value: bigint,
  label: bigint,
  nullifier: bigint,
  secret: bigint
) {
  const labelHash = bigintToHash(label);
  return getCommitment(value, labelHash as any, nullifier as any, secret as any);
}

export { bigintToHash } from '@0xbow/privacy-pools-core-sdk';
