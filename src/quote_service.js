// src/quote_service.js (ESM)
// Persiste Quote (DRAFT) + QuoteItems y genera PDF buffer (Playwright / PDF generator actual)

import { PrismaClient } from '@prisma/client'
import { computeComparativeOptions } from './pricing_engine_v2.js'
import { generateQuotePdfBuffer } from './pdf_quote.js'

const prisma = new PrismaClient()

export async function createDraftQuoteWithPdf(input) {
  const {
    companyId,
    lead,
    equipment,
    durationDays,
    transportZone,
    transportRoundTripMx,
    meta,
  } = input || {}

  if (!companyId) throw new Error('createDraftQuoteWithPdf: companyId is required')
  if (!lead) throw new Error('createDraftQuoteWithPdf: lead is required')

  const d = Number(durationDays)
  if (!Number.isFinite(d) || d <= 0) {
    throw new Error(`createDraftQuoteWithPdf: durationDays invalid ${durationDays}`)
  }

  const equipmentModel = (equipment?.type || '45FT').toUpperCase()

  // 1) Pricing options (primary exact, ref 7, ref 30) (o fallback)
  let { options } = computeComparativeOptions({
    durationDays: d,
    equipmentModel,
    transportRoundTripMx: Number(transportRoundTripMx || 0),
    vatRate: 0.16,
  })

  // 2) Asegurar opciones comparativas: 1 día, 7 días, 30 días + solicitada
  //    (sin duplicar lógica; solo reusamos computeComparativeOptions)
  const existingByDays = new Set((options || []).map(o => o.durationDays))
  const ensureDays = [1, 7, 30]
  const extraOptions = []

  for (const refDays of ensureDays) {
    if (refDays === d) continue
    if (existingByDays.has(refDays)) continue

    const res = computeComparativeOptions({
      durationDays: refDays,
      equipmentModel,
      transportRoundTripMx: Number(transportRoundTripMx || 0),
      vatRate: 0.16,
    })

    if (res?.primary && !existingByDays.has(res.primary.durationDays)) {
      extraOptions.push(res.primary)
      existingByDays.add(res.primary.durationDays)
    }
  }

  // Orden profesional: solicitado primero, luego 1 / 7 / 30
  const primary = (options && options[0]) ? options[0] : null
  const extraSorted = []
  for (const refDays of ensureDays) {
    const found = extraOptions.find(o => o.durationDays === refDays)
    if (found) extraSorted.push(found)
  }

  const optionsFinal = []
  if (primary) optionsFinal.push(primary)
  for (const o of extraSorted) optionsFinal.push(o)

  // 3) QuoteNumber secuencial por company
  const quoteNumber = await nextQuoteNumber(companyId)
  const createdAtISO = new Date().toISOString()

  // 4) Persist Quote + QuoteItems (main option = duración solicitada)
  const main = optionsFinal[0] || null

  const quote = await prisma.quote.create({
    data: {
      companyId,
      leadId: lead.id,
      quoteNumber,
      status: 'DRAFT',
      transportZone: transportZone || null,
      transportRoundTripMx: Number(transportRoundTripMx || 0),
      subtotalMx: main ? main.subtotalMx : 0,
      vatMx: main ? main.vatMx : 0,
      totalMx: main ? main.totalMx : 0,
      meta: meta || null,
      items: {
        create: optionsFinal.map((opt, idx) => ({
          lineNo: idx + 1,
          description:
            opt.durationDays === d
              ? `Renta solicitada (${opt.durationDays} días)`
              : `Referencia (${opt.durationDays} días)`,
          durationDays: opt.durationDays,
          unitPricePerDayMx: opt.durationDays > 0 ? (opt.rentalBaseMx / opt.durationDays) : 0,
          amountMx: opt.totalMx,
        })),
      },
    },
    include: { items: true },
  })

  // 5) Generate PDF buffer (usa optionsFinal para tabla comparativa)
  const company = await prisma.company.findUnique({ where: { id: companyId } }).catch(() => null)

  const { buffer: pdfBuffer, filename } = await generateQuotePdfBuffer({
    company: company || { name: null },
    lead: {
      name: lead.name || null,
      phoneE164: lead.phoneE164 || lead.phoneE164 || null,
    },
    quote: {
      quoteNumber: quote.quoteNumber,
      createdAtISO,
      transportZone: quote.transportZone || '',
    },
    equipment: {
      type: equipment?.type || null,
      height_m: equipment?.height_m ?? null,
      terrain: equipment?.terrain ?? null,
      activity: equipment?.activity ?? null,
      city: equipment?.city ?? null,
    },
    options: optionsFinal,
    requestedDays: d,
    terms: [
      'Importe principal corresponde exactamente a la duración solicitada.',
      'Precios en IVA 16% por separado.',
      'Transporte redondo según zona (si aplica).',
      'Vigencia: 48 horas.',
    ],
  })

  return {
    quoteId: quote.id,
    quoteNumber: quote.quoteNumber,
    pdfBuffer,
    filename,
    options: optionsFinal,
  }
}

async function upsertLead(companyId, lead) {
  const phoneE164 = String(lead.phoneE164 || lead.phone || '').trim()
  if (!phoneE164) throw new Error('createDraftQuoteWithPdf: lead phoneE164 is required (whatsapp sender)')

  const existing = await prisma.lead.findFirst({ where: { companyId, phoneE164 } })

  if (existing) {
    // Lead existe: solo si viene nombre, actualiza nombre
    await prisma.lead.update({
      where: { id: existing.id },
      data: {
        name: lead.name || existing.name,
      },
    })
    return existing
  }

  return prisma.lead.create({
    data: {
      companyId,
      phoneE164,
      name: lead.name || null,
    },
  })
}

async function nextQuoteNumber(companyId) {
  const year = new Date().getFullYear()
  const count = await prisma.quote.count({ where: { companyId } })
  const seq = String(count + 1).padStart(4, '0')
  return `Q-${year}-${seq}`
}
