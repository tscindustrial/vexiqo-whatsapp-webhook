/**
 * src/pricing_engine_v2.js (ESM)
 *
 * 45 ft pricing rules (MXN, SIN IVA) per master:
 * - 1–3 días:   $2,300 / día
 * - 4–7 días:   $2,200 / día  (pero 7 días tiene precio fijo)
 * - 8–14 días:  $1,800 / día
 * - 15–21 días: $1,500 / día
 * - >21 días:   $1,050 / día
 * - 7 días fijo:  $15,400
 * - 30 días fijo: $31,500
 *
 * Returns 3 columns for PDF:
 *  - primary: exact requested duration
 *  - refs: 7 and 30 (or 1 day fallback if duplicate)
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

  // Fixed bundles override tiers
  if (d === 7) return 15400;
  if (d === 30) return 31500;

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
 * @param {number} input.durationDays
 * @param {string} input.equipmentModel
 * @param {number} input.transportRoundTripMx
 * @param {number=} input.vatRate
 * @returns {{ options: Array, primary: Object, references: Object[] }}
 */
export function computeComparativeOptions(input) {
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

  const primary = makeOption(d);

  const refs = [];
  for (const refDays of [7, 30]) {
    if (refDays !== d) refs.push(makeOption(refDays));
  }

  if (refs.length < 2) {
    const fallback = 1;
    if (fallback !== d && !refs.some(r => r.durationDays === fallback)) {
      refs.push(makeOption(fallback));
    }
  }

  const options = [primary, ...refs].slice(0, 3);
  return { options, primary, references: refs.slice(0, 2) };
}
