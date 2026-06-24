'use strict';

/**
 * CargoClaw — Loading-Meter (LDM) engine.
 *
 * Computes truck-fleet requirements for NON-STACKABLE freight using a
 * shelf/row 2D bin-packing heuristic over a standard EU mega-trailer floor.
 *
 * This is the deterministic core that the autonomous agent reasons over.
 * It is intentionally dependency-free and pure so it can be unit-tested and
 * audited independently of the blockchain layer.
 */

// Standard EU mega-trailer internal floor (metres).
const TRUCK_WIDTH = 2.45;
const TRUCK_LENGTH = 13.6;
const ROW_LENGTH_TOLERANCE = 0.3; // pallets within 30cm length share a row

/**
 * @typedef {Object} PalletSpec
 * @property {number} width    metres
 * @property {number} length   metres
 * @property {number} quantity count
 * @property {string} [ref]    optional manifest reference
 */

/**
 * @param {PalletSpec[]} pallets
 * @returns {{
 *   trucksRequired: number,
 *   totalLdm: number,
 *   utilizationPct: number,
 *   palletCount: number,
 *   breakdown: Array<{truck:number, ldmUsed:number, fillPct:number, pallets:number}>
 * }}
 */
function calculateTruckRequirements(pallets) {
  if (!Array.isArray(pallets) || pallets.length === 0) {
    throw new Error('pallets must be a non-empty array');
  }

  // Explode quantities, normalise so the longer side runs along the trailer.
  const units = [];
  for (const p of pallets) {
    const width = Number(p.width);
    const length = Number(p.length);
    const qty = Number(p.quantity);
    if (!(width > 0) || !(length > 0) || !Number.isInteger(qty) || qty <= 0) {
      throw new Error(`invalid pallet spec: ${JSON.stringify(p)}`);
    }
    if (Math.min(width, length) > TRUCK_WIDTH) {
      throw new Error(`pallet ${p.ref || ''} is wider than the trailer (${TRUCK_WIDTH}m)`);
    }
    for (let i = 0; i < qty; i++) {
      units.push({ w: Math.min(width, length), l: Math.max(width, length), ref: p.ref });
    }
  }

  // Longest pallets first — classic shelf-packing First-Fit-Decreasing.
  units.sort((a, b) => b.l - a.l);

  /** @type {Array<{usedLength:number, palletCount:number, rows:Array<{length:number, remainingWidth:number}>}>} */
  const trucks = [{ usedLength: 0, palletCount: 0, rows: [] }];

  for (const u of units) {
    let placed = false;

    for (const truck of trucks) {
      // 1) Try to slot beside an existing row of similar length.
      const row = truck.rows.find(
        (r) => r.remainingWidth >= u.w && Math.abs(r.length - u.l) <= ROW_LENGTH_TOLERANCE
      );
      if (row) {
        row.remainingWidth -= u.w;
        truck.palletCount++;
        placed = true;
        break;
      }
      // 2) Otherwise open a new row if the trailer has length left.
      if (truck.usedLength + u.l <= TRUCK_LENGTH + 1e-9) {
        truck.rows.push({ length: u.l, remainingWidth: TRUCK_WIDTH - u.w });
        truck.usedLength += u.l;
        truck.palletCount++;
        placed = true;
        break;
      }
    }

    // 3) No room anywhere — dispatch another truck.
    if (!placed) {
      trucks.push({
        usedLength: u.l,
        palletCount: 1,
        rows: [{ length: u.l, remainingWidth: TRUCK_WIDTH - u.w }],
      });
    }
  }

  const totalLdm = trucks.reduce((sum, t) => sum + t.usedLength, 0);
  const capacityLdm = trucks.length * TRUCK_LENGTH;
  const utilizationPct = round((totalLdm / capacityLdm) * 100, 1);

  return {
    trucksRequired: trucks.length,
    totalLdm: round(totalLdm, 2),
    utilizationPct,
    palletCount: units.length,
    breakdown: trucks.map((t, i) => ({
      truck: i + 1,
      ldmUsed: round(t.usedLength, 2),
      fillPct: round((t.usedLength / TRUCK_LENGTH) * 100, 1),
      pallets: t.palletCount,
    })),
  };
}

function round(n, dp) {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

module.exports = { calculateTruckRequirements, TRUCK_WIDTH, TRUCK_LENGTH };
