import { describe, expect, it, vi } from 'vitest';
import type { Address, PublicClient } from 'viem';
import {
  scanPoolEvents,
  scanPoolRagequits,
  scanPoolWithdrawals,
} from '../src/scanner';

const POOL_ADDRESS = '0x0000000000000000000000000000000000000001' as Address;

function eventName(params: { event?: { name?: string } }): string {
  return params.event?.name ?? '';
}

describe('scanner RPC log handling', () => {
  it('clamps scanPoolEvents to the provider head when getLogs races ahead', async () => {
    const getBlockNumber = vi.fn().mockResolvedValue(105n);
    const getLogs = vi.fn(async (params: any) => {
      if (params.toBlock === 110n) {
        throw new Error('block range extends beyond current head block');
      }

      if (eventName(params) === 'LeafInserted') {
        return [
          {
            args: { _index: 1n, _leaf: 222n },
            blockNumber: 104n,
          },
        ];
      }

      if (eventName(params) === 'Deposited') {
        return [
          {
            args: {
              _commitment: 222n,
              _label: 333n,
              _value: 444n,
              _precommitmentHash: 111n,
            },
            blockNumber: 104n,
          },
        ];
      }

      return [];
    });

    const client = { getBlockNumber, getLogs } as unknown as PublicClient;

    const result = await scanPoolEvents(client, POOL_ADDRESS, 100n, 110n, 50n);

    expect(getBlockNumber).toHaveBeenCalledTimes(1);
    expect(getLogs).toHaveBeenCalledWith(
      expect.objectContaining({ fromBlock: 100n, toBlock: 105n })
    );
    expect(result.leaves).toEqual([222n]);
    expect(result.depositsByPrecommitment.get(111n)).toEqual({
      commitment: 222n,
      label: 333n,
      value: 444n,
      blockNumber: 104n,
    });
  });

  it('scans withdrawals with block metadata and the same head clamp', async () => {
    const getBlockNumber = vi.fn().mockResolvedValue(205n);
    const getLogs = vi.fn(async (params: any) => {
      if (params.toBlock === 210n) {
        throw new Error('block range extends beyond current head block');
      }

      return [
        {
          args: {
            _spentNullifier: 111n,
            _value: 222n,
            _newCommitment: 333n,
          },
          blockNumber: 204n,
        },
      ];
    });

    const client = { getBlockNumber, getLogs } as unknown as PublicClient;

    const result = await scanPoolWithdrawals(
      client,
      POOL_ADDRESS,
      200n,
      210n,
      50n
    );

    expect(getBlockNumber).toHaveBeenCalledTimes(1);
    expect(getLogs).toHaveBeenCalledWith(
      expect.objectContaining({ fromBlock: 200n, toBlock: 205n })
    );
    expect(result.get(111n)).toEqual({
      withdrawnValue: 222n,
      newCommitment: 333n,
      blockNumber: 204n,
    });
  });

  it('requests Withdrawn logs with the canonical 0xbow argument order', async () => {
    const getLogs = vi.fn().mockResolvedValue([]);
    const client = {
      getBlockNumber: vi.fn(),
      getLogs,
    } as unknown as PublicClient;

    await scanPoolWithdrawals(client, POOL_ADDRESS, 200n, 210n, 50n);

    expect(getLogs).toHaveBeenCalledWith(
      expect.objectContaining({
        event: expect.objectContaining({
          name: 'Withdrawn',
          inputs: [
            { name: '_processooor', type: 'address', indexed: true },
            { name: '_value', type: 'uint256', indexed: false },
            { name: '_spentNullifier', type: 'uint256', indexed: false },
            { name: '_newCommitment', type: 'uint256', indexed: false },
          ],
        }),
      })
    );
  });

  it('scans ragequits by commitment with block metadata', async () => {
    const getLogs = vi.fn().mockResolvedValue([
      {
        args: {
          _commitment: 111n,
          _label: 222n,
          _value: 333n,
        },
        blockNumber: 204n,
      },
    ]);
    const client = {
      getBlockNumber: vi.fn(),
      getLogs,
    } as unknown as PublicClient;

    const result = await scanPoolRagequits(
      client,
      POOL_ADDRESS,
      200n,
      210n,
      50n
    );

    expect(getLogs).toHaveBeenCalledWith(
      expect.objectContaining({
        event: expect.objectContaining({
          name: 'Ragequit',
          inputs: [
            { name: '_ragequitter', type: 'address', indexed: true },
            { name: '_commitment', type: 'uint256', indexed: false },
            { name: '_label', type: 'uint256', indexed: false },
            { name: '_value', type: 'uint256', indexed: false },
          ],
        }),
      })
    );
    expect(result.get(111n)).toEqual({
      commitment: 111n,
      label: 222n,
      value: 333n,
      blockNumber: 204n,
    });
  });

  it('does not swallow non-head RPC errors', async () => {
    const getBlockNumber = vi.fn();
    const getLogs = vi.fn(async () => {
      throw new Error('invalid filter parameters');
    });

    const client = { getBlockNumber, getLogs } as unknown as PublicClient;

    await expect(
      scanPoolEvents(client, POOL_ADDRESS, 100n, 110n, 50n)
    ).rejects.toThrow('invalid filter parameters');

    expect(getBlockNumber).not.toHaveBeenCalled();
  });
});
