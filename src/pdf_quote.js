/**
 * src/pdf_quote.js
 * HTML -> PDF (Playwright) for Quote PDF 2.0 comparative:
 *   - Primary: exact request ("Tu solicitud (X días)")
 *   - References: "Semana (7 días)" and "Mes (30 días)" (or "1 día" as fallback)
 */

const { chromium } = require("playwright");

/**
 * Generate Quote PDF buffer (comparative).
 * @param {Object} input
 * @param {Object=} input.company
 * @param {Object=} input.lead
 * @param {Object=} input.quote
 * @param {Array=}  input.options  // [{durationDays, rentalBaseMx, transportMx, subtotalMx, vatMx, totalMx}]
 * @param {Object=} input.equipment
 * @param {Array<string>=} input.terms
 * @param {number=} input.requestedDays // exact days requested by customer (for labeling primary column)
 * @returns {Promise<{buffer: Buffer, filename: string}>}
 */
async function generateQuotePdfBuffer(input) {
  const company = input.company || {};
  const lead = input.lead || {};
  const quote = input.quote || {};
  const options = Array.isArray(input.options) ? input.options : [];
  const equipment = input.equipment || {};
  const requestedDays = Number(input.requestedDays || (options[0]?.durationDays ?? 0));

  const terms = Array.isArray(input.terms) && input.terms.length
    ? input.terms
    : [
        "Precios sin IVA + IVA 16% por separado.",
        "Transporte redondo según zona (si aplica).",
        "Vigencia: 48 horas.",
      ];

  // Expect 3 options: [primaryExact, ref7, ref30] (or fallback 1D)
  // Keep order as received, but ensure max 3.
  const cols = options.slice(0, 3);

  const html = buildHtml({ company, lead, quote, equipment, cols, terms, requestedDays });

  const browser = await chromium.launch({
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "load" });

    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "12mm", right: "12mm", bottom: "12mm", left: "12mm" },
    });

    const safeQuoteNo = (quote.quoteNumber || "QUOTE").replace(/[^a-zA-Z0-9-_]/g, "");
    const filename = `${safeQuoteNo}_comparativo.pdf`;

    return { buffer: Buffer.from(pdf), filename };
  } finally {
    await browser.close();
  }
}

function mxn(n) {
  const val = Number.isFinite(n) ? n : 0;
  return val.toLocaleString("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 });
}

function fmtDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("es-MX", { year: "numeric", month: "short", day: "2-digit" });
}

/**
 * Column label rules:
 * - First column: "Tu solicitud (X días)" where X = requestedDays
 * - If durationDays == 7 => "Semana (7 días)"
 * - If durationDays == 30 => "Mes (30 días)"
 * - If durationDays == 1 => "1 día"
 * - Else fallback: "${d} días"
 */
function columnLabel(index, durationDays, requestedDays) {
  const d = Number(durationDays);

  if (index === 0) {
    const x = Number.isFinite(requestedDays) && requestedDays > 0 ? requestedDays : d;
    const suf = x === 1 ? "día" : "días";
    return `Tu solicitud (${x} ${suf})`;
  }

  if (d === 7) return "Semana (7 días)";
  if (d === 30) return "Mes (30 días)";
  if (d === 1) return "1 día";
  return `${d} días`;
}

