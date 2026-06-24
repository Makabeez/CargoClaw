const assert = require('assert');
const { decide } = require('../src/decisionEngine');

(async () => {
  // No LLM configured -> deterministic rules.
  delete process.env.LLM_BASE_URL; delete process.env.LLM_API_KEY;

  const verified = await decide({ analysis: { totalLdm: 5, trucksRequired: 1, palletCount: 10 },
    pod: { verified: true, deliveredPallets: 10 }, expectedPallets: 10 });
  assert.strictEqual(verified.verdict, 'RELEASE');
  console.log('  verified match     ->', verified.verdict, `(${verified.source})`);

  const mismatch = await decide({ analysis: { palletCount: 10 },
    pod: { verified: true, deliveredPallets: 7 }, expectedPallets: 10 });
  assert.strictEqual(mismatch.verdict, 'DISPUTE');
  console.log('  quantity mismatch  ->', mismatch.verdict);

  const unverified = await decide({ analysis: { palletCount: 10 },
    pod: { verified: false, deliveredPallets: 10 }, expectedPallets: 10 });
  assert.strictEqual(unverified.verdict, 'HOLD');
  console.log('  unverified POD     ->', unverified.verdict);

  // Integrity invariant: even if something says RELEASE, no verified POD => HOLD.
  const invariant = await decide({ analysis: { palletCount: 1 },
    pod: { verified: false, deliveredPallets: 1 }, expectedPallets: 1 });
  assert.strictEqual(invariant.verdict, 'HOLD');
  console.log('  integrity invariant-> HOLD enforced');
  console.log('decision.test.js PASSED');
})();
