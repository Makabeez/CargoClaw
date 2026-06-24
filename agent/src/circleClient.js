'use strict';

/**
 * CargoClaw — Circle Developer-Controlled Wallets adapter.
 *
 * This is the security backbone of the project. The autonomous agent NEVER
 * holds a raw private key. All signing is delegated to Circle's MPC
 * infrastructure via an entity secret that is registered once and never
 * committed. On Arc, gas is paid in USDC (no separate native gas token),
 * so funding a wallet with USDC also covers execution fees.
 *
 * Docs: https://developers.circle.com/sdks/developer-controlled-wallets-nodejs-sdk
 */

const crypto = require('crypto');
const { initiateDeveloperControlledWalletsClient } = require('@circle-fin/developer-controlled-wallets');

const BLOCKCHAIN = 'ARC-TESTNET';
const TERMINAL = new Set(['COMPLETE', 'FAILED', 'DENIED', 'CANCELLED']);

function makeClient() {
  const apiKey = process.env.CIRCLE_API_KEY;
  const entitySecret = process.env.CIRCLE_ENTITY_SECRET;
  if (!apiKey || !entitySecret) {
    throw new Error('CIRCLE_API_KEY and CIRCLE_ENTITY_SECRET are required for Circle mode');
  }
  // The SDK generates a fresh entity-secret ciphertext per request automatically.
  return initiateDeveloperControlledWalletsClient({ apiKey, entitySecret });
}

const uuid = () => crypto.randomUUID();

/**
 * Provision a wallet set + N EOA wallets on Arc Testnet.
 * Returns the wallet set id and the created wallets (id + address).
 */
async function provisionWallets(names = ['cargoclaw-agent']) {
  const client = makeClient();

  const setRes = await client.createWalletSet({ name: 'CargoClaw WalletSet' });
  const walletSetId = setRes.data?.walletSet?.id;
  if (!walletSetId) throw new Error('failed to create wallet set');

  const walletsRes = await client.createWallets({
    blockchains: [BLOCKCHAIN],
    accountType: 'EOA',
    count: names.length,
    walletSetId,
    idempotencyKey: uuid(),
  });

  const wallets = (walletsRes.data?.wallets || []).map((w, i) => ({
    label: names[i] || `wallet-${i}`,
    id: w.id,
    address: w.address,
    blockchain: w.blockchain,
  }));

  return { walletSetId, wallets };
}

/** USDC balance for a wallet (token symbol match), as a human string. */
async function getUsdcBalance(walletId) {
  const client = makeClient();
  // NOTE: getWallet does NOT return balances; must use the balances endpoint.
  const res = await client.getWalletTokenBalance({ id: walletId });
  const balances = res.data?.tokenBalances || [];
  const usdc = balances.find((b) => (b.token?.symbol || '').toUpperCase().includes('USDC'));
  return usdc ? usdc.amount : '0';
}

/**
 * Execute a contract function from a Circle wallet and wait for a terminal state.
 * Prefers ABI signature + params over raw calldata for auditability.
 *
 * @returns {Promise<{id:string, state:string, txHash:string|null}>}
 */
async function executeContract({ walletId, contractAddress, abiFunctionSignature, abiParameters = [] }) {
  const client = makeClient();

  const res = await client.createContractExecutionTransaction({
    walletId,
    contractAddress,
    abiFunctionSignature,
    abiParameters,
    fee: { type: 'level', config: { feeLevel: 'HIGH' } },
    idempotencyKey: uuid(),
  });

  const id = res.data?.id;
  if (!id) throw new Error('contract execution did not return a transaction id');

  return waitForTransaction(client, id);
}

/** Poll a transaction until terminal. Webhooks are preferred in production; this is the simple-script path. */
async function waitForTransaction(client, id, { timeoutMs = 90_000, intervalMs = 3_000 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const res = await client.getTransaction({ id });
    const tx = res.data?.transaction;
    const state = tx?.state;
    if (state && TERMINAL.has(state)) {
      if (state !== 'COMPLETE') {
        throw new Error(`transaction ${id} reached non-success terminal state: ${state}`);
      }
      return { id, state, txHash: tx.txHash || null };
    }
    await sleep(intervalMs);
  }
  throw new Error(`transaction ${id} timed out before reaching a terminal state`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = {
  BLOCKCHAIN,
  provisionWallets,
  getUsdcBalance,
  executeContract,
};
