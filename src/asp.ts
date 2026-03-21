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

/**
 * Check the review status of a deposit via the ASP events API.
 *
 * @param aspApiBase - ASP API base URL (e.g., https://dw.0xbow.io)
 * @param chainId - Chain ID
 * @param precommitmentHash - The deposit's precommitment hash (decimal string)
 */
export async function getDepositStatus(
  aspApiBase: string,
  chainId: number,
  precommitmentHash: bigint
): Promise<DepositEvent | null> {
  const precommitmentStr = precommitmentHash.toString();
  const maxPages = 10;

  for (let page = 1; page <= maxPages; page++) {
    const res = await fetch(
      `${aspApiBase}/global/public/events?chainId=${chainId}&action=deposit&perPage=50&page=${page}`
    );
    if (!res.ok) return null;

    const data = (await res.json()) as {
      events: DepositEvent[];
      total: number;
    };
    const match = data.events.find(
      (e) => e.precommitmentHash === precommitmentStr
    );
    if (match) return match;

    // Stop if we've exhausted all pages
    if (page * 50 >= data.total) break;
  }

  return null;
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
