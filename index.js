import express from "express";
import { extractLeadFields } from "./src/ai_extractor.js";

import {
  getOrCreateCompany,
  upsertLead,
  getOrCreateConversation,
  saveMessage,
  setLeadName,
  setLeadEmail,
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

/**
 * Envía un PDF como documento (WhatsApp Cloud API)
 * Flujo: 1) upload media  2) send message document
 */
async function sendWhatsAppDocument(to, pdfBuffer, filename, caption) {
  if (!WHATSAPP_TOKEN || !PHONE_NUMBER_ID) {
    console.log("Missing WHATSAPP_TOKEN or WHATSAPP_PHONE_NUMBER_ID");
    return;
  }

  if (!pdfBuffer || !filename) {
    console.log("Missing pdfBuffer or filename for sendWhatsAppDocument");
    return;
  }

  // 1) Upload media
  const mediaUrl = `https://graph.facebook.com/v22.0/${PHONE_NUMBER_ID}/media`;

  const form = new FormData();
  form.append("messaging_product", "whatsapp");

  // Node 18+ soporta Blob/FormData global.
  const blob = new Blob([pdfBuffer], { type: "application/pdf" });
  form.append("file", blob, filename);

  const mediaResp = await fetch(mediaUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${WHATSAPP_TOKEN}`
      // NO setear Content-Type; fetch lo genera con boundary
    },
    body: form
  });

  const mediaData = await mediaResp.json();
  console.log("Media upload:", mediaResp.status, JSON.stringify(mediaData));

  const mediaId = mediaData?.id;
  if (!mediaId) {
    console.log("Media upload failed (no id). Falling back to text.");
    await sendWhatsAppText(to, caption || "Ya generé tu cotización en PDF.");
    return;
  }

  // 2) Send document message
  const msgUrl = `https://graph.facebook.com/v22.0/${PHONE_NUMBER_ID}/messages`;
  const msgPayload = {
    messaging_product: "whatsapp",
    to,
    type: "document",
    document: {
      id: mediaId,
      filename,
      caption: caption || ""
    }
  };

  const msgResp = await fetch(msgUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${WHATSAPP_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(msgPayload)
  });

  const msgData = await msgResp.json();
  console.log("Document send:", msgResp.status, JSON.stringify(msgData));
}

function buildNextQuestion({ leadName, missing, invalidField, invalidEmailAttempt }) {
  if (!leadName) {
    return "Hola 👋 Soy VEXIQO de TSC Industrial. ¿Me compartes tu nombre para apoyarte mejor?";
  }

  if (!missing || missing.length === 0) {
    return "Perfecto. Ya tengo lo necesario para generar tu cotización. Dame un momento.";
  }

  const next = missing[0];
  const isRetry = invalidField === next;

  // Orden técnico primero (como pediste)
  if (next === "height_m") {
    if (isRetry) return `No alcancé a entender la altura 😅. Dímela así porfa: "14m" o "45ft".`;
    return `Gracias, ${leadName}. ¿Qué altura necesitas alcanzar? (ej: 14m o 45ft)`;
  }

  if (next === "type") {
    if (isRetry) return "No me quedó claro el tipo 😅. Responde solo: BRAZO o TIJERA.";
    return "¿Necesitas brazo articulado o tijera?";
  }

  if (next === "activity") {
    if (isRetry) return "No entendí la actividad 😅. Responde: PINTURA o GENERAL.";
    return "¿El trabajo es de pintura o uso general?";
  }

  if (next === "terrain") {
    if (isRetry) return "No entendí el terreno 😅. Responde: PISO FIRME o TERRACERÍA.";
    return "¿El terreno es piso firme (concreto) o terracería?";
  }

  if (next === "city") {
    if (isRetry) return "No entendí la ciudad 😅. Escríbela así: Saltillo / Ramos Arizpe / Arteaga / Derramadero / Apodaca / Santa Catarina.";
    return "¿En qué ciudad es el trabajo? (ej: Saltillo, Monterrey)";
  }

  if (next === "duration_days") {
    if (isRetry) return "No entendí los días 😅. Pon solo un número: 1, 7, 30, etc.";
    return "¿Cuántos días necesitas el equipo?";
  }

  if (next === "email") {
    if (invalidEmailAttempt) return "Ese correo no se ve válido 😅. Escríbelo otra vez (ej: compras@tuempresa.com).";
    return "¿A qué correo te envío la cotización en PDF? (ej: compras@tuempresa.com)";
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

    const from = msg?.from;
    const text = msg?.text?.body || "";

    console.log("Incoming:", from, text);

    // Seguridad: por ahora solo admin
    if (ADMIN_PHONE && from !== ADMIN_PHONE) {
      console.log("Ignoring non-admin sender:", from);
      return;
    }

    // Flags de retry UX
    let invalidEmailAttempt = false;
    let invalidField = null;

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
          name: lead.name || null,
          email: lead.email || null
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

    // Guardar email extraído por IA (con validación mínima)
    if (!lead.email && extracted?.email) {
      const candidate = String(extracted.email || "").trim().toLowerCase();
      const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate);
      if (isEmail) {
        await setLeadEmail(lead.id, candidate);
        lead.email = candidate;
      } else {
        invalidEmailAttempt = true;
      }
    }

    if (extracted) {
      await patchQualificationFromExtract(lead.id, extracted);
    }

    // 5) Leer acumulado desde BD y calcular faltantes DESDE LO ACUMULADO
    const q = await getQualification(lead.id);
    console.log("Qualification from DB:", q);

    const missing = [];
    if (!q || q.heightMeters == null) missing.push("height_m");
    if (!q || !q.liftType) missing.push("type");
    if (!q || !q.activity) missing.push("activity");
    if (!q || !q.terrain || String(q.terrain).trim() === "") missing.push("terrain");
    if (!q || !q.city || String(q.city).trim() === "") missing.push("city");
    if (!q || q.durationDays == null) missing.push("duration_days");
    if (!lead.email) missing.push("email");

    // Detectar si el usuario intentó contestar el "siguiente" campo pero la IA no lo pudo extraer
    // (solo aplica cuando extracted existe y todavía falta ese campo)
    if (extracted?.missing?.length && missing.length > 0) {
      const next = missing[0];
      if (extracted.missing.includes(next) && String(text || "").trim().length > 0) {
        // Esto dispara "retry prompt" para el campo que sigue
        invalidField = next;
      }
    }

    // 6) Definir estado conversacional
    const nextState = missing.length > 0 ? "TECH_QUALIFICATION" : "READY_FOR_MATCH";

    // ✅ 6.1) Si ya está todo, generamos cotización (1 paso, sin email SMTP todavía)
    if (nextState === "READY_FOR_MATCH") {
      // Evita generar varias veces si el usuario manda otro mensaje con todo completo
      const currentState = convo?.state || convo?.conversationState || null;
      if (currentState !== "QUOTE_DRAFTED") {
        const { transportZone, transportRoundTripMx } = resolveTransportByCity(q.city);

        // Si no pudimos resolver zona, igual generamos con transporte 0, pero lo dejamos claro.
        const durationDays = Number(q.durationDays);

        const equipment = {
          equipmentModel: "45FT",
          type: q.liftType, // "BRAZO" / "TIJERA"
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

        // Guarda outbound (registramos el caption / confirmación)
        await saveMessage({
          companyId: company.id,
          conversationId: convo.id,
          direction: "OUTBOUND",
          body: reply,
          waMessageId: null,
          rawPayload: null
        });

        // ✅ ENVIAR PDF como documento por WhatsApp (con caption)
        await sendWhatsAppDocument(from, result.pdfBuffer, result.filename, reply);
        return;
      }

      // Si ya existe QUOTE DRAFTED, solo pedimos email de nuevo (sin regenerar)
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
      missing,
      invalidField,
      invalidEmailAttempt
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

// Transporte redondo (SIN IVA) según doc maestro
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
      : "Transporte: por cotizar (necesito zona exacta).";

  const totalTxt =
    Number.isFinite(totalExactMx) && totalExactMx > 0
      ? `Total (tu solicitud ${durTxt}, con IVA): ${mxn(totalExactMx)}.`
      : `Ya generé la cotización base para ${durTxt}.`;

  // Caption corto (WhatsApp lo muestra en el documento)
  return `${name}. ✅ Te envío tu cotización *${quoteNumber}* en PDF.\n\n${totalTxt}\n${transportTxt}`;
}

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Listening on ${port}`));
