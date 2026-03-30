/**
 * ASP (Association Set Provider) API client.
 *
 * Queries the 0xbow ASP API for deposit review status,
 * approved labels, and Merkle roots.
 */

export type ReviewStatus = 'pending' | 'approved' | 'declined' | 'poi_required';

export interface AspRoots {
  /** ASP Merkle root — should match Entrypoint.latestRoot() */
  mtRoot: bigint;
  /** State tree root — should match Pool.currentRoot() */
  onchainMtRoot: bigint;
  createdAt: string;
}

export interface AspLeaves {
  /** Approved labels (used to build ASP Merkle proof) */
  aspLeaves: bigint[];
  /** Always empty on current API — index from events instead */
  stateTreeLeaves: bigint[];
}

export interface DepositEvent {
  type: string;
  eventId: number;
  createdAt: string;
  amount: string;
  address: string;
  txHash: string;
  precommitmentHash: string;
  reviewStatus: ReviewStatus;
}

export interface GetDepositStatusesOptions {
  /** ASP API base URL (e.g., https://api.0xbow.io) */
  aspApiBase: string;
  /** Chain ID */
  chainId: number;
  /** Precommitment hash strings (decimal) to look for */
  precommitments: Set<string>;
  /** Status to filter by */
  status: ReviewStatus;
  /**
   * Pool scope (decimal bigint string). When provided, queries the per-pool
   * endpoint (`/{chainId}/public/events` with `X-Pool-Scope` header) instead
   * of the global feed. This is much faster on chains with many pools.
   */
  scope?: string;
  /** Results per API page. Default: 500. Use smaller values (e.g. 50) for
   *  background polling where you expect few results. */
  perPage?: number;
  /** Maximum pages to fetch. Default: unlimited (paginate until all targets
   *  found or results exhausted). Set a cap for background polling to bound
   *  latency. */
  maxPages?: number;
}

/**
 * Batch-check deposit statuses via the ASP events API.
 *
 * Uses the `status` query filter so each request only returns events with
 * that status (much smaller result set than unfiltered). Paginates until
 * all targets are found, pages are exhausted, or `maxPages` is reached.
 *
 * Supports two query modes:
 * - **Per-pool** (recommended): pass `scope` to query only deposits for a
 *   specific pool via the `X-Pool-Scope` header.
 * - **Global**: omit `scope` to scan the global feed across all pools.
 *
 * @returns Set of precommitment hash strings that matched the given status
 */
export async function getDepositStatuses(
  options: GetDepositStatusesOptions
): Promise<Set<string>> {
  const {
    aspApiBase,
    chainId,
    precommitments,
    status,
    scope,
    perPage = 500,
    maxPages,
  } = options;

  const matched = new Set<string>();
  if (precommitments.size === 0) return matched;
  const remaining = new Set(precommitments);

  for (let page = 1; ; page++) {
    if (maxPages && page > maxPages) break;

    const url = scope
      ? `${aspApiBase}/${chainId}/public/events?action=deposit&status=${status}&perPage=${perPage}&page=${page}`
      : `${aspApiBase}/global/public/events?chainId=${chainId}&action=deposit&status=${status}&perPage=${perPage}&page=${page}`;

    const headers: Record<string, string> = {};
    if (scope) {
      headers['X-Pool-Scope'] = scope;
    }

    const res = await fetch(url, { headers });
    if (!res.ok) break;

    const data = (await res.json()) as {
      events: Array<{ precommitmentHash: string }>;
      total: number;
    };

    for (const event of data.events) {
      if (remaining.has(event.precommitmentHash)) {
        matched.add(event.precommitmentHash);
        remaining.delete(event.precommitmentHash);
      }
    }

    if (remaining.size === 0) break;
    if (page * perPage >= data.total) break;
  }

  return matched;
}

/**
 * Fetch ASP Merkle roots for a pool.
 *
 * @param aspApiBase - ASP API base URL
 * @param chainId - Chain ID
 * @param scope - Pool SCOPE as bigint (sent as decimal string in X-Pool-Scope header)
 */
export async function getAspRoots(
  aspApiBase: string,
  chainId: number,
  scope: bigint
): Promise<AspRoots> {
  const res = await fetch(`${aspApiBase}/${chainId}/public/mt-roots`, {
    headers: { 'X-Pool-Scope': scope.toString() },
  });

  if (!res.ok) {
    throw new Error(`ASP mt-roots error: ${res.status} ${await res.text()}`);
  }

  const data = (await res.json()) as {
    mtRoot: string;
    onchainMtRoot: string;
    createdAt: string;
  };

  return {
    mtRoot: BigInt(data.mtRoot),
    onchainMtRoot: BigInt(data.onchainMtRoot),
    createdAt: data.createdAt,
  };
}

/**
 * Fetch approved labels from the ASP.
 * These are needed to build the ASP Merkle proof for withdrawal.
 *
 * @param aspApiBase - ASP API base URL
 * @param chainId - Chain ID
 * @param scope - Pool SCOPE as bigint
 */
export async function getAspLeaves(
  aspApiBase: string,
  chainId: number,
  scope: bigint
): Promise<AspLeaves> {
  const res = await fetch(`${aspApiBase}/${chainId}/public/mt-leaves`, {
    headers: { 'X-Pool-Scope': scope.toString() },
  });

  if (!res.ok) {
    throw new Error(`ASP mt-leaves error: ${res.status} ${await res.text()}`);
  }

  const data = (await res.json()) as {
    aspLeaves: string[];
    stateTreeLeaves: string[];
  };

  return {
    aspLeaves: data.aspLeaves.map(BigInt),
    stateTreeLeaves: data.stateTreeLeaves.map(BigInt),
  };
}

/**
 * Fetch relayer configuration for an asset.
 */
export async function getRelayerDetails(
  relayerApiBase: string,
  chainId: number,
  assetAddress: string
): Promise<{
  feeBPS: number;
  feeReceiverAddress: string;
  minWithdrawAmount: bigint;
  maxGasPrice: bigint;
}> {
  const res = await fetch(
    `${relayerApiBase}/relayer/details?chainId=${chainId}&assetAddress=${assetAddress}`
  );

  if (!res.ok) {
    throw new Error(`Relayer details error: ${res.status} ${await res.text()}`);
  }

  const data = (await res.json()) as {
    feeBPS: string;
    feeReceiverAddress: string;
    minWithdrawAmount: string;
    maxGasPrice: string;
  };

  return {
    feeBPS: Number(data.feeBPS),
    feeReceiverAddress: data.feeReceiverAddress,
    minWithdrawAmount: BigInt(data.minWithdrawAmount),
    maxGasPrice: BigInt(data.maxGasPrice),
  };
}
