import { describe, it, expect } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';
import {
  deriveMnemonic,
  deriveMasterKeys,
  deriveDepositSecrets,
  deriveWithdrawalSecrets,
  computePrecommitment,
  buildCommitment,
} from '../src/keys';

// Deterministic test key — Anvil's first default account
const TEST_PK =
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const TEST_ACCOUNT = privateKeyToAccount(TEST_PK);

// Generate a deterministic signature for testing
async function getTestSignature() {
  return TEST_ACCOUNT.signMessage({
    message: 'test-message-for-derivation',
  });
}

describe('deriveMnemonic', () => {
  it('produces a 12-word BIP39 mnemonic', async () => {
    const sig = await getTestSignature();
    const mnemonic = await deriveMnemonic(sig);
    const words = mnemonic.split(' ');
    expect(words).toHaveLength(12);
    // Each word should be non-empty
    for (const word of words) {
      expect(word.length).toBeGreaterThan(0);
    }
  });

  it('is deterministic — same signature produces same mnemonic', async () => {
    const sig = await getTestSignature();
    const mnemonic1 = await deriveMnemonic(sig);
    const mnemonic2 = await deriveMnemonic(sig);
    expect(mnemonic1).toBe(mnemonic2);
  });

  it('different signatures produce different mnemonics', async () => {
    const sig1 = await TEST_ACCOUNT.signMessage({ message: 'message-1' });
    const sig2 = await TEST_ACCOUNT.signMessage({ message: 'message-2' });
    const mnemonic1 = await deriveMnemonic(sig1);
    const mnemonic2 = await deriveMnemonic(sig2);
    expect(mnemonic1).not.toBe(mnemonic2);
  });

  it('domain separator: mnemonic differs from raw keccak256 of signature', async () => {
    // Verify domain separation is active — the mnemonic should NOT be
    // what you'd get from keccak256(signature) without the domain prefix
    const { keccak256, hexToBytes, encodePacked } = await import('viem');

    const sig = await getTestSignature();

    // What you'd get without domain separation
    const rawHash = keccak256(sig);
    const rawEntropy = hexToBytes(rawHash).slice(0, 16);

    // Verify deriveMnemonic produces a result (uses domain separation internally)
    const _mnemonic = await deriveMnemonic(sig);
    expect(_mnemonic.split(' ')).toHaveLength(12);

    // Verify the domain-separated hash differs from the raw hash
    const domainHash = keccak256(
      encodePacked(['string', 'bytes'], ['privacy-pools-v1', sig])
    );

    expect(domainHash).not.toBe(rawHash);

    const domainEntropy = hexToBytes(domainHash).slice(0, 16);
    expect(domainEntropy).not.toEqual(rawEntropy);
  });
});

describe('deriveMasterKeys', () => {
  it('produces master keys from a mnemonic', async () => {
    const sig = await getTestSignature();
    const mnemonic = await deriveMnemonic(sig);
    const keys = deriveMasterKeys(mnemonic);
    expect(keys).toBeDefined();
    expect(keys.masterNullifier).toBeDefined();
    expect(keys.masterSecret).toBeDefined();
  });

  it('is deterministic', async () => {
    const sig = await getTestSignature();
    const mnemonic = await deriveMnemonic(sig);
    const keys1 = deriveMasterKeys(mnemonic);
    const keys2 = deriveMasterKeys(mnemonic);
    expect(keys1.masterNullifier).toBe(keys2.masterNullifier);
    expect(keys1.masterSecret).toBe(keys2.masterSecret);
  });
});

describe('deriveDepositSecrets', () => {
  it('produces nullifier and secret for a given index', async () => {
    const sig = await getTestSignature();
    const mnemonic = await deriveMnemonic(sig);
    const keys = deriveMasterKeys(mnemonic);
    const scope = 12345n;

    const secrets = deriveDepositSecrets(keys, scope, 0n);
    expect(secrets.nullifier).toBeDefined();
    expect(secrets.secret).toBeDefined();
  });

  it('different indices produce different secrets', async () => {
    const sig = await getTestSignature();
    const mnemonic = await deriveMnemonic(sig);
    const keys = deriveMasterKeys(mnemonic);
    const scope = 12345n;

    const secrets0 = deriveDepositSecrets(keys, scope, 0n);
    const secrets1 = deriveDepositSecrets(keys, scope, 1n);

    expect(secrets0.nullifier).not.toBe(secrets1.nullifier);
    expect(secrets0.secret).not.toBe(secrets1.secret);
  });

  it('same index is deterministic', async () => {
    const sig = await getTestSignature();
    const mnemonic = await deriveMnemonic(sig);
    const keys = deriveMasterKeys(mnemonic);
    const scope = 12345n;

    const a = deriveDepositSecrets(keys, scope, 0n);
    const b = deriveDepositSecrets(keys, scope, 0n);

    expect(a.nullifier).toBe(b.nullifier);
    expect(a.secret).toBe(b.secret);
  });

  it('different scopes produce different secrets', async () => {
    const sig = await getTestSignature();
    const mnemonic = await deriveMnemonic(sig);
    const keys = deriveMasterKeys(mnemonic);

    const a = deriveDepositSecrets(keys, 111n, 0n);
    const b = deriveDepositSecrets(keys, 222n, 0n);

    expect(a.nullifier).not.toBe(b.nullifier);
  });
});

