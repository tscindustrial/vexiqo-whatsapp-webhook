import express from "express";
import { getOrCreateCompany, upsertLead, getOrCreateConversation, saveMessage } from "./src/crm.js";

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

    // 3) Guarda mensaje inbound
    await saveMessage({
      companyId: company.id,
      conversationId: convo.id,
      direction: "INBOUND",
      body: text,
      waMessageId: msg.id,
      rawPayload: req.body
    });

    // 4) Respuesta simple tipo “echo”
    const reply = `VEXIQO ✅ Recibí: "${text}"`;

    // 5) Guarda mensaje outbound
    await saveMessage({
      companyId: company.id,
      conversationId: convo.id,
      direction: "OUTBOUND",
      body: reply,
      waMessageId: null,
      rawPayload: null
    });

    // 6) Envía WhatsApp
    await sendWhatsAppText(from, reply);
  } catch (e) {
    console.log("Webhook error:", e);
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Listening on ${port}`));

