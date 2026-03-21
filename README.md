# @cloakedxyz/clkd-privacy-pools

Key derivation, proof generation, and recovery tools for [0xbow Privacy Pools](https://privacypools.com) integration in [Cloaked](https://clkd.xyz).

## What this does

- Derives Privacy Pools secrets deterministically from a wallet signature (nothing to store)
- Scans the chain for deposits and matches them to a wallet's key material
- Generates ZK proofs for withdrawal and ragequit (commitment proofs)
- Queries the ASP API for deposit review status and Merkle data
- Calculates deposit fees from on-chain config

## Install

```bash
pnpm add @cloakedxyz/clkd-privacy-pools
```

## Usage

```typescript
import {
  deriveMnemonic,
  deriveMasterKeys,
  deriveDepositSecrets,
  computePrecommitment,
  scanPoolEvents,
  getChainConfig,
} from '@cloakedxyz/clkd-privacy-pools';

// Derive PP secrets from a wallet signature
const mnemonic = await deriveMnemonic(signature);
const masterKeys = deriveMasterKeys(mnemonic);
const secrets = deriveDepositSecrets(masterKeys, poolScope, 0n);
const precommitment = computePrecommitment(secrets.nullifier, secrets.secret);

// Scan the chain for deposits
const config = getChainConfig(11155111); // Sepolia
const { depositsByPrecommitment } = await scanPoolEvents(
  publicClient,
  config.pools['ETH'].address,
  config.startBlock,
  latestBlock
);
```

## Supported chains

| Chain | ID | ASP API |
|-------|-----|---------|
| Ethereum | 1 | api.0xbow.io |
| Sepolia | 11155111 | dw.0xbow.io |

## Security

- Domain-separated key derivation (`keccak256(encodePacked("privacy-pools-v1", signature))`) ensures PP keys are cryptographically independent from stealth address keys derived from the same wallet signature
- All proof generation runs client-side — no server ever sees user secrets
- No private keys or secrets are stored — everything re-derives from the wallet

## License

MIT
