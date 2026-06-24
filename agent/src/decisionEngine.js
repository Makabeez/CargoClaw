'use strict';

/**
 * CargoClaw — Autonomous decision engine.
 *
 * Replaces the "sleep then release" placeholder with a real agentic step.
 * Given (a) the LDM analysis and (b) a proof-of-delivery event, the agent
 * reasons over release criteria and returns a STRUCTURED, auditable verdict:
 *
 *     RELEASE  — pay the carrier
 *     HOLD     — do nothing yet (insufficient proof)
 *     DISPUTE  — flag for arbiter resolution (manifest mismatch / fraud signal)
 *
 * Integrity invariant (carried over from Obol): the agent only ever authorises
 * an on-chain RELEASE when delivery is independently verified (ok:true). The
 * LLM advises; this invariant is enforced in code and cannot be argued away.
 *
 * The LLM call targets any OpenAI-compatible endpoint (e.g. the local LiteLLM
 * router). If no endpoint/key is configured, a deterministic rule engine runs
 * so the agent is never a black box and always produces a verdict.
 */

const SYSTEM_PROMPT = `You are CargoClaw, an autonomous freight-settlement agent.
You decide whether escrowed USDC should be released to a carrier.
You are given a cargo manifest analysis and a proof-of-delivery (POD) event.
Return ONLY a JSON object, no prose, with this exact shape:
{"verdict":"RELEASE|HOLD|DISPUTE","confidence":0-1,"reason":"<one sentence>"}
Rules:
- RELEASE only if POD is verified AND delivered quantity matches the manifest.
- DISPUTE if quantities mismatch, POD signer is unexpected, or fraud is implied.
- HOLD if POD is missing or unverified.`;

/**
 * @param {object} input
 * @param {object} input.analysis      output of calculateTruckRequirements
 * @param {object} input.pod           { verified:boolean, deliveredPallets:number, signer?:string }
 * @param {number} input.expectedPallets
 * @returns {Promise<{verdict:'RELEASE'|'HOLD'|'DISPUTE', confidence:number, reason:string, source:'llm'|'rules'}>}
 */
async function decide({ analysis, pod, expectedPallets }) {
  const endpoint = process.env.LLM_BASE_URL;   // e.g. http://localhost:4000/v1
  const apiKey = process.env.LLM_API_KEY;
  const model = process.env.LLM_MODEL || 'agent-loop';

  let verdict;
  if (endpoint && apiKey) {
    try {
      verdict = await askLLM({ endpoint, apiKey, model, analysis, pod, expectedPallets });
      verdict.source = 'llm';
    } catch (err) {
      verdict = ruleEngine({ pod, expectedPallets });
      verdict.source = 'rules';
      verdict.reason += ` (llm unavailable: ${err.message})`;
    }
  } else {
    verdict = ruleEngine({ pod, expectedPallets });
    verdict.source = 'rules';
  }

  // ---- Integrity invariant: never RELEASE without verified delivery ----
  if (verdict.verdict === 'RELEASE' && !(pod && pod.verified === true)) {
    return {
      verdict: 'HOLD',
      confidence: 1,
      reason: 'Release blocked: delivery not independently verified (ok:true required).',
      source: verdict.source,
    };
  }
  return verdict;
}

async function askLLM({ endpoint, apiKey, model, analysis, pod, expectedPallets }) {
  const body = {
    model,
    temperature: 0,
    max_tokens: 200,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: JSON.stringify({
          manifest: { expectedPallets, ldm: analysis.totalLdm, trucks: analysis.trucksRequired },
          proofOfDelivery: pod,
        }),
      },
    ],
  };

  const res = await fetch(`${endpoint.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content?.trim() || '';
  const json = JSON.parse(text.replace(/```json|```/g, '').trim());

  const verdict = String(json.verdict || '').toUpperCase();
  if (!['RELEASE', 'HOLD', 'DISPUTE'].includes(verdict)) {
    throw new Error(`invalid verdict from model: ${verdict}`);
  }
  return {
    verdict,
    confidence: clamp(Number(json.confidence ?? 0.5)),
    reason: String(json.reason || 'no reason provided'),
  };
}

/** Deterministic fallback — transparent, always available. */
function ruleEngine({ pod, expectedPallets }) {
  if (!pod || pod.verified !== true) {
    return { verdict: 'HOLD', confidence: 1, reason: 'Proof-of-delivery missing or unverified.' };
  }
  if (Number(pod.deliveredPallets) !== Number(expectedPallets)) {
    return {
      verdict: 'DISPUTE',
      confidence: 0.9,
      reason: `Manifest mismatch: expected ${expectedPallets} pallets, delivered ${pod.deliveredPallets}.`,
    };
  }
  return { verdict: 'RELEASE', confidence: 0.95, reason: 'Verified delivery, quantities match manifest.' };
}

const clamp = (n) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0.5);

module.exports = { decide };
