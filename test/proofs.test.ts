import { describe, it, expect } from 'vitest';
import { formatProof } from '../src/proofs';

describe('formatProof', () => {
  it('formats a Groth16 proof with pi_b swap', () => {
    const mockProof = {
      pi_a: ['111', '222', '1'],
      pi_b: [
        ['333', '444'],
        ['555', '666'],
        ['1', '0'],
      ],
      pi_c: ['777', '888', '1'],
    };
    const mockSignals = ['1', '2', '3', '4'];

    const formatted = formatProof(mockProof, mockSignals);

    // pA and pC are straightforward
    expect(formatted.pA).toEqual([111n, 222n]);
    expect(formatted.pC).toEqual([777n, 888n]);

    // pi_b elements are SWAPPED for the Solidity verifier
    expect(formatted.pB).toEqual([
      [444n, 333n], // swapped
      [666n, 555n], // swapped
    ]);

    expect(formatted.pubSignals).toEqual([1n, 2n, 3n, 4n]);
  });

  it('handles large bigint values', () => {
    const largeVal =
      '21888242871839275222246405745257275088696311157297823662689037894645226208583';
    const mockProof = {
      pi_a: [largeVal, largeVal, '1'],
      pi_b: [
        [largeVal, largeVal],
        [largeVal, largeVal],
        ['1', '0'],
      ],
      pi_c: [largeVal, largeVal, '1'],
    };

    const formatted = formatProof(mockProof, [largeVal]);
    expect(formatted.pA[0]).toBe(BigInt(largeVal));
    expect(formatted.pubSignals[0]).toBe(BigInt(largeVal));
  });
});
