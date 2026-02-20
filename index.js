import express from "express";
import { extractLeadFields } from "./src/ai_extractor.js";
import { updateQualificationFromExtract } from "./src/crm.js";


import {
  getOrCreateCompany,
  upsertLead,
  getOrCreateConversation,
  saveMessage,
  setLeadName,
  setConversationState,
  getOrCreateQualification,
  updateQualificationHeight
} from "./src/crm.js";

import { decideNextReply } from "./src/flow.js";
import { parseHeight } from "./src/parse.js";

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

app.post("/webhooks/whatsapp", async (req, res) => {
  res.sendStatus(200); // responde rápido a Meta

  try {
    const entry = req.body?.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;

    const msg = value?.messages?.[0];
    if (!msg) return;

    const from = msg.from; // número del cliente
    const text = msg?.text?.body || "";

    console.log("Incoming:", from, text);

    // 1) Por ahora: SOLO responderte a ti (seguridad)
    if (ADMIN_PHONE && from !== ADMIN_PHONE) {
      console.log("Ignoring non-admin sender:", from);
      return;
    }

    // 2) CRM: company -> lead -> conversation
    const company = await getOrCreateCompany();
    const lead = await upsertLead(company.id, from);
    const convo = await getOrCreateConversation(company.id, lead.id);

 // 🔹 AQUÍ VA EL BLOQUE NUEVO 🔹
let extracted = null;
try {
  extracted = await extractLeadFields({
    text,
    known: { name: lead.name }
  });
  console.log("AI extracted:", extracted);
  // Guardar nombre si venía en el extract y no estaba guardado
if (!lead.name && extracted?.name) {
  await setLeadName(lead.id, extracted.name);
  lead.name = extracted.name;
}

// Guardar requisitos técnicos/comerciales en Qualification
if (extracted) {
  await updateQualificationFromExtract(lead.id, extracted);
}
} catch (e) {
  console.log("AI extractor error:", e);
}

// Si no tenemos nombre guardado y la IA detectó uno → guardarlo
if (!lead.name && extracted?.name) {
  await setLeadName(lead.id, extracted.name);
  lead.name = extracted.name; // actualizar variable local
}
// 🔹 FIN BLOQUE NUEVO 🔹

    // 4) Motor conversacional (nombre primero)
    const decision = decideNextReply({
      leadName: lead.name,
      incomingText: text,
      conversationState: convo.state
    });

    if (decision.action === "SAVE_NAME_AND_ADVANCE") {
      await setLeadName(lead.id, decision.name);
    }

    // 5) Si estamos en calificación técnica, intentamos parsear altura y guardarla
    if (decision.nextState === "TECH_QUALIFICATION") {
      const { meters, feet } = parseHeight(text);
      if (meters || feet) {
        await updateQualificationHeight(lead.id, meters, feet);
      }
    }

    // 6) Persistir estado
    await setConversationState(convo.id, decision.nextState);

    // 7) Respuesta
    let reply = decision.reply;

// Si la IA extrajo campos, preferimos preguntar lo faltante y NO hacer eco
if (extracted) {
  // Si aún falta nombre (no debería si extracted.name vino), pedimos nombre
  if (!lead.name) {
    reply = "Hola 👋 Soy VEXIQO de TSC Industrial. ¿Me compartes tu nombre para apoyarte mejor?";
  } else if (extracted?.missing?.length) {
    if (extracted.missing.includes("terrain")) {
      reply = "Gracias. ¿El terreno es piso firme (concreto) o terracería?";
    } else if (extracted.missing.includes("city")) {
      reply = "¿En qué ciudad es el trabajo? (ej: Saltillo, Monterrey)";
    } else if (extracted.missing.includes("duration_days")) {
      reply = "¿Cuántos días necesitas el equipo?";
    } else if (extracted.missing.includes("height_m")) {
      reply = `Gracias, ${lead.name}. ¿Qué altura necesitas alcanzar? (ej: 14m o 45ft)`;
    } else if (extracted.missing.includes("type")) {
      reply = "¿Necesitas brazo articulado o tijera?";
    } else if (extracted.missing.includes("activity")) {
      reply = "¿El trabajo es de pintura o uso general?";
    } else {
      reply = "Perfecto. Para validar compatibilidad, ¿me confirmas terreno, ciudad y duración?";
    }
  } else {
    reply = "Perfecto. Ya tengo lo necesario para validar compatibilidad. Dame un momento.";
  }
}


    // 8) Guarda mensaje outbound
    await saveMessage({
      companyId: company.id,
      conversationId: convo.id,
      direction: "OUTBOUND",
      body: reply,
      waMessageId: null,
      rawPayload: null
    });

    // 9) Envía WhatsApp
    await sendWhatsAppText(from, reply);
  } catch (e) {
    console.log("Webhook error:", e);
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Listening on ${port}`));
