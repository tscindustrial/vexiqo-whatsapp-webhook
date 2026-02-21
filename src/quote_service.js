/**
 * src/quote_service.js (ESM)
 * Quote service: create Quote + QuoteItem(s) and generate PDF buffer.
 */

import { PrismaClient } from "@prisma/client";
import { computeComparativeOptions } from "./pricing_engine_v2.js";
import { generateQuotePdfBuffer } from "./pdf_quote.js";

const prisma = new PrismaClient();

function mxn(n) {
  const v = Number(n || 0);
  return v.toLocaleString("es-MX", {
    style: "currency",
    currency: "MXN",
    maximumFractionDigits: 0,
  });
}

// build one pricing option using the existing pricing engine (no duplicated logic)
function computeSingleOption({ durationDays, equipmentModel, transportRoundTripMx, vatRate }) {
  const res = computeComparativeOptions({
    durationDays,
    equipmentModel,
    transportRoundTripMx,
    vatRate,
  });

  // computeComparativeOptions returns { primary, options }
  // We take primary because it represents the requested duration calculation.
  return res?.primary || null;
}

function buildOrderedOptions({ requestedDays, equipmentModel, transportRoundTripMx, vatRate }) {
  const req = computeSingleOption({
    durationDays: requestedDays,
    equipmentModel,
    transportRoundTripMx,
    vatRate,
  });

  const refDays = [1, 7, 30];
  const refs = refDays
    .filter((d) => d !== Number(requestedDays))
    .map((d) =>
      computeSingleOption({
        durationDays: d,
        equipmentModel,
        transportRoundTripMx,
        vatRate,
      })
    )
    .filter(Boolean);

  // Order: requested first, then 1/7/30 (excluding duplicates)
  const all = [req, ...refs].filter(Boolean);

  // Normalize into the option shape used downstream (pdf expects these keys)
  return all.map((o) => ({
    durationDays: Number(o.durationDays),
    rentalBaseMx: Number(o.rentalBaseMx || 0),
    transportMx: Number(o.transportMx || 0),
    subtotalMx: Number(o.subtotalMx || 0),
    vatMx: Number(o.vatMx || 0),
    totalMx: Number(o.totalMx || 0),
  }));
}

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
    throw new Error(`createDraftQuoteWithPdf: durationDays invalid ${durationDays}`);
  }

  const equipmentModel = equipment?.equipmentModel || "45FT";

  // 1) Upsert lead
  const leadRecord = await upsertLead(companyId, lead);

  // 2) Build ordered options: requested + 1/7/30 (no duplicates)
  const options = buildOrderedOptions({
    requestedDays: d,
    equipmentModel,
    transportRoundTripMx: Number(transportRoundTripMx || 0),
    vatRate: 0.16,
  });

  if (!options.length) {
    throw new Error("createDraftQuoteWithPdf: pricing options empty");
  }

  // 3) Quote number
  const quoteNumber = await nextQuoteNumber(companyId);

  // 4) Persist Quote + QuoteItems as DRAFT
  const createdAtISO = new Date().toISOString();

  const quote = await prisma.quote.create({
    data: {
      companyId,
      leadId: leadRecord.id,
      quoteNumber,
      status: "DRAFT",
      transportZone: transportZone || null,
      transportRoundTripMx: Number(transportRoundTripMx || 0),
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
              : opt.durationDays === 1
              ? "Referencia: 1 día"
              : opt.durationDays === 7
              ? "Referencia: Semana (7 días)"
              : opt.durationDays === 30
              ? "Referencia: Mes (30 días)"
              : `Referencia (${opt.durationDays} días)`,

          durationDays: opt.durationDays,

          // Prisma requiere unitPriceMx.
          // Guardamos precio unitario por día.
          unitPriceMx:
            opt.durationDays && opt.durationDays > 0
              ? Math.round(Number(opt.rentalBaseMx || 0) / Number(opt.durationDays))
              : 0,

          amountMx: opt.totalMx,
        })),
      },
    },
    include: { items: true },
  });

  // ===== Terms (con nota inteligente si conviene subir 1–2 días) =====
  const termsBase = [
    "Importe principal corresponde exactamente a la duración solicitada.",
    "Precios sin IVA. IVA 16% por separado.",
    "Transporte redondo según zona (si aplica).",
    "Vigencia: 48 horas.",
  ];

  // Nota escalón: si d+1 o d+2 baja total
  const requestedTotal = Number(options?.[0]?.totalMx || 0);
  let optimizedNote = null;

  if (requestedTotal > 0) {
    const candidates = [d + 1, d + 2];
    let best = null;

    for (const candDays of candidates) {
      const cand = computeSingleOption({
        durationDays: candDays,
        equipmentModel,
        transportRoundTripMx: Number(transportRoundTripMx || 0),
        vatRate: 0.16,
      });
      const candTotal = Number(cand?.totalMx || 0);
      if (!candTotal) continue;

      if (candTotal < requestedTotal) {
        const savingsMx = requestedTotal - candTotal;
        const savingsPct = savingsMx / requestedTotal;
        if (!best || candTotal < best.totalMx) {
          best = { days: candDays, totalMx: candTotal, savingsMx, savingsPct };
        }
      }
    }

    if (best && (best.savingsMx >= 800 || best.savingsPct >= 0.03)) {
      const pct = Math.round(best.savingsPct * 100);
      optimizedNote = `Optimización de tarifa: por estructura escalonada, al extender a ${best.days} días el total baja aprox. ${mxn(
        best.savingsMx
      )} (${pct}%). Si te interesa, lo ajustamos.`;
    }
  }

  const terms = optimizedNote ? [optimizedNote, ...termsBase] : termsBase;

  // 5) Generate PDF buffer
  const company = await prisma.company.findUnique({ where: { id: companyId } }).catch(() => null);

  const { buffer: pdfBuffer, filename } = await generateQuotePdfBuffer({
    company: company || {},
    lead: {
      name: leadRecord.name || null,
      phone: leadRecord.phoneE164 || null,
      email: null,
      city: null,
    },
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
      city: equipment?.city,
    },
    options,
    requestedDays: d,
    terms,
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
  const phoneE164 = lead.phoneE164 ? String(lead.phoneE164) : null;
  if (!phoneE164) throw new Error("upsertLead: lead.phoneE164 is required (WhatsApp sender)");

  const existing = await prisma.lead.findFirst({ where: { companyId, phoneE164 } });

  if (existing) {
    return prisma.lead.update({
      where: { id: existing.id },
      data: {
        name: lead.name || existing.name,
      },
    });
  }

  return prisma.lead.create({
    data: {
      companyId,
      phoneE164,
      name: lead.name || null,
    },
  });
}

async function nextQuoteNumber(companyId) {
  const year = new Date().getFullYear();
  const count = await prisma.quote.count({ where: { companyId } });
  const seq = String(count + 1).padStart(4, "0");
  return `Q-${year}-${seq}`;
}
