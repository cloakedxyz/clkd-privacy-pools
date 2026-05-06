import { describe, expect, it } from 'vitest';
import { ENTRYPOINT_ABI, POOL_ABI } from '../src/abi';

type AbiInput = {
  name?: string;
  type: string;
  indexed?: boolean;
  components?: AbiInput[];
};

type AbiItem = {
  type: string;
  name: string;
  stateMutability?: string;
  inputs?: AbiInput[];
  outputs?: AbiInput[];
};

function abiItem(
  abi: readonly unknown[],
  type: string,
  name: string,
  inputCount?: number
): AbiItem {
  const item = abi.find((entry) => {
    const candidate = entry as AbiItem;
    return (
      candidate.type === type &&
      candidate.name === name &&
      (inputCount === undefined || candidate.inputs?.length === inputCount)
    );
  });

  if (!item) {
    throw new Error(`Missing ${type} ${name}`);
  }

  return item as AbiItem;
}

function eventInputs(abi: readonly unknown[], name: string): AbiInput[] {
  return abiItem(abi, 'event', name).inputs ?? [];
}

function functionInputs(
  abi: readonly unknown[],
  name: string,
  inputCount?: number
): AbiInput[] {
  return abiItem(abi, 'function', name, inputCount).inputs ?? [];
}

function functionOutputs(
  abi: readonly unknown[],
  name: string,
  inputCount?: number
): AbiInput[] {
  return abiItem(abi, 'function', name, inputCount).outputs ?? [];
}

describe('POOL_ABI', () => {
  it('matches the 0xbow pool event argument order', () => {
    expect(eventInputs(POOL_ABI, 'Deposited')).toEqual([
      { name: '_depositor', type: 'address', indexed: true },
      { name: '_commitment', type: 'uint256', indexed: false },
      { name: '_label', type: 'uint256', indexed: false },
      { name: '_value', type: 'uint256', indexed: false },
      { name: '_precommitmentHash', type: 'uint256', indexed: false },
    ]);

    expect(eventInputs(POOL_ABI, 'Withdrawn')).toEqual([
      { name: '_processooor', type: 'address', indexed: true },
      { name: '_value', type: 'uint256', indexed: false },
      { name: '_spentNullifier', type: 'uint256', indexed: false },
      { name: '_newCommitment', type: 'uint256', indexed: false },
    ]);

    expect(eventInputs(POOL_ABI, 'Ragequit')).toEqual([
      { name: '_ragequitter', type: 'address', indexed: true },
      { name: '_commitment', type: 'uint256', indexed: false },
      { name: '_label', type: 'uint256', indexed: false },
      { name: '_value', type: 'uint256', indexed: false },
    ]);

    expect(eventInputs(POOL_ABI, 'LeafInserted')).toEqual([
      { name: '_index', type: 'uint256', indexed: false },
      { name: '_leaf', type: 'uint256', indexed: false },
      { name: '_root', type: 'uint256', indexed: false },
    ]);
  });

  it('matches the 0xbow pool function shapes used by the SDK', () => {
    expect(functionInputs(POOL_ABI, 'withdraw')).toEqual([
      {
        name: '_w',
        type: 'tuple',
        components: [
          { name: 'processooor', type: 'address' },
          { name: 'data', type: 'bytes' },
        ],
      },
      {
        name: '_p',
        type: 'tuple',
        components: [
          { name: 'pA', type: 'uint256[2]' },
          { name: 'pB', type: 'uint256[2][2]' },
          { name: 'pC', type: 'uint256[2]' },
          { name: 'pubSignals', type: 'uint256[8]' },
        ],
      },
    ]);

    expect(functionInputs(POOL_ABI, 'ragequit')).toEqual([
      {
        name: '_p',
        type: 'tuple',
        components: [
          { name: 'pA', type: 'uint256[2]' },
          { name: 'pB', type: 'uint256[2][2]' },
          { name: 'pC', type: 'uint256[2]' },
          { name: 'pubSignals', type: 'uint256[4]' },
        ],
      },
    ]);

    expect(functionOutputs(POOL_ABI, 'currentRoot')).toEqual([
      { name: '_root', type: 'uint256' },
    ]);
    expect(functionOutputs(POOL_ABI, 'SCOPE')).toEqual([
      { name: '_scope', type: 'uint256' },
    ]);
    expect(functionOutputs(POOL_ABI, 'currentTreeSize')).toEqual([
      { name: '_size', type: 'uint256' },
    ]);
    expect(functionOutputs(POOL_ABI, 'ASSET')).toEqual([
      { name: '_asset', type: 'address' },
    ]);
  });
});

describe('ENTRYPOINT_ABI', () => {
  it('matches the 0xbow entrypoint deposit overloads', () => {
    expect(abiItem(ENTRYPOINT_ABI, 'function', 'deposit', 1)).toMatchObject({
      stateMutability: 'payable',
    });
    expect(functionInputs(ENTRYPOINT_ABI, 'deposit', 1)).toEqual([
      { name: '_precommitment', type: 'uint256' },
    ]);
    expect(functionOutputs(ENTRYPOINT_ABI, 'deposit', 1)).toEqual([
      { name: '_commitment', type: 'uint256' },
    ]);

    expect(abiItem(ENTRYPOINT_ABI, 'function', 'deposit', 3)).toMatchObject({
      stateMutability: 'nonpayable',
    });
    expect(functionInputs(ENTRYPOINT_ABI, 'deposit', 3)).toEqual([
      { name: '_asset', type: 'address' },
      { name: '_value', type: 'uint256' },
      { name: '_precommitment', type: 'uint256' },
    ]);
    expect(functionOutputs(ENTRYPOINT_ABI, 'deposit', 3)).toEqual([
      { name: '_commitment', type: 'uint256' },
    ]);
  });

  it('matches the 0xbow entrypoint view and relay function shapes used by the SDK', () => {
    expect(functionInputs(ENTRYPOINT_ABI, 'usedPrecommitments')).toEqual([
      { name: '_precommitment', type: 'uint256' },
    ]);
    expect(functionOutputs(ENTRYPOINT_ABI, 'usedPrecommitments')).toEqual([
      { name: '_used', type: 'bool' },
    ]);

    expect(functionOutputs(ENTRYPOINT_ABI, 'latestRoot')).toEqual([
      { name: '_root', type: 'uint256' },
    ]);

    expect(functionInputs(ENTRYPOINT_ABI, 'assetConfig')).toEqual([
      { name: '_asset', type: 'address' },
    ]);
    expect(functionOutputs(ENTRYPOINT_ABI, 'assetConfig')).toEqual([
      { name: '_pool', type: 'address' },
      { name: '_minimumDepositAmount', type: 'uint256' },
      { name: '_vettingFeeBPS', type: 'uint256' },
      { name: '_maxRelayFeeBPS', type: 'uint256' },
    ]);

    expect(functionInputs(ENTRYPOINT_ABI, 'relay')).toEqual([
      {
        name: '_withdrawal',
        type: 'tuple',
        components: [
          { name: 'processooor', type: 'address' },
          { name: 'data', type: 'bytes' },
        ],
      },
      {
        name: '_proof',
        type: 'tuple',
        components: [
          { name: 'pA', type: 'uint256[2]' },
          { name: 'pB', type: 'uint256[2][2]' },
          { name: 'pC', type: 'uint256[2]' },
          { name: 'pubSignals', type: 'uint256[8]' },
        ],
      },
      { name: '_scope', type: 'uint256' },
    ]);
  });
});
