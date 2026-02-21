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

  // 1) Upsert lead (save side: phoneE164 + name)
  const leadRecord = await upsertLead(companyId, lead);

  // 2) Pricing options: [primary exact, ref 7, ref 30] (or fallback)
  const { options } = computeComparativeOptions({
    durationDays: d,
    equipmentModel,
    transportRoundTripMx: Number(transportRoundTripMx || 0),
    vatRate: 0.16,
  });

  // 3) Quote number secuencial por company
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
              : opt.durationDays === 7
              ? "Referencia: Semana (7 días)"
              : opt.durationDays === 30
              ? "Referencia: Mes (30 días)"
              : `Referencia (${opt.durationDays} días)`,
          durationDays: opt.durationDays,
          unitPricePerDayMx: opt.rentalBaseMx,
          amountMx: opt.totalMx,
        })),
      },
    },
    include: { items: true },
  });

  // ===== Terms (con nota inteligente si conviene subir 1–2 días) =====
  const terms = [
    "Importe principal corresponde exactamente a la duración solicitada.",
    "Precios sin IVA. IVA 16% por separado.",
    "Transporte redondo según zona (si aplica).",
    "Vigencia: 48 horas.",
  ];

  // Nota de optimización: si d+1 o d+2 resulta más barato en total, sugerirlo como NOTA
  // (sin alterar la cotización solicitada, y sin añadir filas extra en la tabla)
  const requestedTotal = Number(options?.[0]?.totalMx || 0);

  if (requestedTotal > 0) {
    const candidates = [d + 1, d + 2];

    let best = null; // { days, totalMx, savingsMx, savingsPct }

    for (const candDays of candidates) {
      const res = computeComparativeOptions({
        durationDays: candDays,
        equipmentModel,
        transportRoundTripMx: Number(transportRoundTripMx || 0),
        vatRate: 0.16,
      });

      const candTotal = Number(res?.primary?.totalMx || 0);
      if (!candTotal) continue;

      if (candTotal < requestedTotal) {
        const savingsMx = requestedTotal - candTotal;
        const savingsPct = savingsMx / requestedTotal;

        if (!best || candTotal < best.totalMx) {
          best = { days: candDays, totalMx: candTotal, savingsMx, savingsPct };
        }
      }
    }

    // Umbrales para evitar “ruido”: ahorro >= $800 o >= 3%
    if (best && (best.savingsMx >= 800 || best.savingsPct >= 0.03)) {
      const pct = Math.round(best.savingsPct * 100);
      terms.unshift(
        `Optimización de tarifa: por estructura escalonada, al extender a ${best.days} días el total baja aprox. ${mxn(
          best.savingsMx
        )} (${pct}%). Si te interesa, lo ajustamos.`
      );
    }
  }

  // 5) Generate PDF buffer
  const company = await prisma.company.findUnique({ where: { id: companyId } }).catch(() => null);

  const { buffer: pdfBuffer, filename } = await generateQuotePdfBuffer({
    company: company || {},
    lead: {
      name: leadRecord.name || null,
      phone: leadRecord.phoneE164 || null, // para mostrarlo en PDF como "WhatsApp"
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
    // Lead existe: solo permite actualizar name
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
