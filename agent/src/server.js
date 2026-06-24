'use strict';

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { ethers } = require('ethers');

const { calculateTruckRequirements } = require('./logistics');
const { decide } = require('./decisionEngine');
const circle = require('./circleClient');

const app = express();
app.use(express.json());
app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));

const PORT = process.env.PORT || 3000;
const CONTRACT = process.env.ESCROW_CONTRACT_ADDRESS;
const AGENT_WALLET_ID = process.env.CIRCLE_AGENT_WALLET_ID; // signs confirmDelivery
const BUYER_WALLET_ID = process.env.CIRCLE_BUYER_WALLET_ID; // funds the escrow
// USDC ERC-20 interface on Arc (6 decimals). Native gas token is the same asset.
const USDC_ADDRESS = process.env.USDC_ADDRESS || '0x3600000000000000000000000000000000000000';

// In-memory idempotency + shipment registry (swap for Redis/SQLite in prod).
const seen = new Map();

// --- helpers ---------------------------------------------------------------
const idOf = (shipmentRef) => ethers.id(String(shipmentRef)); // bytes32
const usdc6 = (human) => ethers.parseUnits(String(human), 6).toString();
const log = (...a) => console.log(new Date().toISOString(), ...a);

function requireEnv() {
  const missing = ['ESCROW_CONTRACT_ADDRESS', 'CIRCLE_API_KEY', 'CIRCLE_ENTITY_SECRET', 'CIRCLE_AGENT_WALLET_ID']
    .filter((k) => !process.env[k]);
  return missing;
}

// --- health / status -------------------------------------------------------
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'cargoclaw-agent', contract: CONTRACT || null, missingEnv: requireEnv() });
});

/**
 * STEP 1 — Buyer registers + funds a shipment.
 * Body: { shipmentRef, carrierAddress, priceUsdc, deadlineMinutes?, pallets:[{width,length,quantity}] }
 */
app.post('/webhook/cargo', async (req, res) => {
  try {
    const { shipmentRef, carrierAddress, priceUsdc, pallets, deadlineMinutes = 60 } = req.body || {};
    if (!shipmentRef || !carrierAddress || !priceUsdc || !pallets) {
      return res.status(400).json({ error: 'shipmentRef, carrierAddress, priceUsdc and pallets are required' });
    }
    if (!ethers.isAddress(carrierAddress)) {
      return res.status(400).json({ error: 'carrierAddress is not a valid address' });
    }
    if (seen.has(shipmentRef)) {
      return res.status(409).json({ error: 'shipmentRef already processed', shipment: seen.get(shipmentRef) });
    }

    // 1) Deterministic logistics analysis (the agent's domain reasoning).
    const analysis = calculateTruckRequirements(pallets);
    const shipmentId = idOf(shipmentRef);
    const amount = usdc6(priceUsdc);
    const deadline = Math.floor(Date.now() / 1000) + deadlineMinutes * 60;
    log(`[cargo] ${shipmentRef} -> ${analysis.trucksRequired} truck(s), ${analysis.totalLdm} LDM`);

    // 2) On-chain: buyer wallet creates the escrow (separate identity from the agent).
    const buyer = BUYER_WALLET_ID || AGENT_WALLET_ID;
    const createTx = await circle.executeContract({
      walletId: buyer,
      contractAddress: CONTRACT,
      abiFunctionSignature: 'createShipment(bytes32,address,uint256,uint64)',
      abiParameters: [shipmentId, carrierAddress, amount, String(deadline)],
    });
    log(`[cargo] createShipment confirmed: ${createTx.txHash}`);

    // 3) Buyer approves the escrow to pull USDC, then funds it (status -> InTransit).
    await circle.executeContract({
      walletId: buyer,
      contractAddress: USDC_ADDRESS,
      abiFunctionSignature: 'approve(address,uint256)',
      abiParameters: [CONTRACT, amount],
    });
    const fundTx = await circle.executeContract({
      walletId: buyer,
      contractAddress: CONTRACT,
      abiFunctionSignature: 'fundEscrow(bytes32)',
      abiParameters: [shipmentId],
    });
    log(`[cargo] escrow funded: ${fundTx.txHash}`);

    const record = {
      shipmentRef, shipmentId, carrierAddress, priceUsdc, deadline,
      analysis, createTxHash: createTx.txHash, fundTxHash: fundTx.txHash, status: 'FUNDED',
    };
    seen.set(shipmentRef, record);
    return res.status(200).json({
      status: 'success', metrics: analysis,
      createTxHash: createTx.txHash, fundTxHash: fundTx.txHash, shipmentId,
    });
  } catch (err) {
    log('[cargo] error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * STEP 2 — Proof-of-delivery arrives; the agent reasons and (if verified) releases.
 * Body: { shipmentRef, pod:{ verified:boolean, deliveredPallets:number, signer?:string } }
 */
app.post('/webhook/deliver', async (req, res) => {
  try {
    const { shipmentRef, pod } = req.body || {};
    const record = seen.get(shipmentRef);
    if (!record) return res.status(404).json({ error: 'unknown shipmentRef; create it first' });

    // 1) Agentic decision step — genuine reasoning, not a timer.
    const verdict = await decide({
      analysis: record.analysis,
      pod,
      expectedPallets: record.analysis.palletCount,
    });
    log(`[deliver] ${shipmentRef} verdict=${verdict.verdict} (${verdict.source}) — ${verdict.reason}`);

    record.verdict = verdict;

    if (verdict.verdict !== 'RELEASE') {
      // For DISPUTE, flag on-chain so the arbiter path is on the record.
      if (verdict.verdict === 'DISPUTE') {
        const dTx = await circle.executeContract({
          walletId: AGENT_WALLET_ID,
          contractAddress: CONTRACT,
          abiFunctionSignature: 'raiseDispute(bytes32)',
          abiParameters: [record.shipmentId],
        });
        record.status = 'DISPUTED';
        record.disputeTxHash = dTx.txHash;
        return res.status(200).json({ status: 'disputed', verdict, disputeTxHash: dTx.txHash });
      }
      record.status = 'HELD';
      return res.status(200).json({ status: 'held', verdict });
    }

    // 2) RELEASE — agent confirms delivery; escrow pays the carrier in USDC.
    const releaseTx = await circle.executeContract({
      walletId: AGENT_WALLET_ID,
      contractAddress: CONTRACT,
      abiFunctionSignature: 'confirmDelivery(bytes32)',
      abiParameters: [record.shipmentId],
    });
    record.status = 'SETTLED';
    record.releaseTxHash = releaseTx.txHash;
    log(`[deliver] settled: ${releaseTx.txHash}`);
    return res.status(200).json({ status: 'settled', verdict, releaseTxHash: releaseTx.txHash });
  } catch (err) {
    log('[deliver] error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// Lightweight read model for the dashboard.
app.get('/shipments', (_req, res) => res.json([...seen.values()]));

app.listen(PORT, () => {
  const missing = requireEnv();
  log(`CargoClaw agent listening on :${PORT}`);
  if (missing.length) log('WARNING — missing env (Circle mode disabled until set):', missing.join(', '));
});
