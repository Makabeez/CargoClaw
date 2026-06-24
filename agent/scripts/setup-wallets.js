'use strict';

/**
 * One-time setup: provision the CargoClaw agent + buyer wallets on Arc Testnet.
 *
 * Prereqs (do these yourself, never commit the outputs):
 *   1. Create a Circle developer account, generate an API key.
 *   2. Generate + register an entity secret:
 *      https://developers.circle.com/wallets/dev-controlled/register-entity-secret
 *      Store the recovery file OUTSIDE this repo.
 *   3. Put CIRCLE_API_KEY and CIRCLE_ENTITY_SECRET in agent/.env (gitignored).
 *
 * Run:  node scripts/setup-wallets.js
 * Then fund the printed addresses with Arc Testnet USDC (gas on Arc is USDC).
 */

require('dotenv').config();
const { provisionWallets } = require('../src/circleClient');

(async () => {
  try {
    const { walletSetId, wallets } = await provisionWallets(['cargoclaw-agent', 'cargoclaw-buyer']);
    console.log('\nWallet set created:', walletSetId, '\n');
    for (const w of wallets) {
      console.log(`  ${w.label.padEnd(18)} id=${w.id}  address=${w.address}`);
    }
    console.log('\nAdd these to agent/.env:');
    console.log(`  CIRCLE_AGENT_WALLET_ID=${wallets[0].id}`);
    console.log(`  CIRCLE_BUYER_WALLET_ID=${wallets[1].id}`);
    console.log('\nThen:');
    console.log(`  1. Fund both addresses with Arc Testnet USDC (covers gas + escrow).`);
    console.log(`  2. Deploy CargoEscrow with constructor(USDC_ADDR, ${wallets[0].address}).`);
    console.log(`  3. Set ESCROW_CONTRACT_ADDRESS in agent/.env.\n`);
  } catch (err) {
    console.error('setup failed:', err.message);
    process.exit(1);
  }
})();
