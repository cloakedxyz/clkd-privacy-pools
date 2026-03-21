import { describe, it, expect } from 'vitest';
import { parseEther } from 'viem';
import {
  calculateGrossDeposit,
  calculateFeeAmount,
  calculateNetPoolValue,
} from '../src/fees';

describe('calculateGrossDeposit', () => {
  it('calculates correct gross for Sepolia (100 BPS = 1%)', () => {
    const desired = parseEther('0.01');
    const gross = calculateGrossDeposit(desired, 100n);
    // gross = 0.01 / 0.99 = 0.010101...
    expect(gross).toBeGreaterThan(desired);
    // The net after fee deduction should equal the desired value
    const net = calculateNetPoolValue(gross, 100n);
    expect(net).toBe(desired);
  });

  it('calculates correct gross for mainnet (50 BPS = 0.5%)', () => {
    const desired = parseEther('0.01');
    const gross = calculateGrossDeposit(desired, 50n);
    const net = calculateNetPoolValue(gross, 50n);
    expect(net).toBe(desired);
  });

  it('handles zero fee', () => {
    const desired = parseEther('1');
    const gross = calculateGrossDeposit(desired, 0n);
    expect(gross).toBe(desired);
  });

  it('handles large amounts', () => {
    const desired = parseEther('100');
    const gross = calculateGrossDeposit(desired, 100n);
    const net = calculateNetPoolValue(gross, 100n);
    expect(net).toBe(desired);
  });
});

describe('calculateFeeAmount', () => {
  it('calculates 1% fee correctly', () => {
    const gross = parseEther('1');
    const fee = calculateFeeAmount(gross, 100n);
    expect(fee).toBe(parseEther('0.01'));
  });

  it('calculates 0.5% fee correctly', () => {
    const gross = parseEther('1');
    const fee = calculateFeeAmount(gross, 50n);
    expect(fee).toBe(parseEther('0.005'));
  });

  it('zero fee returns zero', () => {
    const fee = calculateFeeAmount(parseEther('1'), 0n);
    expect(fee).toBe(0n);
  });
});

describe('calculateNetPoolValue', () => {
  it('net = gross - fee', () => {
    const gross = parseEther('1');
    const net = calculateNetPoolValue(gross, 100n);
    const fee = calculateFeeAmount(gross, 100n);
    expect(net).toBe(gross - fee);
  });

  it('round-trip: desired → gross → net = desired', () => {
    // This is the key property: if you calculate the gross from a desired value,
    // then deduct the fee, you should get back the desired value
    const desired = parseEther('0.05');
    for (const feeBPS of [50n, 100n, 200n, 500n]) {
      const gross = calculateGrossDeposit(desired, feeBPS);
      const net = calculateNetPoolValue(gross, feeBPS);
      expect(net).toBe(desired);
    }
  });
});
