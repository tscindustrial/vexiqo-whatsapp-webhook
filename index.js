import express from "express";
import { extractLeadFields } from "./src/ai_extractor.js";

import {
  getOrCreateCompany,
  upsertLead,
  getOrCreateConversation,
  saveMessage,
  setLeadName,
  setConversationState,
  getOrCreateQualification,
  getQualification,
  patchQualificationFromExtract
} from "./src/crm.js";

import { createDraftQuoteWithPdf } from "./src/quote_service.js";

const app = express();
app.use(express.json());

const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN || "vexiqo_verify_2026";
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
const ADMIN_PHONE = process.env.ADMIN_PHONE; // ej: 5218128667708

app.get("/", (req, res) => res.status(200).send("Vexiqo webhook alive"));

app.get("/webhooks/whatsapp", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) return res.status(200).send(challenge);
  return res.sendStatus(403);
});

async function sendWhatsAppText(to, body) {
  if (!WHATSAPP_TOKEN || !PHONE_NUMBER_ID) {
    console.log("Missing WHATSAPP_TOKEN or WHATSAPP_PHONE_NUMBER_ID");
    return;
  }

  const url = `https://graph.facebook.com/v22.0/${PHONE_NUMBER_ID}/messages`;
  const payload = {
    messaging_product: "whatsapp",
    to,
    type: "text",
    text: { body }
  };

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${WHATSAPP_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const data = await resp.json();
  console.log("Send response:", resp.status, JSON.stringify(data));
}

function buildNextQuestion({ leadName, missing }) {
  if (!leadName) {
    return "Hola 👋 Soy VEXIQO de TSC Industrial. ¿Me compartes tu nombre para apoyarte mejor?";
  }

  if (!missing || missing.length === 0) {
    return "Perfecto. Ya tengo lo necesario para generar tu cotización. Dame un momento.";
  }

  const next = missing[0];

  // Orden técnico primero (como pediste)
  if (next === "height_m") {
    return `Gracias, ${leadName}. ¿Qué altura necesitas alcanzar? (ej: 14m o 45ft)`;
  }
  if (next === "type") {
    return "¿Necesitas brazo articulado o tijera?";
  }
  if (next === "activity") {
    return "¿El trabajo es de pintura o uso general?";
  }
  if (next === "terrain") {
    return "¿El terreno es piso firme (concreto) o terracería?";
  }
  if (next === "city") {
    return "¿En qué ciudad es el trabajo? (ej: Saltillo, Monterrey)";
  }
  if (next === "duration_days") {
    return "¿Cuántos días necesitas el equipo?";
  }

  return "Perfecto. ¿Me confirmas terreno, ciudad y duración?";
}

app.post("/webhooks/whatsapp", async (req, res) => {
  // Responde rápido a Meta
  res.sendStatus(200);

  try {
    const entry = req.body?.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;

    const msg = value?.messages?.[0];
    if (!msg) return;

    const from = msg.from;
    const text = msg?.text?.body || "";

    console.log("Incoming:", from, text);

    // Seguridad: por ahora solo admin
    if (ADMIN_PHONE && from !== ADMIN_PHONE) {
      console.log("Ignoring non-admin sender:", from);
      return;
    }

    // 1) CRM base
    const company = await getOrCreateCompany(); // por ahora 1 empresa (TSC)
    const lead = await upsertLead(company.id, from);
    const convo = await getOrCreateConversation(company.id, lead.id);

    // Guarda inbound
    await saveMessage({
      companyId: company.id,
      conversationId: convo.id,
      direction: "INBOUND",
      body: text,
      waMessageId: msg.id || null,
      rawPayload: msg
    });

    // 2) Asegura que exista Qualification (acumulado por lead)
    await getOrCreateQualification(company.id, lead.id);

    // 3) IA extractor (NO debe tumbar el flujo si falla)
    let extracted = null;
    try {
      extracted = await extractLeadFields({
        text,
        known: {
          name: lead.name || null
        }
      });
      console.log("AI extracted:", extracted);
    } catch (e) {
      console.log("AI extractor error:", e);
    }

    // 4) Persistir lo extraído (sin borrar lo anterior)
    if (!lead.name && extracted?.name) {
      await setLeadName(lead.id, extracted.name);
      lead.name = extracted.name;
    }

    if (extracted) {
      await patchQualificationFromExtract(lead.id, extracted);
    }

    // 5) Leer acumulado desde BD y calcular faltantes DESDE LO ACUMULADO
    const q = await getQualification(lead.id);

    const missing = [];
    if (!q?.heightMeters) missing.push("height_m");
    if (!q?.liftType) missing.push("type");
    if (!q?.activity) missing.push("activity");
    if (!q?.terrain) missing.push("terrain");
    if (!q?.city) missing.push("city");
    if (!q?.durationDays) missing.push("duration_days");

    // 6) Definir estado conversacional
    const nextState = missing.length > 0 ? "TECH_QUALIFICATION" : "READY_FOR_MATCH";

    // ✅ 6.1) Si ya está todo, generamos cotización (1 paso, sin email todavía)
    if (nextState === "READY_FOR_MATCH") {
      // Evita generar varias veces si el usuario manda otro mensaje con todo completo
      const currentState = convo?.state || convo?.conversationState || null;
      if (currentState !== "QUOTE_DRAFTED") {
        const { transportZone, transportRoundTripMx } = resolveTransportByCity(q.city);

        // Si no pudimos resolver zona, igual generamos con transporte 0, pero lo dejamos claro.
        const durationDays = Number(q.durationDays);

        const equipment = {
          equipmentModel: "45FT",
          type: q.liftType,        // "BRAZO" / "TIJERA"
          height_m: Number(q.heightMeters),
          terrain: q.terrain,
          activity: q.activity
        };

        const result = await createDraftQuoteWithPdf({
          companyId: company.id,
          lead: {
            name: lead.name || null,
            phoneE164: from,
            email: lead.email || null,
            city: q.city || null
          },
          durationDays,
          transportZone,
          transportRoundTripMx,
          equipment,
          meta: {
            source: "whatsapp",
            conversationId: convo.id,
            qualificationSnapshot: q
          }
        });

        // Cambia estado conversacional para no duplicar
        await setConversationState(convo.id, "READY_FOR_MATCH");

        const totalExact = result.options?.[0]?.totalMx ?? null;

        const reply = buildQuoteDraftedReply({
          leadName: lead.name,
          quoteNumber: result.quoteNumber,
          durationDays,
          totalExactMx: totalExact,
          transportZone,
          transportRoundTripMx
        });

        // Guarda outbound
        await saveMessage({
          companyId: company.id,
          conversationId: convo.id,
          direction: "OUTBOUND",
          body: reply,
          waMessageId: null,
          rawPayload: null
        });

        await sendWhatsAppText(from, reply);
        return;
      }

      // Si ya existe QUOTE_DRAFTED, solo pedimos email de nuevo (sin regenerar)
      const reply = "Ya tengo tu cotización lista. ¿A qué email te la envío en PDF?";
      await saveMessage({
        companyId: company.id,
        conversationId: convo.id,
        direction: "OUTBOUND",
        body: reply,
        waMessageId: null,
        rawPayload: null
      });
      await sendWhatsAppText(from, reply);
      return;
    }

    // 7) Si falta info, seguimos calificando normal
    await setConversationState(convo.id, nextState);

    const reply = buildNextQuestion({
      leadName: lead.name,
      missing
    });

    // Guarda outbound
    await saveMessage({
      companyId: company.id,
      conversationId: convo.id,
      direction: "OUTBOUND",
      body: reply,
      waMessageId: null,
      rawPayload: null
    });

    await sendWhatsAppText(from, reply);
  } catch (e) {
    console.log("Webhook error:", e);
  }
});

function mxn(n) {
  const val = Number.isFinite(n) ? n : 0;
  return val.toLocaleString("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 });
}

// Transporte redondo (SIN IVA) según doc maestro :contentReference[oaicite:1]{index=1}
function resolveTransportByCity(cityRaw) {
  const city = String(cityRaw || "").toLowerCase();

  // Defaults
  let transportZone = "Otra zona";
  let transportRoundTripMx = 0;

  if (city.includes("ramos")) {
    transportZone = "Ramos Arizpe";
    transportRoundTripMx = 2500;
  } else if (city.includes("saltillo")) {
    // Si el usuario no especifica norte/sur, usamos Norte por default (más conservador)
    transportZone = "Saltillo Norte";
    transportRoundTripMx = 2500;
  } else if (city.includes("arteaga")) {
    transportZone = "Arteaga";
    transportRoundTripMx = 3000;
  } else if (city.includes("derrama")) {
    transportZone = "Derramadero";
    transportRoundTripMx = 4500;
  } else if (city.includes("santa catarina")) {
    transportZone = "Santa Catarina";
    transportRoundTripMx = 4500;
  } else if (city.includes("apodaca")) {
    transportZone = "Apodaca";
    transportRoundTripMx = 4500;
  }

  return { transportZone, transportRoundTripMx };
}

function buildQuoteDraftedReply({ leadName, quoteNumber, durationDays, totalExactMx, transportZone, transportRoundTripMx }) {
  const name = leadName ? `${leadName}` : "¡Listo!";
  const durTxt = durationDays === 1 ? "1 día" : `${durationDays} días`;

  const transportTxt =
    transportRoundTripMx > 0
      ? `Transporte redondo (${transportZone}): ${mxn(transportRoundTripMx)} + IVA.`
      : `Transporte: por cotizar (necesito zona exacta).`;

  const totalTxt =
    Number.isFinite(totalExactMx) && totalExactMx > 0
      ? `Total (tu solicitud ${durTxt}, con IVA): ${mxn(totalExactMx)}.`
      : `Ya generé la cotización base para ${durTxt}.`;

  return `${name}. ✅ Generé tu cotización *${quoteNumber}*.\n\n${totalTxt}\n${transportTxt}\n\n¿A qué *email* te la envío en PDF?`;
}

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Listening on ${port}`));
