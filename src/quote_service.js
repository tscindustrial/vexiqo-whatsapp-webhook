/**
 * src/quote_service.js
 * Single entry-point to:
 *  - compute pricing (exact + 7/30 refs)
 *  - generate PDF buffer (Playwright)
 *  - persist QuoteRequest + QuoteItems (DRAFT) in Postgres via Prisma
 *
 * NOTE:
 *  - This does NOT send email yet.
 *  - This does NOT change state to SENT yet.
 */

const { PrismaClient } = require("@prisma/client");
const { computeComparativeOptions } = require("./pricing_engine_v2");
const { generateQuotePdfBuffer } = require("./pdf_quote");

const prisma = new PrismaClient();

/**
 * Minimal quote creation for procurement-friendly flow:
 * - Primary column = exact requested duration
 * - References = 7 and 30 (or 1 day fallback)
 *
 * @param {Object} input
 * @param {string} input.companyId
 * @param {Object} input.lead              // lead payload from extractor/state machine
 * @param {number} input.durationDays      // exact requested days
 * @param {string} input.transportZone
 * @param {number} input.transportRoundTripMx
 * @param {Object} input.equipment         // { type, height_m, terrain, activity, equipmentModel }
 * @param {Object=} input.meta             // snapshot: extractor output, conversation ids, etc
 *
 * @returns {Promise<{quoteId: string, quoteNumber: string, pdfBuffer: Buffer, filename: string, options: any[]}>}
 */
async function createDraftQuoteWithPdf(input) {
  const {
    companyId,
    lead,
    durationDays,
    transportZone,
    transportRoundTripMx,
    equipment,
    meta,
  } = input || {};

  if (!companyId) throw new Error("createDraftQuoteWithPdf: companyId is required");
  if (!lead) throw new Error("createDraftQuoteWithPdf: lead is required");
  if (!Number.isFinite(Number(durationDays)) || Number(durationDays) <= 0) {
    throw new Error(`createDraftQuoteWithPdf: durationDays invalid: ${durationDays}`);
  }

  const equipmentModel = (equipment && equipment.equipmentModel) ? equipment.equipmentModel : "45FT";

  // 1) Upsert Lead (by phone/email scoped to company)
  const leadRecord = await upsertLead(companyId, lead);

  // 2) Compute pricing: exact + refs
  const { options } = computeComparativeOptions({
    durationDays: Number(durationDays),
    equipmentModel,
    transportRoundTripMx: Number(transportRoundTripMx || 0),
    vatRate: 0.16,
  });

  // 3) Generate a quoteNumber sequential per company (simple, safe enough for now)
  // If you expect high concurrency, we’ll move this to a DB sequence later.
  const quoteNumber = await nextQuoteNumber(companyId);

  // 4) Persist QuoteRequest + QuoteItems as DRAFT
  const createdAtISO = new Date().toISOString();

  const quote = await prisma.quoteRequest.create({
    data: {
      companyId,
      leadId: leadRecord.id,
      quoteNumber,
      status: "DRAFT",

      transportZone: transportZone || null,
      transportRoundTripMx: Number(transportRoundTripMx || 0),

      // Store ONLY the exact requested totals as canonical fields for procurement
      // (options[0] is primary exact request by our contract)
      subtotalMx: options[0]?.subtotalMx ?? 0,
      vatMx: options[0]?.vatMx ?? 0,
      totalMx: options[0]?.totalMx ?? 0,

      // Snapshot
      meta: meta || null,

      items: {
        create: options.map((opt, idx) => ({
          lineNo: idx + 1,
          description:
            idx === 0
              ? `Renta solicitada (${opt.durationDays} días)`
              : opt.durationDays === 7
                ? "Referencia: Semana (7 días)"
                : opt.durationDays === 30
                  ? "Referencia: Mes (30 días)"
                  : `Referencia: ${opt.durationDays} días`,
          durationDays: opt.durationDays,
          unitPriceMx: opt.rentalBaseMx,
          amountMx: opt.totalMx,
        })),
      },
    },
    include: { items: true },
  });

  // 5) Generate PDF buffer
  const company = await prisma.company.findUnique({ where: { id: companyId } }).catch(() => null);

  const { buffer: pdfBuffer, filename } = await generateQuotePdfBuffer({
    company: company || {},
    lead: leadRecord,
    quote: {
      quoteNumber: quote.quoteNumber,
      createdAtISO,
      transportZone: transportZone || "",
    },
    equipment: {
      type: equipment?.type,
      height_m: equipment?.height_m,
      terrain: equipment?.terrain,
      activity: equipment?.activity,
    },
    options,
    requestedDays: Number(durationDays),
    terms: [
      "Importe principal corresponde exactamente a la duración solicitada.",
      "Precios sin IVA + IVA 16% por separado.",
      "Transporte redondo según zona (si aplica).",
      "Vigencia: 48 horas.",
    ],
  });

  // (Optional for next step): store pdfKey after uploading to storage
  // For now we return buffer so webhook/email can attach it immediately.

  return {
    quoteId: quote.id,
    quoteNumber: quote.quoteNumber,
    pdfBuffer,
    filename,
    options,
  };
}

/**
 * Upsert lead by (companyId + phone) if available else by (companyId + email) if available.
 * If neither exists, creates a new record.
 */
async function upsertLead(companyId, lead) {
  const phone = lead.phone ? String(lead.phone) : null;
  const email = lead.email ? String(lead.email).toLowerCase() : null;

  // Prefer phone if present
  if (phone) {
    const existing = await prisma.lead.findFirst({ where: { companyId, phone } });
    if (existing) {
      return prisma.lead.update({
        where: { id: existing.id },
        data: {
          name: lead.name || existing.name,
          email: email || existing.email,
          city: lead.city || existing.city,
        },
      });
    }
    return prisma.lead.create({
      data: {
        companyId,
        name: lead.name || null,
        phone,
        email,
        city: lead.city || null,
      },
    });
  }

  // Fallback to email
  if (email) {
    const existing = await prisma.lead.findFirst({ where: { companyId, email } });
    if (existing) {
      return prisma.lead.update({
        where: { id: existing.id },
        data: {
          name: lead.name || existing.name,
          phone: phone || existing.phone,
          city: lead.city || existing.city,
        },
      });
    }
    return prisma.lead.create({
      data: {
        companyId,
        name: lead.name || null,
        phone,
        email,
        city: lead.city || null,
      },
    });
  }

  // No phone/email: create anyway (WhatsApp flow usually has phone; if not, we handle later)
  return prisma.lead.create({
    data: {
      companyId,
      name: lead.name || null,
      phone: null,
      email: null,
      city: lead.city || null,
    },
  });
}

/**
 * Simple sequential quote number per company.
 * For now: Q-YYYY-000001 style, based on count.
 * If you have multiple concurrent quotes, we’ll upgrade to an atomic sequence.
 */
async function nextQuoteNumber(companyId) {
  const year = new Date().getFullYear();
  const count = await prisma.quoteRequest.count({ where: { companyId } });
  const seq = String(count + 1).padStart(6, "0");
  return `Q-${year}-${seq}`;
}

module.exports = {
  createDraftQuoteWithPdf,
};
