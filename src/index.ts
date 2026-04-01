// Key derivation
export {
  deriveMnemonic,
  deriveMasterKeys,
  deriveDepositSecrets,
  deriveWithdrawalSecrets,
  computePrecommitment,
  buildCommitment,
  computeNullifierHash,
  bigintToHash,
  type MasterKeys,
} from './keys.js';

// Chain scanning
export {
  scanPoolEvents,
  findDepositsByAddress,
  getPoolState,
  type ScanResult,
  type DepositRecord,
  type WithdrawalRecord,
} from './scanner.js';

// Proof generation
export {
  formatProof,
  createSdk,
  generateCommitmentProof,
  generateWithdrawalProof,
  generateMerkleProof,
  calculateContext,
  type FormattedProof,
} from './proofs.js';

// ASP API
export {
  getDepositStatuses,
  getAspRoots,
  getAspLeaves,
  getRelayerDetails,
  type ReviewStatus,
  type AspRoots,
  type AspLeaves,
  type DepositEvent,
  type GetDepositStatusesOptions,
} from './asp.js';

// Fee calculations
export {
  getAssetFeeConfig,
  calculateGrossDeposit,
  calculateFeeAmount,
  calculateNetPoolValue,
  type AssetFeeConfig,
} from './fees.js';

// Contract ABIs
export { ENTRYPOINT_ABI, POOL_ABI } from './abi.js';

// Relayed withdrawal helpers
export { encodeRelayData, buildRelayedWithdrawalCalldata } from './relay.js';

// Commitment discovery
export { discoverCommitments, type DiscoverOptions } from './discovery.js';

// Commitment selection
export {
  selectCommitments,
  MAX_COMMITMENTS_PER_WITHDRAWAL,
  type WithdrawableCommitment,
  type SelectedCommitment,
} from './selection.js';

// Chain configuration
export {
  CHAIN_CONFIGS,
  getChainConfig,
  computeScope,
  type ChainConfig,
  type PoolConfig,
} from './config.js';
