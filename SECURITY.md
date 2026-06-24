# Security

## Key management

CargoClaw holds **no raw private keys**. All signing is delegated to Circle
Developer-Controlled Wallets (MPC) via an entity secret that is:

- generated and registered by the operator, never by tooling,
- kept only in `agent/.env` (gitignored) and a recovery file stored **outside** the repo,
- never logged. Application logs print transaction hashes and wallet *ids*, never secrets.

`.gitignore` blocks `.env*` (except `.env.example`), `*.pem`, and `*recovery*.json`
from the first commit.

## Incident note (v1 → v2)

The original prototype committed an `agent/.env` containing a testnet
`AGENT_PRIVATE_KEY` and an escrow address, and committed `node_modules/`. The
`.gitignore` was added after the file was already tracked, so it had no effect.

**Remediation taken in v2:**

1. The leaked key is treated as **burned**. It is not used anywhere in v2.
2. The raw-key signing path is removed entirely; the agent now signs only via
   Circle Developer-Controlled Wallets.
3. The escrow is redeployed with `constructor(USDC, AGENT_WALLET_ADDRESS)` so the
   arbiter role belongs to a Circle wallet, not a leaked EOA.
4. History is purged: v2 ships as a clean tree (no `node_modules`, no secrets).
   If reusing the original repo, scrub history with `git filter-repo` rather than
   a delete-only commit, since the secret remains recoverable from old commits otherwise.

## On-chain safety properties

- **No stuck funds.** `refundExpired` lets anyone return a funded-but-undelivered
  shipment to the sender after its deadline.
- **Release at most once.** State machine (`Pending → InTransit → Delivered/Refunded`)
  plus a reentrancy guard.
- **Bounded agent authority.** The arbiter can only move escrowed USDC to the named
  carrier (release) or back to the sender (refund). It has no general withdraw.

## Reporting

Open a private security advisory on the GitHub repo.
