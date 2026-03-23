import { describe, it, expect } from 'vitest';
import { type Address, decodeAbiParameters, decodeFunctionData } from 'viem';
import { encodeRelayData } from '../src/relay';
import { ENTRYPOINT_ABI } from '../src/abi';

describe('encodeRelayData', () => {
  it('encodes recipient, feeRecipient, and relayFeeBPS', () => {
    const recipient = '0x1111111111111111111111111111111111111111' as Address;
    const feeRecipient =
      '0x2222222222222222222222222222222222222222' as Address;
    const feeBPS = 100n;

    const encoded = encodeRelayData(recipient, feeRecipient, feeBPS);

    // Decode and verify
    const decoded = decodeAbiParameters(
      [
        { name: 'recipient', type: 'address' },
        { name: 'feeRecipient', type: 'address' },
        { name: 'relayFeeBPS', type: 'uint256' },
      ],
      encoded
    );

    expect(decoded[0].toLowerCase()).toBe(recipient.toLowerCase());
    expect(decoded[1].toLowerCase()).toBe(feeRecipient.toLowerCase());
    expect(decoded[2]).toBe(feeBPS);
  });

  it('encodes with zero fee but non-zero feeRecipient', () => {
    const recipient = '0x1111111111111111111111111111111111111111' as Address;
    const feeRecipient =
      '0x3333333333333333333333333333333333333333' as Address;

    const encoded = encodeRelayData(recipient, feeRecipient);

    const decoded = decodeAbiParameters(
      [
        { name: 'recipient', type: 'address' },
        { name: 'feeRecipient', type: 'address' },
        { name: 'relayFeeBPS', type: 'uint256' },
      ],
      encoded
    );

    expect(decoded[0].toLowerCase()).toBe(recipient.toLowerCase());
    expect(decoded[1].toLowerCase()).toBe(feeRecipient.toLowerCase());
    expect(decoded[2]).toBe(0n);
  });

  it('produces valid hex output', () => {
    const encoded = encodeRelayData(
      '0x1111111111111111111111111111111111111111' as Address,
      '0x2222222222222222222222222222222222222222' as Address
    );

    expect(encoded).toMatch(/^0x[0-9a-f]+$/i);
    // 3 ABI params × 32 bytes = 96 bytes = 192 hex chars + 0x prefix
    expect(encoded.length).toBe(2 + 192);
  });
});

describe('ENTRYPOINT_ABI', () => {
  it('has a relay function with correct inputs', () => {
    const relayFn = ENTRYPOINT_ABI.find(
      (item) => item.type === 'function' && item.name === 'relay'
    );

    expect(relayFn).toBeDefined();
    expect(relayFn!.inputs).toHaveLength(3);
    expect(relayFn!.inputs[0].name).toBe('_withdrawal');
    expect(relayFn!.inputs[1].name).toBe('_proof');
    expect(relayFn!.inputs[2].name).toBe('_scope');
  });
});
