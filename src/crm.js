import { prisma } from "./db.js";

export async function getOrCreateCompany() {
  const name = "TSC Industrial";
  return prisma.company.upsert({
    where: { name },
    update: {},
    create: { name, paintDepositMxn: 7500, paintSurchargePct: 15 }
  });
}

export async function upsertLead(companyId, phoneE164) {
  return prisma.lead.upsert({
    where: { companyId_phoneE164: { companyId, phoneE164 } },
    update: {},
    create: { companyId, phoneE164 }
  });
}

export async function getOrCreateConversation(companyId, leadId) {
  const existing = await prisma.conversation.findFirst({
    where: { companyId, leadId },
    orderBy: { updatedAt: "desc" }
  });
  if (existing) return existing;

  return prisma.conversation.create({
    data: { companyId, leadId, state: "INIT" }
  });
}

export async function saveMessage({ companyId, conversationId, direction, body, waMessageId, rawPayload }) {
  await prisma.message.create({
    data: {
      companyId,
      conversationId,
      direction,
      body,
      waMessageId: waMessageId || null,
      rawPayload: rawPayload || undefined
    }
  });

  await prisma.conversation.update({
    where: { id: conversationId },
    data: { lastMessageAt: new Date() }
  });
}

export async function setLeadName(leadId, name) {
  return prisma.lead.update({
    where: { id: leadId },
    data: { name }
  });
}

export async function setConversationState(conversationId, state) {
  return prisma.conversation.update({
    where: { id: conversationId },
    data: { state }
  });
}

export async function getOrCreateQualification(companyId, leadId) {
  const existing = await prisma.qualification.findUnique({ where: { leadId } });
  if (existing) return existing;

  // IMPORTANT: no strings vacíos, todo null
  return prisma.qualification.create({
    data: {
      companyId,
      leadId,
      heightMeters: null,
      heightFeet: null,
      liftType: null,
      activity: null,
      terrain: null,
      city: null,
      durationDays: null
    }
  });
}

export async function getQualification(leadId) {
  return prisma.qualification.findUnique({ where: { leadId } });
}

// --- Helpers ---
function cleanStr(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

/**
 * Patch acumulado: SOLO actualiza si hay valor real.
 * Nunca escribe '' (string vacío).
 * Nunca sobreescribe con null.
 */
export async function patchQualificationFromExtract(leadId, extracted) {
  const data = {};

  if (extracted?.height_m != null) data.heightMeters = extracted.height_m;
  if (extracted?.height_ft != null) data.heightFeet = extracted.height_ft;

  const liftType = cleanStr(extracted?.type);
  if (liftType) data.liftType = liftType;

  const activity = cleanStr(extracted?.activity);
  if (activity) data.activity = activity;

  const terrain = cleanStr(extracted?.terrain);
  if (terrain) data.terrain = terrain;

  const city = cleanStr(extracted?.city);
  if (city) data.city = city;

  if (extracted?.duration_days != null) data.durationDays = extracted.duration_days;

  if (Object.keys(data).length === 0) return null;

  return prisma.qualification.update({
    where: { leadId },
    data
  });
}
