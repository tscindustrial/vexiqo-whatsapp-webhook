/**
 * src/pdf_quote.js
 * PDF generator (NO browser, NO Playwright). Uses PDFKit.
 *
 * Exports:
 * - generateQuotePdfBuffer({ company, lead, quote, equipment, options, requestedDays, terms })
 * returns: { buffer: Buffer, filename: string }
 */

import PDFDocument from "pdfkit";

function mxn(n) {
  const v = Number(n || 0);
  return v.toLocaleString("es-MX", {
    style: "currency",
    currency: "MXN",
    maximumFractionDigits: 0,
  });
}

function safeText(v) {
  return v == null ? "" : String(v);
}

function fmtDateEsMX(iso) {
  const d = iso ? new Date(iso) : new Date();
  if (Number.isNaN(d.getTime())) return "";
  // “21 feb 2026” estilo enterprise
  return d.toLocaleDateString("es-MX", { year: "numeric", month: "short", day: "2-digit" });
}

function clamp(n, a, b) {
  const x = Number(n);
  if (!Number.isFinite(x)) return a;
  return Math.max(a, Math.min(b, x));
}

/**
 * Simple table drawing helpers (enterprise-clean)
 */
function drawSectionTitle(doc, x, y, title) {
  doc
    .font("Helvetica-Bold")
    .fontSize(11)
    .fillColor("#0f172a")
    .text(title, x, y);
}

function drawKV(doc, x, y, label, value, labelW = 110, valueW = 210) {
  doc
    .font("Helvetica")
    .fontSize(9)
    .fillColor("#334155")
    .text(label, x, y, { width: labelW });

  doc
    .font("Helvetica-Bold")
    .fontSize(9)
    .fillColor("#0f172a")
    .text(value, x + labelW, y, { width: valueW });
}

function drawPill(doc, x, y, text) {
  const padX = 8;
  const padY = 4;
  doc.save();
  doc.font("Helvetica-Bold").fontSize(8);

  const w = doc.widthOfString(text) + padX * 2;
  const h = 16;

  doc.roundedRect(x, y, w, h, 8).fill("#0ea5e9");
  doc.fillColor("#ffffff").text(text, x + padX, y + padY - 1, { width: w - padX * 2 });
  doc.restore();

  return { w, h };
}

function drawBadge(doc, x, y, text) {
  const padX = 7;
  const padY = 3;
  doc.save();
  doc.font("Helvetica-Bold").fontSize(8);

  const w = doc.widthOfString(text) + padX * 2;
  const h = 14;

  doc.roundedRect(x, y, w, h, 7).fill("#16a34a");
  doc.fillColor("#ffffff").text(text, x + padX, y + padY - 1, { width: w - padX * 2 });
  doc.restore();

  return { w, h };
}

function drawTableHeader(doc, x, y, cols) {
  doc.save();
  doc.roundedRect(x, y, 520, 24, 8).fill("#0f172a");
  doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(8);

  let cx = x;
  for (const c of cols) {
    doc.text(c.label, cx + 8, y + 7, { width: c.w - 16, align: c.align || "left" });
    cx += c.w;
  }
  doc.restore();
}

function drawTableRow(doc, x, y, cols, cells, opts = {}) {
  const { zebra = false, highlight = false } = opts;

  doc.save();

  if (highlight) {
    doc.roundedRect(x, y, 520, 26, 8).fill("#e0f2fe"); // light cyan highlight
  } else if (zebra) {
    doc.roundedRect(x, y, 520, 26, 8).fill("#f8fafc"); // subtle zebra
  }

  doc.fillColor("#0f172a").font("Helvetica").fontSize(9);

  let cx = x;
  for (let i = 0; i < cols.length; i++) {
    const c = cols[i];
    const t = safeText(cells[i] ?? "");
    doc.text(t, cx + 8, y + 7, { width: c.w - 16, align: c.align || "left" });
    cx += c.w;
  }

  doc.restore();
}

function pickLabelForOption(opt, requestedDays) {
  const d = Number(opt?.durationDays || 0);
  if (requestedDays && d === Number(requestedDays)) return `Solicitado (${d} días)`;
  if (d === 1) return "1 día";
  if (d === 7) return "7 días";
  if (d === 30) return "30 días";
  return `${d} días`;
}

