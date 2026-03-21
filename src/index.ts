// Key derivation
export {
  PP_SIGN_MESSAGE,
  deriveMnemonic,
  deriveMasterKeys,
  deriveDepositSecrets,
  deriveWithdrawalSecrets,
  computePrecommitment,
  buildCommitment,
  bigintToHash,
} from './keys.js';

// Chain scanning
export {
  scanPoolEvents,
  findUserDeposits,
  getPoolState,
  type ScanResult,
  type DepositRecord,
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
  getDepositStatus,
  getAspRoots,
  getAspLeaves,
  getRelayerDetails,
  type ReviewStatus,
  type AspRoots,
  type AspLeaves,
  type DepositEvent,
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

// Chain configuration
export {
  CHAIN_CONFIGS,
  getChainConfig,
  type ChainConfig,
  type PoolConfig,
} from './config.js';
