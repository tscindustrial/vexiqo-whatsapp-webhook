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

  return prisma.qualification.create({
    data: { companyId, leadId }
  });
}

export async function updateQualificationHeight(leadId, heightMeters, heightFeet) {
  return prisma.qualification.update({
    where: { leadId },
    data: {
      heightMeters: heightMeters ?? null,
      heightFeet: heightFeet ?? null
    }
  });
}
export async function updateQualificationFromExtract(leadId, extracted) {
  const data = {};

  if (extracted.height_m != null) data.heightMeters = extracted.height_m;
  if (extracted.type) data.liftType = extracted.type;
  if (extracted.activity) data.activity = extracted.activity;
  if (extracted.terrain) data.terrain = extracted.terrain;
  if (extracted.city) data.city = extracted.city;
  if (extracted.duration_days != null) data.durationDays = extracted.duration_days;

  // Si no hay nada que actualizar, evita query
  if (Object.keys(data).length === 0) return null;

  return prisma.qualification.update({
    where: { leadId },
    data
  });
}
export async function getQualification(leadId) {
  return prisma.qualification.findUnique({ where: { leadId } });
}
export async function patchQualificationFromExtract(leadId, extracted) {
  const data = {};

  if (extracted.height_m != null) data.heightMeters = extracted.height_m;
  if (extracted.type) data.liftType = extracted.type;
  if (extracted.activity) data.activity = extracted.activity;
  if (extracted.terrain) data.terrain = extracted.terrain;
  if (extracted.city) data.city = extracted.city;
  if (extracted.duration_days != null) data.durationDays = extracted.duration_days;

  if (Object.keys(data).length === 0) return null;

  return prisma.qualification.update({
    where: { leadId },
    data
  });
}
