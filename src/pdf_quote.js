/**
 * src/pdf_quote.js
 * PDF generator (PDFKit)
 *
 * Exports:
 * - generateQuotePdfBuffer({ company, lead, quote, equipment, options, requestedDays, terms })
 * returns: { buffer: Buffer, filename: string }
 */

import PDFDocument from "pdfkit";
import fs from "node:fs";
import path from "node:path";

function moneyShortMx(n) {
  const v = Math.round(Number(n || 0));
  // corto para tablas (evita wrap)
  return v.toLocaleString("es-MX", { maximumFractionDigits: 0 });
}

function mxn(n) {
  const v = Math.round(Number(n || 0));
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
  return d.toLocaleDateString("es-MX", { year: "numeric", month: "short", day: "2-digit" });
}

function drawSectionTitle(doc, x, y, title) {
  doc.font("Helvetica-Bold").fontSize(10.5).fillColor("#0f172a").text(title, x, y);
}

function drawKV(doc, x, y, label, value, labelW = 70, valueW = 210) {
  doc.font("Helvetica").fontSize(8.8).fillColor("#334155").text(label, x, y, { width: labelW });
  doc
    .font("Helvetica-Bold")
    .fontSize(8.8)
    .fillColor("#0f172a")
    .text(value, x + labelW, y, { width: valueW });
}

function roundedBox(doc, x, y, w, h, r, fill, stroke) {
  doc.save();
  if (fill) doc.fillColor(fill);
  if (stroke) doc.strokeColor(stroke).lineWidth(1);
  doc.roundedRect(x, y, w, h, r);
  if (fill && stroke) doc.fillAndStroke();
  else if (fill) doc.fill();
  else if (stroke) doc.stroke();
  doc.restore();
}

function tryLoadPng(rel) {
  try {
    const p = path.join(process.cwd(), rel);
    if (!fs.existsSync(p)) return null;
    return p;
  } catch {
    return null;
  }
}

