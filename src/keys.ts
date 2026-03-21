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
 *
 * IMPORTANT: The PP mnemonic is derived from the same Cloaked stealth
 * signature (genCloakedMessage({pin, address})). This means one signature
 * recovers both stealth addresses and PP deposits. No separate signing needed.
 */

import { keccak256, hexToBytes, encodePacked, type Hex } from 'viem';
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
 * Domain separator for PP key derivation.
 * Ensures the PP mnemonic is cryptographically independent from stealth keys,
 * even though both derive from the same root entropy.
 *
 * Stealth keys use the raw entropy directly (signature r,s or PRF outputs).
 * PP keys hash: keccak256(encodePacked("privacy-pools-v1", entropy)).
 * This domain separation guarantees the two derivation paths cannot leak
 * information about each other.
 */
const PP_DOMAIN = 'privacy-pools-v1';

/**
 * Derive a Privacy Pools mnemonic from user entropy.
 *
 * Supports both Cloaked auth flows:
 *
 * **Wallet + PIN flow** — pass the ECDSA signature directly:
 * ```ts
 * const mnemonic = await deriveMnemonic({ signature: sig });
 * ```
 *
 * **PRF/passkey flow** — pass the two PRF outputs:
 * ```ts
 * const prfResults = assertion.getClientExtensionResults().prf.results;
 * const mnemonic = await deriveMnemonic({
 *   spendSecret: toHex(prfResults.first),
 *   viewSecret: toHex(prfResults.second),
 * });
 * ```
 *
 * Both paths produce a deterministic 12-word BIP39 mnemonic via domain-separated
 * keccak256 hashing. The same inputs always produce the same mnemonic.
 *
 * @param input - Either `{ signature }` (wallet+PIN) or `{ spendSecret, viewSecret }` (PRF)
 */
export async function deriveMnemonic(
  input: { signature: Hex } | { spendSecret: Hex; viewSecret: Hex }
): Promise<string> {
  let entropy: Hex;

  if ('signature' in input) {
    // Wallet + PIN: domain-separate the full signature
    entropy = keccak256(
      encodePacked(['string', 'bytes'], [PP_DOMAIN, input.signature])
    );
  } else {
    // PRF: combine both secrets with domain separation
    // Uses both spendSecret and viewSecret to ensure the mnemonic depends
    // on the full PRF output, not just one half.
    entropy = keccak256(
      encodePacked(
        ['string', 'bytes', 'bytes'],
        [PP_DOMAIN, input.spendSecret, input.viewSecret]
      )
    );
  }

  const entropyBytes = hexToBytes(entropy).slice(0, 16);
  return entropyToMnemonic(entropyBytes, english);
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
  return getCommitment(
    value,
    labelHash as any,
    nullifier as any,
    secret as any
  );
}

export { bigintToHash } from '@0xbow/privacy-pools-core-sdk';
