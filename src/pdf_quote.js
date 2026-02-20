/**
 * src/pdf_quote.js
 * PDF generator (NO browser, NO Playwright). Uses PDFKit.
 *
 * Exports:
 *  - generateQuotePdfBuffer({ company, lead, quote, equipment, options, requestedDays, terms })
 * returns: { buffer: Buffer, filename: string }
 */

import PDFDocument from "pdfkit";

function mxn(n) {
  const v = Number(n || 0);
  return v.toLocaleString("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 });
}

function safeText(v) {
  return v == null ? "" : String(v);
}

function drawKeyValue(doc, x, y, label, value, labelW = 120, valueW = 220) {
  doc.font("Helvetica-Bold").fontSize(9).fillColor("#111").text(label, x, y, { width: labelW });
  doc.font("Helvetica").fontSize(9).fillColor("#111").text(value, x + labelW, y, { width: valueW });
}

function drawTableHeader(doc, x, y, cols) {
  doc.save();
  doc.rect(x, y, 520, 22).fill("#111");
  doc.fillColor("#fff").font("Helvetica-Bold").fontSize(9);

  let cx = x;
  for (const c of cols) {
    doc.text(c.label, cx + 6, y + 6, { width: c.w - 12, align: c.align || "left" });
    cx += c.w;
  }
  doc.restore();
}

function drawTableRow(doc, x, y, cols, row, zebra) {
  doc.save();
  if (zebra) doc.rect(x, y, 520, 22).fill("#f3f4f6");
  doc.fillColor("#111").font("Helvetica").fontSize(9);

  let cx = x;
  for (let i = 0; i < cols.length; i++) {
    const c = cols[i];
    doc.text(row[i], cx + 6, y + 6, { width: c.w - 12, align: c.align || "left" });
    cx += c.w;
  }
  doc.restore();
}

export async function generateQuotePdfBuffer(payload) {
  const {
    company = {},
    lead = {},
    quote = {},
    equipment = {},
    options = [],
    requestedDays,
    terms = [],
  } = payload || {};

  const doc = new PDFDocument({
    size: "A4",
    margins: { top: 36, left: 36, right: 36, bottom: 36 },
    info: {
      Title: `Cotización ${safeText(quote.quoteNumber || "")}`,
      Author: safeText(company.name || "VEXIQO"),
    },
  });

  const chunks = [];
  doc.on("data", (c) => chunks.push(c));

  const bufferPromise = new Promise((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  // ===== Header =====
  doc.font("Helvetica-Bold").fontSize(18).fillColor("#111").text("COTIZACIÓN", 36, 36);
  doc.font("Helvetica").fontSize(10).fillColor("#444").text(safeText(company.name || "TSC Industrial"), 36, 60);

  doc.font("Helvetica-Bold").fontSize(11).fillColor("#111")
    .text(`Folio: ${safeText(quote.quoteNumber || "")}`, 360, 40, { align: "right" });
  doc.font("Helvetica").fontSize(9).fillColor("#444")
    .text(`Fecha: ${new Date(quote.createdAtISO || Date.now()).toLocaleString("es-MX")}`, 360, 58, { align: "right" });

  doc.moveTo(36, 82).lineTo(559, 82).strokeColor("#e5e7eb").stroke();

  // ===== Client / Job details =====
  let y = 96;

  doc.font("Helvetica-Bold").fontSize(11).fillColor("#111").text("Datos del cliente", 36, y);
  doc.font("Helvetica-Bold").fontSize(11).fillColor("#111").text("Requerimiento", 320, y);
  y += 18;

  drawKeyValue(doc, 36, y, "Nombre:", safeText(lead.name || ""), 80, 200);
  drawKeyValue(doc, 320, y, "Equipo:", safeText(equipment.type || ""), 80, 180);
  y += 14;

  drawKeyValue(doc, 36, y, "WhatsApp:", safeText(lead.phone || lead.phoneE164 || ""), 80, 200);
  drawKeyValue(doc, 320, y, "Altura:", equipment.height_m ? `${equipment.height_m} m` : "", 80, 180);
  y += 14;

  drawKeyValue(doc, 36, y, "Zona:", safeText(quote.transportZone || ""), 80, 200);
  drawKeyValue(doc, 320, y, "Terreno:", safeText(equipment.terrain || ""), 80, 180);
  y += 14;

  drawKeyValue(doc, 36, y, "Duración:", requestedDays ? `${requestedDays} días` : "", 80, 200);
  drawKeyValue(doc, 320, y, "Actividad:", safeText(equipment.activity || ""), 80, 180);
  y += 18;

  doc.moveTo(36, y).lineTo(559, y).strokeColor("#e5e7eb").stroke();
  y += 14;

  // ===== Pricing table =====
  doc.font("Helvetica-Bold").fontSize(11).fillColor("#111").text("Opciones de precio", 36, y);
  y += 14;

  const cols = [
    { label: "Opción", w: 140, align: "left" },
    { label: "Renta (sin IVA)", w: 120, align: "right" },
    { label: "Transporte", w: 90, align: "right" },
    { label: "IVA 16%", w: 80, align: "right" },
    { label: "Total", w: 90, align: "right" },
  ];

  drawTableHeader(doc, 36, y, cols);
  y += 22;

  const rows = options.slice(0, 3).map((opt, idx) => {
    const label =
      idx === 0
        ? `Solicitada (${opt.durationDays} días)`
        : opt.durationDays === 7
          ? "Referencia (7 días)"
          : opt.durationDays === 30
            ? "Referencia (30 días)"
            : `Referencia (${opt.durationDays} días)`;

    return [
      label,
      mxn(opt.rentalBaseMx),
      mxn(opt.transportMx),
      mxn(opt.vatMx),
      mxn(opt.totalMx),
    ];
  });

  rows.forEach((r, i) => {
    drawTableRow(doc, 36, y, cols, r, i % 2 === 1);
    y += 22;
  });

  y += 10;

  // Totals box (main option)
  const main = options?.[0] || null;
  if (main) {
    doc.save();
    doc.roundedRect(330, y, 229, 78, 10).fill("#111");
    doc.restore();

    doc.fillColor("#fff").font("Helvetica-Bold").fontSize(10).text("Resumen (opción solicitada)", 342, y + 10);
    doc.fillColor("#fff").font("Helvetica").fontSize(9)
      .text(`Subtotal: ${mxn(main.subtotalMx)}`, 342, y + 30)
      .text(`IVA 16%: ${mxn(main.vatMx)}`, 342, y + 44);
    doc.fillColor("#fff").font("Helvetica-Bold").fontSize(11)
      .text(`TOTAL: ${mxn(main.totalMx)}`, 342, y + 60);
    y += 90;
  }

  // ===== Terms =====
  doc.font("Helvetica-Bold").fontSize(11).fillColor("#111").text("Condiciones", 36, y);
  y += 14;

  doc.font("Helvetica").fontSize(9).fillColor("#111");
  const termLines = (terms && terms.length ? terms : [
    "Precios sin IVA + IVA 16% por separado.",
    "Transporte redondo según zona (si aplica).",
    "Vigencia: 48 horas.",
  ]);

  for (const t of termLines) {
    doc.text(`• ${t}`, 36, y, { width: 520 });
    y += 12;
    if (y > 760) {
      doc.addPage();
      y = 36;
    }
  }

  // Footer
  doc.font("Helvetica").fontSize(8).fillColor("#666")
    .text("Generado automáticamente por VEXIQO", 36, 800, { width: 520, align: "center" });

  doc.end();

  const buffer = await bufferPromise;
  const filename = `Cotizacion_${safeText(quote.quoteNumber || "SN")}.pdf`;

  return { buffer, filename };
}
