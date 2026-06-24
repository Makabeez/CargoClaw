const assert = require('assert');
const { calculateTruckRequirements } = require('../src/logistics');

// One full truck-ish load of standard EUR pallets (1.2 x 0.8), non-stackable.
const r1 = calculateTruckRequirements([{ width: 0.8, length: 1.2, quantity: 33, ref: 'EUR' }]);
assert.ok(r1.trucksRequired >= 1, 'at least one truck');
assert.ok(r1.totalLdm > 0, 'ldm computed');
console.log('  EUR x33 ->', r1.trucksRequired, 'truck(s),', r1.totalLdm, 'LDM,', r1.utilizationPct + '% util');

// Oversized non-stackable that overflows one trailer.
const r2 = calculateTruckRequirements([{ width: 2.4, length: 4.0, quantity: 5, ref: 'BIG' }]);
assert.ok(r2.trucksRequired >= 2, 'oversized load needs multiple trucks');
console.log('  BIG x5  ->', r2.trucksRequired, 'truck(s),', r2.totalLdm, 'LDM');

// Mixed manifest.
const r3 = calculateTruckRequirements([
  { width: 0.8, length: 1.2, quantity: 10, ref: 'EUR' },
  { width: 1.0, length: 1.2, quantity: 6, ref: 'IND' },
]);
assert.strictEqual(r3.palletCount, 16, 'pallet count exploded correctly');
console.log('  MIXED   ->', r3.trucksRequired, 'truck(s),', r3.palletCount, 'pallets');

// Invalid input rejected.
assert.throws(() => calculateTruckRequirements([]), /non-empty/);
assert.throws(() => calculateTruckRequirements([{ width: 2.6, length: 3.0, quantity: 1 }]), /wider than/);
console.log('  validation: OK');
console.log('logistics.test.js PASSED');
