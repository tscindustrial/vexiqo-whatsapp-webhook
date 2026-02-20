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



  
}