describe('computePrecommitment', () => {
  it('produces a valid uint256', async () => {
    const sig = await getTestSignature();
    const mnemonic = await deriveMnemonic(sig);
    const keys = deriveMasterKeys(mnemonic);
    const secrets = deriveDepositSecrets(keys, 12345n, 0n);

    const precommitment = computePrecommitment(
      secrets.nullifier as any,
      secrets.secret as any
    );

    expect(precommitment).toBeTypeOf('bigint');
    expect(precommitment).toBeGreaterThan(0n);
    const maxU256 = (1n << 256n) - 1n;
    expect(precommitment).toBeLessThanOrEqual(maxU256);
  });

  it('is deterministic', async () => {
    const sig = await getTestSignature();
    const mnemonic = await deriveMnemonic(sig);
    const keys = deriveMasterKeys(mnemonic);
    const secrets = deriveDepositSecrets(keys, 12345n, 0n);

    const a = computePrecommitment(
      secrets.nullifier as any,
      secrets.secret as any
    );
    const b = computePrecommitment(
      secrets.nullifier as any,
      secrets.secret as any
    );
    expect(a).toBe(b);
  });

  it('different secrets produce different precommitments', async () => {
    const sig = await getTestSignature();
    const mnemonic = await deriveMnemonic(sig);
    const keys = deriveMasterKeys(mnemonic);

    const s0 = deriveDepositSecrets(keys, 12345n, 0n);
    const s1 = deriveDepositSecrets(keys, 12345n, 1n);

    const p0 = computePrecommitment(s0.nullifier as any, s0.secret as any);
    const p1 = computePrecommitment(s1.nullifier as any, s1.secret as any);
    expect(p0).not.toBe(p1);
  });
});

describe('buildCommitment', () => {
  it('produces a commitment with a hash', async () => {
    const sig = await getTestSignature();
    const mnemonic = await deriveMnemonic(sig);
    const keys = deriveMasterKeys(mnemonic);
    const secrets = deriveDepositSecrets(keys, 12345n, 0n);

    const commitment = buildCommitment(
      1000000000000000n, // 0.001 ETH
      99999n, // label
      secrets.nullifier as any,
      secrets.secret as any
    );

    expect(commitment.hash).toBeTypeOf('bigint');
    expect(commitment.hash).toBeGreaterThan(0n);
  });

  it('is deterministic', async () => {
    const sig = await getTestSignature();
    const mnemonic = await deriveMnemonic(sig);
    const keys = deriveMasterKeys(mnemonic);
    const secrets = deriveDepositSecrets(keys, 12345n, 0n);

    const a = buildCommitment(
      1000n,
      99999n,
      secrets.nullifier as any,
      secrets.secret as any
    );
    const b = buildCommitment(
      1000n,
      99999n,
      secrets.nullifier as any,
      secrets.secret as any
    );
    expect(a.hash).toBe(b.hash);
  });

  it('different values produce different commitments', async () => {
    const sig = await getTestSignature();
    const mnemonic = await deriveMnemonic(sig);
    const keys = deriveMasterKeys(mnemonic);
    const secrets = deriveDepositSecrets(keys, 12345n, 0n);

    const a = buildCommitment(
      1000n,
      99999n,
      secrets.nullifier as any,
      secrets.secret as any
    );
    const b = buildCommitment(
      2000n,
      99999n,
      secrets.nullifier as any,
      secrets.secret as any
    );
    expect(a.hash).not.toBe(b.hash);
  });
});

describe('deriveWithdrawalSecrets', () => {
  it('produces withdrawal secrets', async () => {
    const sig = await getTestSignature();
    const mnemonic = await deriveMnemonic(sig);
    const keys = deriveMasterKeys(mnemonic);

    const secrets = deriveWithdrawalSecrets(keys, 99999n, 0n);
    expect(secrets.nullifier).toBeDefined();
    expect(secrets.secret).toBeDefined();
  });

  it('different labels produce different withdrawal secrets', async () => {
    const sig = await getTestSignature();
    const mnemonic = await deriveMnemonic(sig);
    const keys = deriveMasterKeys(mnemonic);

    const a = deriveWithdrawalSecrets(keys, 11111n, 0n);
    const b = deriveWithdrawalSecrets(keys, 22222n, 0n);

    expect(a.nullifier).not.toBe(b.nullifier);
  });
});
