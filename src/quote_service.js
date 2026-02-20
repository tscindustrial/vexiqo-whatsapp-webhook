/**
 * src/quote_service.js (ESM)
 * Creates:
 *  - pricing options (exact + refs)
 *  - PDF buffer (Playwright)
 *  - QuoteRequest + QuoteItems (DRAFT) via Prisma
 */

import { PrismaClient } from "@prisma/client";
import { computeComparativeOptions } from "./pricing_engine_v2.js";
import { generateQuotePdfBuffer } from "./pdf_quote.js";

const prisma = new PrismaClient();

/**
 * @param {Object} input
 * @param {string} input.companyId
 * @param {Object} input.lead              // { name?, phone?, email?, city? }
 * @param {number} input.durationDays      // exact requested days
 * @param {string=} input.transportZone
 * @param {number=} input.transportRoundTripMx
 * @param {Object=} input.equipment         // { type, height_m, terrain, activity, equipmentModel }
 * @param {Object=} input.meta              // snapshot: extractor output, conversation ids, etc
 *
 * @returns {Promise<{quoteId:string, quoteNumber:string, pdfBuffer:Buffer, filename:string, options:any[]}>}
 */
export async function createDraftQuoteWithPdf(input) {
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

  const d = Number(durationDays);
  if (!Number.isFinite(d) || d <= 0) {
    throw new Error(`createDraftQuoteWithPdf: durationDays invalid: ${durationDays}`);
  }

  const equipmentModel = equipment?.equipmentModel || "45FT";

  // 1) Upsert Lead (scoped to company)
  const leadRecord = await upsertLead(companyId, lead);

  // 2) Pricing options: [primary exact, ref 7, ref 30] (or fallback 1D)
  const { options } = computeComparativeOptions({
    durationDays: d,
    equipmentModel,
    transportRoundTripMx: Number(transportRoundTripMx || 0),
    vatRate: 0.16,
  });

  // 3) Quote number (simple sequential per company)
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

      // Canonical totals = EXACT requested duration (options[0])
      subtotalMx: options[0]?.subtotalMx ?? 0,
      vatMx: options[0]?.vatMx ?? 0,
      totalMx: options[0]?.totalMx ?? 0,

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
    requestedDays: d,
    terms: [
      "Importe principal corresponde exactamente a la duración solicitada.",
      "Precios sin IVA + IVA 16% por separado.",
      "Transporte redondo según zona (si aplica).",
      "Vigencia: 48 horas.",
    ],
  });

  return {
    quoteId: quote.id,
    quoteNumber: quote.quoteNumber,
    pdfBuffer,
    filename,
    options,
  };
}

async function upsertLead(companyId, lead) {
  const phone = lead.phone ? String(lead.phone) : null;
  const email = lead.email ? String(lead.email).toLowerCase() : null;

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

async function nextQuoteNumber(companyId) {
  const year = new Date().getFullYear();
  const count = await prisma.quoteRequest.count({ where: { companyId } });
  const seq = String(count + 1).padStart(6, "0");
  return `Q-${year}-${seq}`;
}
