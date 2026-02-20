/**
 * src/pricing_engine_v2.js
 * Pricing engine that returns:
 *   - primary option: exact duration requested
 *   - reference options: 7 days and 30 days (or 1 day if duplicate)
 *
 * Designed for SaaS rentals (MXN) with VAT separated.
 */

function roundMx(n) {
  // MXN integer rounding
  return Math.round(Number(n || 0));
}

function computeVat(subtotalMx, vatRate) {
  return roundMx(subtotalMx * vatRate);
}

/**
 * 45 ft pricing rules (MXN)
 * - Escalado por día para duraciones "exactas" fuera de 7 y 30
 * - 7 y 30 tienen precio fijo (por tu especificación)
 */
function rentalBase45ftMx(durationDays) {
  const d = Number(durationDays);

  if (!Number.isFinite(d) || d <= 0) {
    throw new Error(`Invalid durationDays: ${durationDays}`);
  }

  // Fixed bundles
  if (d === 7) return 15400;
  if (d === 30) return 31500;

  // Tiered daily rates
  let ratePerDay;
  if (d >= 1 && d <= 3) ratePerDay = 2300;
  else if (d >= 4 && d <= 6) ratePerDay = 2200;
  else if (d >= 7 && d <= 13) ratePerDay = 1900;
  else if (d >= 14 && d <= 29) ratePerDay = 1300;
  else ratePerDay = 1050; // 30+

  return roundMx(d * ratePerDay);
}

/**
 * Main compute function
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

  // ---- Equipment routing (extendable) ----
  // For now: 45ft only.
  const model = String(equipmentModel || "45FT").toUpperCase();
  if (model !== "45FT" && model !== "45" && model !== "45_PIES" && model !== "JLG45") {
    // You can extend here with other models.
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

  // References: 7 and 30, but avoid duplicates.
  const wantedRefs = [7, 30];

  const refs = [];
  for (const refDays of wantedRefs) {
    if (refDays !== d) refs.push(makeOption(refDays));
  }

  // If duplicate happened (d is 7 or 30), fill 3rd column with 1 day (quick anchor)
  if (refs.length < 2) {
    const fallback = 1;
    if (fallback !== d && !refs.some(r => r.durationDays === fallback)) {
      refs.push(makeOption(fallback));
    }
  }

  // Ensure we return exactly 3 options: [primary, ref1, ref2]
  const options = [primary, ...refs].slice(0, 3);

  return {
    options,
    primary,
    references: refs.slice(0, 2),
  };
}

module.exports = {
  computeComparativeOptions,
};
