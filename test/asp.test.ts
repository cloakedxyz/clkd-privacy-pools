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

    const result = await getDepositStatuses({
      aspApiBase: ASP_BASE,
      chainId: CHAIN_ID,
      precommitments: targets,
      status: 'approved',
    });

    expect(result).toEqual(new Set(['111', '222', '333']));
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(
      `${ASP_BASE}/global/public/events?chainId=${CHAIN_ID}&action=deposit&status=approved&perPage=500&page=1`,
      { headers: {} }
    );
  });

  it('paginates until all targets are found', async () => {
    const targets = new Set(['111', '222']);

    globalThis.fetch = mockFetchResponses([
      {
        events: [{ precommitmentHash: '111' }],
        total: 1000,
      },
      {
        events: [{ precommitmentHash: '222' }],
        total: 1000,
      },
    ]);

    const result = await getDepositStatuses({
      aspApiBase: ASP_BASE,
      chainId: CHAIN_ID,
      precommitments: targets,
      status: 'approved',
    });

    expect(result).toEqual(new Set(['111', '222']));
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('paginates until pages are exhausted', async () => {
    const targets = new Set(['111', '999']);

    globalThis.fetch = mockFetchResponses([
      {
        events: [{ precommitmentHash: '111' }],
        total: 750,
      },
      {
        events: [{ precommitmentHash: '222' }],
        total: 750,
      },
    ]);

    const result = await getDepositStatuses({
      aspApiBase: ASP_BASE,
      chainId: CHAIN_ID,
      precommitments: targets,
      status: 'declined',
    });

    expect(result).toEqual(new Set(['111']));
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('returns empty set when no targets match', async () => {
    globalThis.fetch = mockFetchResponses([
      {
        events: [{ precommitmentHash: '111' }, { precommitmentHash: '222' }],
        total: 2,
      },
    ]);

    const result = await getDepositStatuses({
      aspApiBase: ASP_BASE,
      chainId: CHAIN_ID,
      precommitments: new Set(['999']),
      status: 'approved',
    });

    expect(result).toEqual(new Set());
  });

  it('handles non-OK response gracefully', async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: false }) as Response);

    const result = await getDepositStatuses({
      aspApiBase: ASP_BASE,
      chainId: CHAIN_ID,
      precommitments: new Set(['111']),
      status: 'approved',
    });

    expect(result).toEqual(new Set());
  });

  it('uses per-pool endpoint when scope is provided', async () => {
    const scope = '12345';

    globalThis.fetch = mockFetchResponses([
      { events: [{ precommitmentHash: '111' }], total: 1 },
    ]);

    await getDepositStatuses({
      aspApiBase: ASP_BASE,
      chainId: CHAIN_ID,
      precommitments: new Set(['111']),
      status: 'approved',
      scope,
    });

    expect(fetch).toHaveBeenCalledWith(
      `${ASP_BASE}/${CHAIN_ID}/public/events?action=deposit&status=approved&perPage=500&page=1`,
      { headers: { 'X-Pool-Scope': scope } }
    );
  });

  it('uses global endpoint when scope is omitted', async () => {
    globalThis.fetch = mockFetchResponses([
      { events: [{ precommitmentHash: '111' }], total: 1 },
    ]);

    await getDepositStatuses({
      aspApiBase: ASP_BASE,
      chainId: CHAIN_ID,
      precommitments: new Set(['111']),
      status: 'declined',
    });

    expect(fetch).toHaveBeenCalledWith(
      `${ASP_BASE}/global/public/events?chainId=${CHAIN_ID}&action=deposit&status=declined&perPage=500&page=1`,
      { headers: {} }
    );
  });

  it('respects custom perPage', async () => {
    globalThis.fetch = mockFetchResponses([
      { events: [{ precommitmentHash: '111' }], total: 1 },
    ]);

    await getDepositStatuses({
      aspApiBase: ASP_BASE,
      chainId: CHAIN_ID,
      precommitments: new Set(['111']),
      status: 'approved',
      perPage: 50,
    });

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('perPage=50'),
      expect.anything()
    );
  });

  it('respects maxPages cap', async () => {
    globalThis.fetch = mockFetchResponses([
      { events: [], total: 5000 },
      { events: [], total: 5000 },
      { events: [], total: 5000 },
      { events: [], total: 5000 },
    ]);

    await getDepositStatuses({
      aspApiBase: ASP_BASE,
      chainId: CHAIN_ID,
      precommitments: new Set(['999']),
      status: 'approved',
      maxPages: 2,
    });

    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('returns empty set immediately for empty precommitments', async () => {
    globalThis.fetch = vi.fn();

    const result = await getDepositStatuses({
      aspApiBase: ASP_BASE,
      chainId: CHAIN_ID,
      precommitments: new Set(),
      status: 'approved',
    });

    expect(result).toEqual(new Set());
    expect(fetch).not.toHaveBeenCalled();
  });

  it('stops and returns partial results on mid-pagination failure', async () => {
    globalThis.fetch = mockFetchResponses([
      {
        events: [{ precommitmentHash: '111' }],
        total: 2000,
      },
      // second page fails (mockFetchResponses returns { ok: false } when pages run out)
    ]);

    const result = await getDepositStatuses({
      aspApiBase: ASP_BASE,
      chainId: CHAIN_ID,
      precommitments: new Set(['111', '222']),
      status: 'approved',
    });

    expect(result).toEqual(new Set(['111']));
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('custom perPage controls pagination boundary', async () => {
    globalThis.fetch = mockFetchResponses([
      {
        events: [{ precommitmentHash: '111' }],
        total: 60,
      },
      {
        events: [],
        total: 60,
      },
    ]);

    const result = await getDepositStatuses({
      aspApiBase: ASP_BASE,
      chainId: CHAIN_ID,
      precommitments: new Set(['111', '999']),
      status: 'approved',
      perPage: 50,
    });

    // page 2: 2 * 50 = 100 >= 60 total → stops
    expect(result).toEqual(new Set(['111']));
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