function pickLabelForOption(opt, requestedDays) {
  const d = Number(opt?.durationDays || 0);
  if (requestedDays != null && d === Number(requestedDays)) return `Solicitado (${d} días)`;
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

function drawBulletList(doc, x, y, w, items, maxItems = 5) {
  const list = Array.isArray(items) ? items.slice(0, maxItems) : [];
  doc.font("Helvetica").fontSize(8.6).fillColor("#334155");

  let cy = y;
  for (const t of list) {
    const text = safeText(t);
    // bullet
    doc.circle(x + 3, cy + 4, 1.4).fill("#334155");
    doc.fillColor("#334155");

    const textX = x + 12;
    const h = doc.heightOfString(text, { width: w - 12, lineGap: 1.5 });
    doc.text(text, textX, cy, { width: w - 12, lineGap: 1.5 });
    cy += h + 6;
  }
  return cy;
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
    margins: { top: 28, left: 32, right: 32, bottom: 28 },
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

  const pageW = doc.page.width;
  const pageH = doc.page.height;
  const x0 = doc.page.margins.left;
  const contentW = pageW - doc.page.margins.left - doc.page.margins.right;

  // ===== Header (más compacto) =====
  const headerH = 92;
  doc.save();
  doc.rect(0, 0, pageW, headerH).fill("#0b1220");
  doc.restore();

  // Badge/logo container dentro del header (blanco) para que el logo con texto se vea premium
  const logoFull = tryLoadPng("assets/tsc_logo_full.png");
  const logoMark = tryLoadPng("assets/tsc_logo_mark.png");

  const logoBoxW = 190;
  const logoBoxH = 52;
  const logoBoxX = x0;
  const logoBoxY = 20;

  roundedBox(doc, logoBoxX, logoBoxY, logoBoxW, logoBoxH, 14, "#ffffff", null);

  if (logoFull) {
    // logo con texto dentro del card blanco
    doc.image(logoFull, logoBoxX + 14, logoBoxY + 12, { height: 28 });
  } else {
    // fallback sin imagen
    doc.font("Helvetica-Bold").fontSize(14).fillColor("#0f172a").text(
      safeText(company.name || "TSC Industrial"),
      logoBoxX + 14,
      logoBoxY + 18,
      { width: logoBoxW - 28 }
    );
  }

  // Subtítulo (tech, discreto)
  doc.font("Helvetica").fontSize(8.5).fillColor("#cbd5e1");
  doc.text("Cotización automática generada por VEXIQO", x0, 76, { width: contentW });

  // Meta derecha (folio/fecha)
  const folio = safeText(quote.quoteNumber || "—");
  const fecha = fmtDateEsMX(quote.createdAtISO || Date.now());

  doc.font("Helvetica").fontSize(8.5).fillColor("#cbd5e1");
  doc.text("Folio", x0, 22, { width: contentW, align: "right" });
  doc.font("Helvetica-Bold").fontSize(10.5).fillColor("#ffffff");
  doc.text(folio, x0, 34, { width: contentW, align: "right" });

  doc.font("Helvetica").fontSize(8.5).fillColor("#cbd5e1");
  doc.text("Fecha", x0, 52, { width: contentW, align: "right" });
  doc.font("Helvetica-Bold").fontSize(9.5).fillColor("#ffffff");
  doc.text(fecha || "—", x0, 64, { width: contentW, align: "right" });

  // Logo mark pequeño a la derecha (si existe) dentro de un badge blanco para que no se vea cuadrado feo
  if (logoMark) {
    const markW = 34;
    const markBoxW = 44;
    const markBoxH = 44;
    const markBoxX = pageW - doc.page.margins.right - markBoxW;
    const markBoxY = 20;

    roundedBox(doc, markBoxX, markBoxY, markBoxW, markBoxH, 14, "#ffffff", null);
    doc.image(logoMark, markBoxX + 6, markBoxY + 6, { width: markW });
  }

  // Divider
  doc.save();
  doc.rect(0, headerH, pageW, 1).fill("#0f172a");
  doc.restore();

  let y = headerH + 12;

  // ===== Zona pill (compacta) =====
  if (quote.transportZone) {
    const text = `Zona: ${safeText(quote.transportZone)}`;
    doc.font("Helvetica-Bold").fontSize(8).fillColor("#ffffff");

    const padX = 10;
    const pillW = doc.widthOfString(text) + padX * 2;
    const pillH = 16;

    roundedBox(doc, x0, y, pillW, pillH, 8, "#0ea5e9", null);
    doc.text(text, x0 + padX, y + 4, { width: pillW - padX * 2 });
    y += 20;
  }

  // ===== Cards Cliente / Requerimiento =====
  const cardH = 78;
  roundedBox(doc, x0, y, contentW, cardH, 14, "#f8fafc", null);

  drawSectionTitle(doc, x0 + 14, y + 12, "Cliente");
  drawSectionTitle(doc, x0 + 300, y + 12, "Requerimiento");

  const leadName = safeText(lead.name || "—");
  const wa = safeText(lead.phone || lead.phoneE164 || "—");

  drawKV(doc, x0 + 14, y + 30, "Nombre:", leadName, 60, 210);
  drawKV(doc, x0 + 14, y + 46, "WhatsApp:", wa, 60, 210);

  drawKV(doc, x0 + 300, y + 30, "Equipo:", safeText(equipment.type || "—"), 55, 170);

  const heightTxt =
    equipment.height_m != null && safeText(equipment.height_m) !== ""
      ? `${safeText(equipment.height_m)} m`
      : "—";

  drawKV(doc, x0 + 300, y + 46, "Altura:", heightTxt, 55, 170);

  y += cardH + 10;

  // ===== Strip técnico (ciudad/terreno/actividad/duración) =====
  const stripH = 42;
  roundedBox(doc, x0, y, contentW, stripH, 14, "#ffffff", "#e2e8f0");

  const cityVal = safeText(equipment.city || lead.city || "—");
  drawKV(doc, x0 + 14, y + 12, "Ciudad:", cityVal, 55, 190);
  drawKV(doc, x0 + 260, y + 12, "Terreno:", safeText(equipment.terrain || "—"), 60, 190);
  drawKV(doc, x0 + 14, y + 28, "Actividad:", safeText(equipment.activity || "—"), 55, 190);

  const durTxt = requestedDays ? `${requestedDays} días` : "—";
  drawKV(doc, x0 + 260, y + 28, "Duración:", durTxt, 60, 190);

  y += stripH + 14;

  // ===== Tabla comparativa =====
  drawSectionTitle(doc, x0, y, "Opciones de cotización");
  y += 12;

  const usableOptions = Array.isArray(options) ? options : [];

  // best costo/día
  let bestIdx = -1;
  let bestPerDay = Infinity;
  usableOptions.forEach((opt, idx) => {
    const perDay = effectivePerDay(opt);
    if (perDay > 0 && perDay < bestPerDay) {
      bestPerDay = perDay;
      bestIdx = idx;
    }
  });

  // Columnas corregidas: TOTAL ancho para que NO se parta
  // Total = 70px, IVA = 60, Transporte = 75, Equipo = 95, Precio/día = 75, Opción = 145  => 520
  const cols = [
    { label: "Opción", w: 145, align: "left" },
    { label: "Precio / día", w: 75, align: "right" },
    { label: "Equipo (sin IVA)", w: 95, align: "right" },
    { label: "Transporte", w: 75, align: "right" },
    { label: "IVA 16%", w: 60, align: "right" },
    { label: "Total", w: 70, align: "right" },
  ];

  // Header
  roundedBox(doc, x0, y, 520, 22, 10, "#0f172a", null);
  doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(8);

  let cx = x0;
  for (const c of cols) {
    doc.text(c.label, cx + 8, y + 6, { width: c.w - 16, align: c.align || "left" });
    cx += c.w;
  }
  y += 28;

  // Rows (máx 4 filas)
  const maxRows = Math.min(usableOptions.length, 4);
  const rowH = 24;
  const gap = 5;

  for (let i = 0; i < maxRows; i++) {
    const opt = usableOptions[i];
    const isRequested = requestedDays != null && Number(opt?.durationDays) === Number(requestedDays);
    const isBest = i === bestIdx;

    if (isRequested) roundedBox(doc, x0, y, 520, rowH, 10, "#e0f2fe", null);
    else if (i % 2 === 1) roundedBox(doc, x0, y, 520, rowH, 10, "#f8fafc", null);

    const label = pickLabelForOption(opt, requestedDays);

    const perDay = effectivePerDay(opt);

    // Para evitar wrap: usamos formato corto en tabla (sin “MXN”)
    const cells = [
      label,
      perDay ? `$${moneyShortMx(perDay)}` : "—",
      `$${moneyShortMx(opt?.rentalBaseMx || 0)}`,
      `$${moneyShortMx(opt?.transportMx || 0)}`,
      `$${moneyShortMx(opt?.vatMx || 0)}`,
      `$${moneyShortMx(opt?.totalMx || 0)}`,
    ];

    doc.fillColor("#0f172a").font("Helvetica").fontSize(8.8);

    cx = x0;
    for (let k = 0; k < cols.length; k++) {
      const c = cols[k];
      doc.text(safeText(cells[k]), cx + 8, y + 6, { width: c.w - 16, align: c.align || "left" });
      cx += c.w;
    }

    // Badge mejor costo/día (sin romper tabla)
    if (isBest) {
      const badge = "★ Mejor costo / día";
      doc.font("Helvetica-Bold").fontSize(7.8);

      const padX = 7;
      const bw = doc.widthOfString(badge) + padX * 2;
      const bh = 13;

      const bx = x0 + 108; // dentro de la columna "Opción" sin chocar texto
      const by = y + 5;

      roundedBox(doc, bx, by, bw, bh, 7, "#16a34a", null);
      doc.fillColor("#ffffff").text(badge, bx + padX, by + 2, { width: bw - padX * 2 });
    }

    y += rowH + gap;
  }

  // ===== Resumen (más compacto, 1 página) =====
  const main = usableOptions?.[0] || null;
  y += 6;

  const sumH = 72;
  roundedBox(doc, x0, y, contentW, sumH, 16, "#0f172a", null);

  doc.font("Helvetica-Bold").fontSize(9.8).fillColor("#ffffff");
  doc.text("Resumen (opción solicitada)", x0 + 14, y + 12);

  doc.font("Helvetica").fontSize(8.8).fillColor("#cbd5e1");
  doc.text(`Equipo: ${safeText(equipment.type || "—")}`, x0 + 14, y + 30, { width: 320 });
  doc.text(`Duración: ${requestedDays ? `${requestedDays} días` : "—"}`, x0 + 14, y + 44, {
    width: 320,
  });

  const rightX = x0 + contentW - 200;
  doc.font("Helvetica").fontSize(8.6).fillColor("#cbd5e1");
  doc.text("Equipo (sin IVA)", rightX, y + 14, { width: 190, align: "right" });
  doc.text("Transporte", rightX, y + 28, { width: 190, align: "right" });
  doc.text("IVA 16%", rightX, y + 42, { width: 190, align: "right" });

  doc.font("Helvetica-Bold").fontSize(8.8).fillColor("#ffffff");
  doc.text(mxn(main?.rentalBaseMx || 0), rightX, y + 14, { width: 190, align: "right" });
  doc.text(mxn(main?.transportMx || 0), rightX, y + 28, { width: 190, align: "right" });
  doc.text(mxn(main?.vatMx || 0), rightX, y + 42, { width: 190, align: "right" });

  // TOTAL grande (tech)
  doc.font("Helvetica-Bold").fontSize(15.5).fillColor("#ffffff");
  doc.text(mxn(main?.totalMx || 0), rightX, y + 54, { width: 190, align: "right" });

  y += sumH + 12;

  // ===== Condiciones (caja pro y bullets bien envueltos) =====
  drawSectionTitle(doc, x0, y, "Condiciones");
  y += 12;

  const termsList =
    Array.isArray(terms) && terms.length
      ? terms
      : [
          "Precios sin IVA. IVA 16% por separado.",
          "Transporte redondo según zona (si aplica).",
          "Vigencia: 48 horas.",
        ];

  // Caja gris clara
  const termsBoxH = 92; // fijo para mantener 1 página
  roundedBox(doc, x0, y, contentW, termsBoxH, 14, "#f8fafc", "#e2e8f0");

  const bottomY = drawBulletList(doc, x0 + 14, y + 12, contentW - 28, termsList, 5);

  y += termsBoxH + 10;

  // ===== Footer =====
  doc.save();
  doc.moveTo(x0, pageH - 34).lineTo(x0 + contentW, pageH - 34).strokeColor("#e2e8f0").lineWidth(1).stroke();
  doc.restore();

  doc.font("Helvetica").fontSize(8).fillColor("#64748b");
  doc.text("Generado automáticamente por VEXIQO", x0, pageH - 26, { width: contentW, align: "center" });

  doc.end();

  const buffer = await bufferPromise;
  const filename = `Cotizacion_${safeText(quote.quoteNumber || "SN")}.pdf`;
  return { buffer, filename };
}
