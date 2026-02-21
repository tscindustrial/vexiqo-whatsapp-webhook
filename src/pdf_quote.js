import PDFDocument from "pdfkit";

function moneyShortMx(n) {
  const v = Math.round(Number(n || 0));
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

function drawBulletListFit(doc, x, y, w, maxBottomY, items) {
  doc.font("Helvetica").fontSize(8.4).fillColor("#334155");

  let cy = y;
  for (const t of items) {
    const text = safeText(t);
    const h = doc.heightOfString(text, { width: w - 12, lineGap: 1.4 });
    const needed = Math.max(12, h) + 6;
    if (cy + needed > maxBottomY) break;

    doc.circle(x + 3, cy + 4, 1.4).fill("#334155");
    doc.fillColor("#334155");

    doc.text(text, x + 12, cy, { width: w - 12, lineGap: 1.4 });
    cy += needed;
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
    margins: { top: 26, left: 32, right: 32, bottom: 26 },
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

  // ===== Header (sin logos, limpio) =====
  const headerH = 86;
  doc.save();
  doc.rect(0, 0, pageW, headerH).fill("#0b1220");
  doc.restore();

  // Texto empresa (como tu primer intento)
  doc.font("Helvetica-Bold").fontSize(16).fillColor("#ffffff");
  doc.text("TS Contratistas", x0, 22, { width: contentW });

  doc.font("Helvetica").fontSize(8.6).fillColor("#cbd5e1");
  doc.text("Cotización automática generada por VEXIQO", x0, 44, { width: contentW });

  const folio = safeText(quote.quoteNumber || "—");
  const fecha = fmtDateEsMX(quote.createdAtISO || Date.now());

  doc.font("Helvetica").fontSize(8.5).fillColor("#cbd5e1");
  doc.text("Folio", x0, 20, { width: contentW, align: "right" });
  doc.font("Helvetica-Bold").fontSize(10.5).fillColor("#ffffff");
  doc.text(folio, x0, 32, { width: contentW, align: "right" });

  doc.font("Helvetica").fontSize(8.5).fillColor("#cbd5e1");
  doc.text("Fecha", x0, 50, { width: contentW, align: "right" });
  doc.font("Helvetica-Bold").fontSize(9.5).fillColor("#ffffff");
  doc.text(fecha || "—", x0, 62, { width: contentW, align: "right" });

  // Divider
  doc.save();
  doc.rect(0, headerH, pageW, 1).fill("#0f172a");
  doc.restore();

  let y = headerH + 12;

  // Zona pill
  if (quote.transportZone) {
    const text = `Zona: ${safeText(quote.transportZone)}`;
    doc.font("Helvetica-Bold").fontSize(8).fillColor("#ffffff");

    const padX = 10;
    const pillW = doc.widthOfString(text) + padX * 2;

    roundedBox(doc, x0, y, pillW, 16, 8, "#0ea5e9", null);
    doc.text(text, x0 + padX, y + 4, { width: pillW - padX * 2 });
    y += 20;
  }

  // Cards
  const cardH = 76;
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

  // Strip técnico
  const stripH = 40;
  roundedBox(doc, x0, y, contentW, stripH, 14, "#ffffff", "#e2e8f0");

  const cityVal = safeText(equipment.city || lead.city || quote.transportZone || "—");

  drawKV(doc, x0 + 14, y + 11, "Ciudad:", cityVal, 55, 190);
  drawKV(doc, x0 + 260, y + 11, "Terreno:", safeText(equipment.terrain || "—"), 60, 190);
  drawKV(doc, x0 + 14, y + 26, "Actividad:", safeText(equipment.activity || "—"), 55, 190);

  const durTxt = requestedDays ? `${requestedDays} días` : "—";
  drawKV(doc, x0 + 260, y + 26, "Duración:", durTxt, 60, 190);

  y += stripH + 12;

  // Tabla
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

  const cols = [
    { label: "Opción", w: 155, align: "left" },
    { label: "Precio / día", w: 80, align: "right" },
    { label: "Equipo (sin IVA)", w: 95, align: "right" },
    { label: "Transporte", w: 75, align: "right" },
    { label: "IVA 16%", w: 60, align: "right" },
    { label: "Total", w: 55, align: "right" },
  ];
  const tableW = cols.reduce((a, c) => a + c.w, 0); // 520 exact

  roundedBox(doc, x0, y, tableW, 22, 10, "#0f172a", null);
  doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(8);

  let cx = x0;
  for (const c of cols) {
    doc.text(c.label, cx + 8, y + 6, { width: c.w - 16, align: c.align || "left" });
    cx += c.w;
  }
  y += 28;

  const maxRows = Math.min(usableOptions.length, 4); // solicitado + 1/7/30
  const rowH = 24;
  const gap = 5;

  for (let i = 0; i < maxRows; i++) {
    const opt = usableOptions[i];
    const isRequested = requestedDays != null && Number(opt?.durationDays) === Number(requestedDays);
    const isBest = i === bestIdx;

    if (isRequested) roundedBox(doc, x0, y, tableW, rowH, 10, "#e0f2fe", null);
    else if (i % 2 === 1) roundedBox(doc, x0, y, tableW, rowH, 10, "#f8fafc", null);

    const label = pickLabelForOption(opt, requestedDays);
    const perDay = effectivePerDay(opt);

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

    // Badge centrado dentro de columna Opción (sin tocar precio/día)
    if (isBest) {
      const badge = "Mejor costo / día";
      doc.font("Helvetica-Bold").fontSize(7.8);

      const padX = 8;
      const bw = doc.widthOfString(badge) + padX * 2;
      const bh = 13;

      const col0X = x0;
      const col0W = cols[0].w;

      // centrar badge dentro de la columna Opción
      const bx = col0X + Math.round((col0W - bw) / 2);
      const by = y + 5;

      roundedBox(doc, bx, by, bw, bh, 7, "#16a34a", null);
      doc.fillColor("#ffffff");
      doc.text(badge, bx, by + 2, { width: bw, align: "center" });
    }

    y += rowH + gap;
  }

  // Resumen
  const main = usableOptions?.[0] || null;
  y += 6;

  const sumH = 70;
  roundedBox(doc, x0, y, contentW, sumH, 16, "#0f172a", null);

  doc.font("Helvetica-Bold").fontSize(9.8).fillColor("#ffffff");
  doc.text("Resumen (opción solicitada)", x0 + 14, y + 12);

  doc.font("Helvetica").fontSize(8.8).fillColor("#cbd5e1");
  doc.text(`Equipo: ${safeText(equipment.type || "—")}`, x0 + 14, y + 30, { width: 320 });
  doc.text(`Duración: ${requestedDays ? `${requestedDays} días` : "—"}`, x0 + 14, y + 44, {
    width: 320,
  });

  // bloque derecho con padding interno (NO pegado al borde)
  const blockW = 220;
  const blockX = x0 + contentW - blockW - 10; // padding extra
  const labelW = 120;
  const valueW = blockW - labelW;

  doc.font("Helvetica").fontSize(8.6).fillColor("#cbd5e1");
  doc.text("Equipo (sin IVA)", blockX, y + 14, { width: labelW, align: "left" });
  doc.text("Transporte", blockX, y + 28, { width: labelW, align: "left" });
  doc.text("IVA 16%", blockX, y + 42, { width: labelW, align: "left" });

  doc.font("Helvetica-Bold").fontSize(8.8).fillColor("#ffffff");
  doc.text(mxn(main?.rentalBaseMx || 0), blockX + labelW, y + 14, { width: valueW, align: "right" });
  doc.text(mxn(main?.transportMx || 0), blockX + labelW, y + 28, { width: valueW, align: "right" });
  doc.text(mxn(main?.vatMx || 0), blockX + labelW, y + 42, { width: valueW, align: "right" });

  doc.font("Helvetica-Bold").fontSize(15.5).fillColor("#ffffff");
  doc.text(mxn(main?.totalMx || 0), blockX, y + 52, { width: blockW, align: "right" });

  y += sumH + 10;

  // Condiciones (siempre incluye transporte + vigencia)
  drawSectionTitle(doc, x0, y, "Condiciones");
  y += 12;

  const required = [
    "Transporte redondo según zona (si aplica).",
    "Vigencia: 48 horas.",
  ];

  // si terms trae algo extra (como optimización), lo ponemos primero y luego garantizamos required
  const extras = Array.isArray(terms) ? terms.filter(Boolean) : [];
  const merged = [];

  for (const t of extras) {
    if (!merged.includes(t)) merged.push(t);
  }
  for (const t of required) {
    if (!merged.includes(t)) merged.push(t);
  }
  // y aseguramos también IVA si no venía
  if (!merged.some((t) => String(t).toLowerCase().includes("iva"))) {
    merged.splice(merged.length - 2, 0, "Precios sin IVA. IVA 16% por separado.");
  }

  // caja fija pero con fit para que no se salga
  const termsBoxH = 86;
  roundedBox(doc, x0, y, contentW, termsBoxH, 14, "#f8fafc", "#e2e8f0");

  const innerTop = y + 12;
  const innerBottom = y + termsBoxH - 12;

  drawBulletListFit(doc, x0 + 14, innerTop, contentW - 28, innerBottom, merged);

  // ✅ IMPORTANTÍSIMO: no footer, no “text below margin” => NO página 2
  doc.end();

  const buffer = await bufferPromise;
  const filename = `Cotizacion_${safeText(quote.quoteNumber || "SN")}.pdf`;
  return { buffer, filename };
}
