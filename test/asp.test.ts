import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getDepositStatuses } from '../src/asp';

const ASP_BASE = 'https://asp.example.com';
const CHAIN_ID = 11155111;

function mockFetchResponses(
  pages: Array<{ events: Array<{ precommitmentHash: string }>; total: number }>
) {
  let callIndex = 0;
  return vi.fn(async () => {
    const page = pages[callIndex++];
    if (!page) return { ok: false } as Response;
    return {
      ok: true,
      json: async () => page,
    } as unknown as Response;
  });
}

describe('getDepositStatuses', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('matches target precommitments from a single page', async () => {
    const targets = new Set(['111', '222', '333']);

    globalThis.fetch = mockFetchResponses([
      {
        events: [
          { precommitmentHash: '111' },
          { precommitmentHash: '222' },
          { precommitmentHash: '444' },
          { precommitmentHash: '333' },
        ],
        total: 4,
      },
    ]);

    const result = await getDepositStatuses(
      ASP_BASE,
      CHAIN_ID,
      targets,
      'approved'
    );

    expect(result).toEqual(new Set(['111', '222', '333']));
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(
      `${ASP_BASE}/global/public/events?chainId=${CHAIN_ID}&action=deposit&status=approved&perPage=50&page=1`
    );
  });

  it('paginates until all targets are found', async () => {
    const targets = new Set(['111', '222']);

    globalThis.fetch = mockFetchResponses([
      {
        events: [{ precommitmentHash: '111' }],
        total: 100,
      },
      {
        events: [{ precommitmentHash: '222' }],
        total: 100,
      },
    ]);

    const result = await getDepositStatuses(
      ASP_BASE,
      CHAIN_ID,
      targets,
      'approved'
    );

    expect(result).toEqual(new Set(['111', '222']));
    // Stops after page 2 because all targets found — doesn't fetch page 3
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('paginates until pages are exhausted', async () => {
    const targets = new Set(['111', '999']);

    globalThis.fetch = mockFetchResponses([
      {
        events: [{ precommitmentHash: '111' }],
        total: 75,
      },
      {
        events: [{ precommitmentHash: '222' }],
        total: 75,
      },
    ]);

    const result = await getDepositStatuses(
      ASP_BASE,
      CHAIN_ID,
      targets,
      'declined'
    );

    // Found '111' but '999' doesn't exist — stops when page * 50 >= total
    expect(result).toEqual(new Set(['111']));
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('returns empty set when no targets match', async () => {
    const targets = new Set(['999']);

    globalThis.fetch = mockFetchResponses([
      {
        events: [{ precommitmentHash: '111' }, { precommitmentHash: '222' }],
        total: 2,
      },
    ]);

    const result = await getDepositStatuses(
      ASP_BASE,
      CHAIN_ID,
      targets,
      'approved'
    );

    expect(result).toEqual(new Set());
  });

  it('handles non-OK response gracefully', async () => {
    const targets = new Set(['111']);

    globalThis.fetch = vi.fn(async () => ({ ok: false }) as Response);

    const result = await getDepositStatuses(
      ASP_BASE,
      CHAIN_ID,
      targets,
      'approved'
    );

    expect(result).toEqual(new Set());
  });

  it('passes status filter in the URL', async () => {
    const targets = new Set(['111']);

    globalThis.fetch = mockFetchResponses([
      { events: [{ precommitmentHash: '111' }], total: 1 },
    ]);

    await getDepositStatuses(ASP_BASE, CHAIN_ID, targets, 'declined');

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('&status=declined&')
    );
  });
});
