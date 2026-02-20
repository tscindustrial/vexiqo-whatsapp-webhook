/**
 * src/pricing_engine_v2.js
 * Pricing engine that returns:
 *   - primary option: exact duration requested
 *   - reference options: 7 days and 30 days (or 1 day if duplicate)
 *
 * 45 ft pricing rules (MXN, SIN IVA) per master doc:
 * - 1–3 días:  $2,300 / día
 * - 4–7 días:  $2,200 / día  (pero 7 días tiene precio fijo)
 * - 8–14 días: $1,800 / día
 * - 15–21 días:$1,500 / día
 * - >21 días:  $1,050 / día
 * - 7 días fijo:  $15,400
 * - 30 días fijo: $31,500 (exacto)
 */

function roundMx(n) {
  return Math.round(Number(n || 0));
}

function computeVat(subtotalMx, vatRate) {
  return roundMx(subtotalMx * vatRate);
}

function rentalBase45ftMx(durationDays) {
  const d = Number(durationDays);

  if (!Number.isFinite(d) || d <= 0) {
    throw new Error(`Invalid durationDays: ${durationDays}`);
  }

  // Fixed bundles (override tiers)
  if (d === 7) return 15400;
  if (d === 30) return 31500;

  // Tiered daily rates (per master doc)
  let ratePerDay;
  if (d >= 1 && d <= 3) ratePerDay = 2300;
  else if (d >= 4 && d <= 7) ratePerDay = 2200;
  else if (d >= 8 && d <= 14) ratePerDay = 1800;
  else if (d >= 15 && d <= 21) ratePerDay = 1500;
  else ratePerDay = 1050; // >21

  return roundMx(d * ratePerDay);
}

/**
 * @param {Object} input
 * @param {number} input.durationDays - exact days requested by customer
 * @param {string} input.equipmentModel - e.g. "45FT" (for now we implement 45ft only)
 * @param {number} input.transportRoundTripMx - roundtrip transport (MXN, without VAT)
 * @param {number=} input.vatRate - default 0.16
 * @returns {{ options: Array, primary: Object, references: Object[] }}
 */
function computeComparativeOptions(input) {
  const {
    durationDays,
    equipmentModel,
    transportRoundTripMx,
    vatRate = 0.16,
  } = input || {};

  const d = Number(durationDays);
  if (!Number.isFinite(d) || d <= 0) {
    throw new Error(`durationDays must be a positive number. Got: ${durationDays}`);
  }

  const transportMx = roundMx(transportRoundTripMx || 0);

  // Equipment routing (extend later)
  const model = String(equipmentModel || "45FT").toUpperCase();
  if (model !== "45FT" && model !== "45" && model !== "45_PIES" && model !== "JLG45") {
    throw new Error(`Unsupported equipmentModel for pricing_engine_v2: ${equipmentModel}`);
  }

  const makeOption = (days) => {
    const rentalBaseMx = rentalBase45ftMx(days);
    const subtotalMx = roundMx(rentalBaseMx + transportMx);
    const vatMx = computeVat(subtotalMx, vatRate);
    const totalMx = roundMx(subtotalMx + vatMx);

    return {
      durationDays: days,
      rentalBaseMx,
      transportMx,
      subtotalMx,
      vatMx,
      totalMx,
    };
  };

  // Primary = exact request
  const primary = makeOption(d);

  // References = 7 and 30, avoiding duplicates
  const refs = [];
  for (const refDays of [7, 30]) {
    if (refDays !== d) refs.push(makeOption(refDays));
  }

  // If requested is 7 or 30, fill with 1-day as third anchor
  if (refs.length < 2) {
    const fallback = 1;
    if (fallback !== d && !refs.some(r => r.durationDays === fallback)) {
      refs.push(makeOption(fallback));
    }
  }

  const options = [primary, ...refs].slice(0, 3);

  return { options, primary, references: refs.slice(0, 2) };
}

module.exports = {
  computeComparativeOptions,
};
