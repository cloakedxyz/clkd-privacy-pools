/**
 * Minimal ABIs for Privacy Pools contracts.
 * Only includes the functions/events needed for deposit, withdrawal, and ragequit.
 */

export const ENTRYPOINT_ABI = [
  {
    type: 'function',
    name: 'deposit',
    stateMutability: 'payable',
    inputs: [{ name: 'precommitment', type: 'uint256' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'usedPrecommitments',
    inputs: [{ name: '_precommitment', type: 'uint256' }],
    outputs: [{ name: '_used', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'latestRoot',
    inputs: [],
    outputs: [{ name: '_root', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'assetConfig',
    inputs: [{ name: '_asset', type: 'address' }],
    outputs: [
      { name: 'pool', type: 'address' },
      { name: 'minimumDepositAmount', type: 'uint256' },
      { name: 'vettingFeeBPS', type: 'uint256' },
      { name: 'maxRelayFeeBPS', type: 'uint256' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'relay',
    inputs: [
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
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
] as const;

export const POOL_ABI = [
  {
    type: 'event',
    name: 'Deposited',
    inputs: [
      { name: '_depositor', type: 'address', indexed: true },
      { name: '_commitment', type: 'uint256', indexed: false },
      { name: '_label', type: 'uint256', indexed: false },
      { name: '_value', type: 'uint256', indexed: false },
      { name: '_precommitmentHash', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'Withdrawn',
    inputs: [
      { name: '_processooor', type: 'address', indexed: true },
      { name: '_value', type: 'uint256', indexed: false },
      { name: '_spentNullifier', type: 'uint256', indexed: false },
      { name: '_newCommitment', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'Ragequit',
    inputs: [
      { name: '_ragequitter', type: 'address', indexed: true },
      { name: '_value', type: 'uint256', indexed: false },
      { name: '_spentNullifier', type: 'uint256', indexed: false },
      { name: '_newCommitment', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'LeafInserted',
    inputs: [
      { name: '_index', type: 'uint256', indexed: false },
      { name: '_leaf', type: 'uint256', indexed: false },
      { name: '_root', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'function',
    name: 'withdraw',
    inputs: [
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
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'ragequit',
    inputs: [
      {
        name: '_proof',
        type: 'tuple',
        components: [
          { name: 'pA', type: 'uint256[2]' },
          { name: 'pB', type: 'uint256[2][2]' },
          { name: 'pC', type: 'uint256[2]' },
          { name: 'pubSignals', type: 'uint256[4]' },
        ],
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'currentRoot',
    inputs: [],
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'SCOPE',
    inputs: [],
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'currentTreeSize',
    inputs: [],
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'ASSET',
    inputs: [],
    outputs: [{ type: 'address' }],
    stateMutability: 'view',
  },
] as const;