function buildHtml({ company, lead, quote, equipment, cols, terms, requestedDays }) {
  const created = fmtDate(quote.createdAtISO);
  const quoteNumber = quote.quoteNumber || "—";

  const compName = company.name || "VEXIQO";
  const compPhone = company.phone || "";
  const compEmail = company.email || "";
  const compWeb = company.website || "";

  const leadName = lead.name || "—";
  const leadCity = lead.city || "—";
  const leadPhone = lead.phone || "—";
  const leadEmail = lead.email || "—";

  const eqType = equipment.type || "BRAZO";
  const eqHeightM = Number.isFinite(equipment.height_m) ? equipment.height_m : null;
  const eqHeightTxt = eqHeightM ? `${eqHeightM.toFixed(3)} m` : "—";
  const eqTerrain = equipment.terrain || "—";
  const eqActivity = equipment.activity || "—";

  const transportZone = quote.transportZone || "—";

  // Always show 3 columns; if fewer, fill with zeros (avoids broken layout)
  const filledCols = [
    cols[0] || { durationDays: requestedDays || 0, rentalBaseMx: 0, transportMx: 0, subtotalMx: 0, vatMx: 0, totalMx: 0 },
    cols[1] || { durationDays: 7, rentalBaseMx: 0, transportMx: 0, subtotalMx: 0, vatMx: 0, totalMx: 0 },
    cols[2] || { durationDays: 30, rentalBaseMx: 0, transportMx: 0, subtotalMx: 0, vatMx: 0, totalMx: 0 },
  ];

  const rows = [
    { label: "Renta base", key: "rentalBaseMx" },
    { label: "Transporte redondo", key: "transportMx" },
    { label: "Subtotal (sin IVA)", key: "subtotalMx" },
    { label: "IVA 16%", key: "vatMx" },
    { label: "Total final", key: "totalMx", strong: true },
  ];

  const termsHtml = terms.map(t => `<li>${escapeHtml(t)}</li>`).join("");

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Cotización ${escapeHtml(quoteNumber)}</title>
  <style>
    :root {
      --ink: #0f172a;
      --muted: #475569;
      --line: #e2e8f0;
      --panel: #f8fafc;
      --accent: #0b1f3a;
      --accent2: #1d4ed8;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial;
      color: var(--ink);
      background: #ffffff;
    }
    .wrap { width: 100%; }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 16px;
      padding: 14px 16px;
      border: 1px solid var(--line);
      border-radius: 14px;
      background: linear-gradient(180deg, #ffffff, #fbfdff);
    }
    .brand { display: flex; flex-direction: column; gap: 6px; }
    .brand h1 { margin: 0; font-size: 18px; letter-spacing: 0.2px; }
    .brand .sub { font-size: 11px; color: var(--muted); line-height: 1.2; }
    .quoteBox {
      min-width: 220px;
      border-left: 1px dashed var(--line);
      padding-left: 14px;
      display: flex;
      flex-direction: column;
      gap: 6px;
      align-items: flex-end;
      text-align: right;
    }
    .quoteBox .qno { font-size: 14px; font-weight: 700; }
    .quoteBox .meta { font-size: 11px; color: var(--muted); }

    .grid {
      margin-top: 10px;
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
    }
    .card {
      border: 1px solid var(--line);
      border-radius: 14px;
      padding: 12px 14px;
      background: #fff;
    }
    .card h2 {
      margin: 0 0 8px 0;
      font-size: 12px;
      color: var(--accent);
      letter-spacing: 0.3px;
      text-transform: uppercase;
    }
    .kv {
      display: grid;
      grid-template-columns: 110px 1fr;
      gap: 6px 10px;
      font-size: 11px;
      line-height: 1.25;
    }
    .kv .k { color: var(--muted); }
    .kv .v { font-weight: 600; }

    .tableWrap {
      margin-top: 10px;
      border: 1px solid var(--line);
      border-radius: 14px;
      overflow: hidden;
    }
    table { width: 100%; border-collapse: collapse; font-size: 11px; }
    thead th {
      background: var(--panel);
      color: var(--accent);
      letter-spacing: 0.25px;
      font-size: 10px;
      padding: 10px 10px;
      border-bottom: 1px solid var(--line);
      text-transform: none;
    }
    tbody td {
      padding: 9px 10px;
      border-bottom: 1px solid var(--line);
      vertical-align: middle;
    }
    tbody tr:last-child td { border-bottom: none; }
    td.label { width: 38%; color: var(--muted); font-weight: 700; }
    td.num { text-align: right; font-variant-numeric: tabular-nums; }

    .strongRow td { font-weight: 800; color: #0b1220; }
    .strongRow td.label { color: #0b1220; }

    .pill {
      display: inline-block;
      padding: 3px 8px;
      border-radius: 999px;
      background: rgba(29, 78, 216, 0.08);
      color: var(--accent2);
      font-weight: 800;
      font-size: 10px;
      line-height: 1.1;
      white-space: nowrap;
    }
    .pill.primary {
      background: rgba(11, 31, 58, 0.10);
      color: var(--accent);
    }

    .footer {
      margin-top: 10px;
      border: 1px solid var(--line);
      border-radius: 14px;
      padding: 10px 14px;
      background: #fff;
      font-size: 10.5px;
      color: var(--muted);
    }
    .footer ul { margin: 6px 0 0 18px; padding: 0; }
    .footer li { margin: 3px 0; }
    .note {
      margin-top: 8px;
      font-size: 10px;
      color: var(--muted);
      text-align: right;
    }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="header">
      <div class="brand">
        <h1>${escapeHtml(compName)} – Cotización</h1>
        <div class="sub">
          ${escapeHtml([compPhone, compEmail, compWeb].filter(Boolean).join(" • "))}
        </div>
      </div>
      <div class="quoteBox">
        <div class="qno">Cotización: ${escapeHtml(quoteNumber)}</div>
        <div class="meta">Fecha: ${escapeHtml(created || "—")}</div>
        <div class="meta">Zona: ${escapeHtml(transportZone)}</div>
      </div>
    </div>

    <div class="grid">
      <div class="card">
        <h2>Cliente</h2>
        <div class="kv">
          <div class="k">Nombre</div><div class="v">${escapeHtml(leadName)}</div>
          <div class="k">Ciudad</div><div class="v">${escapeHtml(leadCity)}</div>
          <div class="k">WhatsApp</div><div class="v">${escapeHtml(leadPhone)}</div>
          <div class="k">Email</div><div class="v">${escapeHtml(leadEmail)}</div>
        </div>
      </div>

      <div class="card">
        <h2>Equipo solicitado</h2>
        <div class="kv">
          <div class="k">Tipo</div><div class="v">${escapeHtml(eqType)}</div>
          <div class="k">Altura</div><div class="v">${escapeHtml(eqHeightTxt)}</div>
          <div class="k">Terreno</div><div class="v">${escapeHtml(eqTerrain)}</div>
          <div class="k">Actividad</div><div class="v">${escapeHtml(eqActivity)}</div>
        </div>
      </div>
    </div>

    <div class="tableWrap">
      <table>
        <thead>
          <tr>
            <th style="text-align:left;">Concepto</th>
            ${filledCols.map((o, idx) => {
              const label = columnLabel(idx, o.durationDays, requestedDays);
              const cls = idx === 0 ? "pill primary" : "pill";
              return `<th class="num"><span class="${cls}">${escapeHtml(label)}</span></th>`;
            }).join("")}
          </tr>
        </thead>
        <tbody>
          ${rows.map(r => {
            const cls = r.strong ? "strongRow" : "";
            return `<tr class="${cls}">
              <td class="label">${escapeHtml(r.label)}</td>
              ${filledCols.map(o => `<td class="num">${mxn(o[r.key])}</td>`).join("")}
            </tr>`;
          }).join("")}
        </tbody>
      </table>
    </div>

    <div class="footer">
      <div style="font-weight:800; color: var(--ink);">Términos</div>
      <ul>${termsHtml}</ul>
    </div>

    <div class="note">* Cotización generada automáticamente. Confirmación final por WhatsApp.</div>
  </div>
</body>
</html>`;
}

function escapeHtml(s) {
  const str = String(s ?? "");
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

module.exports = {
  generateQuotePdfBuffer,
};