function effectivePerDay(opt) {
  const d = Number(opt?.durationDays || 0);
  if (!d) return 0;
  const base = Number(opt?.rentalBaseMx || 0);
  return Math.round(base / d);
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

  // ===== Layout constants =====
  const pageW = doc.page.width;
  const x0 = 36;
  const contentW = pageW - 72;

  // ===== Header (enterprise bar) =====
  doc.save();
  doc.rect(0, 0, pageW, 110).fill("#0b1220"); // deep navy
  doc.restore();

  // Company name
  doc
    .font("Helvetica-Bold")
    .fontSize(16)
    .fillColor("#ffffff")
    .text(safeText(company.name || "TSC Industrial"), x0, 30, { width: contentW });

  // Small subtitle (clean, not noisy)
  doc
    .font("Helvetica")
    .fontSize(9)
    .fillColor("#cbd5e1")
    .text("Cotización automática generada por VEXIQO", x0, 52, { width: contentW });

  // Quote meta (right)
  const folio = safeText(quote.quoteNumber || "");
  const fecha = fmtDateEsMX(quote.createdAtISO || Date.now());

  doc.font("Helvetica").fontSize(9).fillColor("#cbd5e1");
  doc.text("Folio", x0, 30, { width: contentW, align: "right" });
  doc.font("Helvetica-Bold").fontSize(11).fillColor("#ffffff");
  doc.text(folio || "—", x0, 43, { width: contentW, align: "right" });

  doc.font("Helvetica").fontSize(9).fillColor("#cbd5e1");
  doc.text("Fecha", x0, 62, { width: contentW, align: "right" });
  doc.font("Helvetica-Bold").fontSize(10).fillColor("#ffffff");
  doc.text(fecha || "—", x0, 75, { width: contentW, align: "right" });

  // Divider shadow under header
  doc.save();
  doc.rect(0, 110, pageW, 1).fill("#0f172a");
  doc.restore();

  // ===== Body starts =====
  let y = 126;

  // Pills row (optional)
  if (quote.transportZone) {
    const p = drawPill(doc, x0, y - 2, `Zona: ${safeText(quote.transportZone)}`);
    // keep spacing consistent
  }

  // ===== Client / Requirement cards =====
  // Cards background
  const cardH = 92;
  doc.save();
  doc.roundedRect(x0, y + 22, contentW, cardH, 14).fill("#f8fafc"); // slate-50
  doc.restore();

  drawSectionTitle(doc, x0 + 16, y + 34, "Cliente");
  drawSectionTitle(doc, x0 + 320, y + 34, "Requerimiento");

  // Left column (Cliente)
  drawKV(doc, x0 + 16, y + 54, "Nombre:", safeText(lead.name || "—"), 70, 210);
  drawKV(doc, x0 + 16, y + 70, "WhatsApp:", safeText(lead.phone || lead.phoneE164 || "—"), 70, 210);

  // Right column (Requerimiento)
  drawKV(doc, x0 + 320, y + 54, "Equipo:", safeText(equipment.type || "—"), 60, 170);

  const heightTxt =
    equipment.height_m != null && safeText(equipment.height_m) !== ""
      ? `${safeText(equipment.height_m)} m`
      : "—";

  drawKV(doc, x0 + 320, y + 70, "Altura:", heightTxt, 60, 170);

  // Second line row
  y += 22 + cardH + 18;

  // Small technical line (compact, pro)
  doc.save();
  doc.roundedRect(x0, y, contentW, 46, 14).fill("#ffffff");
  doc.roundedRect(x0, y, contentW, 46, 14).strokeColor("#e2e8f0").lineWidth(1).stroke();
  doc.restore();

  const techLeftX = x0 + 16;
  const techY = y + 14;

  drawKV(doc, techLeftX, techY, "Ciudad:", safeText(equipment.city || "—"), 55, 190);
  drawKV(doc, techLeftX + 260, techY, "Terreno:", safeText(equipment.terrain || "—"), 60, 180);
  drawKV(doc, techLeftX, techY + 16, "Actividad:", safeText(equipment.activity || "—"), 55, 190);

  const durTxt = requestedDays ? `${requestedDays} días` : "—";
  drawKV(doc, techLeftX + 260, techY + 16, "Duración:", durTxt, 60, 180);

  y += 64;

  // ===== Pricing (Comparative) =====
  drawSectionTitle(doc, x0, y, "Opciones de cotización");
  y += 14;

  // Determine best cost/day among the options we have
  const usableOptions = Array.isArray(options) ? options : [];
  let bestIdx = -1;
  let bestPerDay = Infinity;

  usableOptions.forEach((opt, idx) => {
    const perDay = effectivePerDay(opt);
    if (perDay > 0 && perDay < bestPerDay) {
      bestPerDay = perDay;
      bestIdx = idx;
    }
  });

  // Table columns (pro, no noise)
  const cols = [
    { label: "Opción", w: 150, align: "left" },
    { label: "Precio / día", w: 85, align: "right" },
    { label: "Equipo (sin IVA)", w: 105, align: "right" },
    { label: "Transporte", w: 80, align: "right" },
    { label: "IVA 16%", w: 60, align: "right" },
    { label: "Total", w: 40, align: "right" }, // we’ll use narrower + right align; values still readable
  ];

  // Because last col is narrow, we’ll render totals with shorter formatting if needed
  // But we keep mxn; PDFKit will wrap if too long, so we ensure right alignment.
  // If totals look tight, we’ll widen later; for now this fits 520 width:
  // 150 + 85 + 105 + 80 + 60 + 40 = 520

  drawTableHeader(doc, x0, y, cols);
  y += 30;

  // Keep maximum 4 rows (requested + 1/7/30) as we agreed.
  // Quote service already ensures the set; PDF just respects what it receives.
  const maxRows = clamp(usableOptions.length, 0, 4);

  for (let i = 0; i < maxRows; i++) {
    const opt = usableOptions[i];
    const isRequested = requestedDays != null && Number(opt?.durationDays) === Number(requestedDays);
    const isBest = i === bestIdx;

    const label = pickLabelForOption(opt, requestedDays);
    const perDay = effectivePerDay(opt);

    const cells = [
      label,
      perDay ? mxn(perDay) : "—",
      mxn(opt?.rentalBaseMx || 0),
      mxn(opt?.transportMx || 0),
      mxn(opt?.vatMx || 0),
      mxn(opt?.totalMx || 0),
    ];

    // Row
    drawTableRow(doc, x0, y, cols, cells, {
      zebra: i % 2 === 1,
      highlight: isRequested,
    });

    // Badge “Mejor costo / día”
    if (isBest) {
      // place badge inside the row, at the end of the first column area
      const badgeText = "★ Mejor costo / día";
      const bx = x0 + 14;
      const by = y + 6;
      // If requested row is highlighted, badge still looks fine.
      drawBadge(doc, bx + 115, by, badgeText);
    }

    y += 32;
  }

  // ===== Summary (requested option) =====
  // Main option = first one (as per current system: option[0] is requested)
  const main = usableOptions?.[0] || null;

  y += 6;

  doc.save();
  doc.roundedRect(x0, y, contentW, 88, 16).fill("#0f172a");
  doc.restore();

  doc.font("Helvetica-Bold").fontSize(10).fillColor("#ffffff");
  doc.text("Resumen (opción solicitada)", x0 + 18, y + 16);

  doc.font("Helvetica").fontSize(9).fillColor("#cbd5e1");
  doc.text(`Equipo: ${safeText(equipment.type || "—")}`, x0 + 18, y + 34, { width: 340 });
  doc.text(`Duración: ${requestedDays ? `${requestedDays} días` : "—"}`, x0 + 18, y + 48, {
    width: 340,
  });

  // Right totals block
  const rightX = x0 + 360;

  doc.font("Helvetica").fontSize(9).fillColor("#cbd5e1");
  doc.text("Equipo (sin IVA)", rightX, y + 18, { width: 160, align: "right" });
  doc.text("Transporte", rightX, y + 34, { width: 160, align: "right" });
  doc.text("IVA 16%", rightX, y + 50, { width: 160, align: "right" });

  doc.font("Helvetica-Bold").fontSize(9).fillColor("#ffffff");
  doc.text(mxn(main?.rentalBaseMx || 0), rightX, y + 18, { width: 160, align: "right" });
  doc.text(mxn(main?.transportMx || 0), rightX, y + 34, { width: 160, align: "right" });
  doc.text(mxn(main?.vatMx || 0), rightX, y + 50, { width: 160, align: "right" });

  // TOTAL big
  doc.font("Helvetica-Bold").fontSize(16).fillColor("#ffffff");
  doc.text(mxn(main?.totalMx || 0), rightX, y + 66, { width: 160, align: "right" });

  y += 106;

  // ===== Terms / Notes =====
  drawSectionTitle(doc, x0, y, "Condiciones");
  y += 14;

  const termLines = Array.isArray(terms) && terms.length
    ? terms
    : [
        "Precios en MXN. IVA 16% por separado.",
        "Transporte redondo según zona (si aplica).",
        "Vigencia: 48 horas.",
      ];

  doc.font("Helvetica").fontSize(9).fillColor("#334155");

  for (const t of termLines) {
    doc.text(`• ${safeText(t)}`, x0, y, { width: contentW });
    y += 14;

    if (y > 760) {
      doc.addPage();
      y = 50;
    }
  }

  // ===== Footer =====
  doc.save();
  doc.moveTo(x0, 805).lineTo(x0 + contentW, 805).strokeColor("#e2e8f0").lineWidth(1).stroke();
  doc.restore();

  doc.font("Helvetica").fontSize(8).fillColor("#64748b");
  doc.text("Generado automáticamente por VEXIQO", x0, 814, { width: contentW, align: "center" });

  doc.end();

  const buffer = await bufferPromise;
  const filename = `Cotizacion_${safeText(quote.quoteNumber || "SN")}.pdf`;
  return { buffer, filename };
}
