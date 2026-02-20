// src/flow.js

// Extrae nombre de frases comunes: "soy Sergio", "me llamo Sergio", "sergio"
export function extractNameFromText(text) {
  if (!text) return null;
  const t = text.trim();

  // Si el usuario escribe solo 1-3 palabras, lo tomamos como nombre (controlado)
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length >= 1 && words.length <= 3) {
    // Evita cosas obvias que no son nombre
    const blacklist = new Set(["hola", "buenas", "ok", "si", "no", "gracias"]);
    const first = words[0].toLowerCase();
    if (!blacklist.has(first)) return words.join(" ");
  }

  // "Soy X"
  let m = t.match(/^(soy|me llamo|mi nombre es)\s+(.{2,40})$/i);
  if (m && m[2]) return m[2].trim();

  return null;
}

export function decideNextReply({ leadName, incomingText, conversationState }) {
  // 1) Si no hay nombre, pedirlo y tratar de extraerlo
  if (!leadName) {
    const maybeName = extractNameFromText(incomingText);
    if (maybeName) {
      return {
        action: "SAVE_NAME_AND_ADVANCE",
        name: maybeName,
        nextState: "TECH_QUALIFICATION",
        reply: `Gracias, ${maybeName}. Para confirmar compatibilidad rápido: ¿qué altura necesitas alcanzar? (en metros o pies)`
      };
    }

    return {
      action: "ASK_NAME",
      nextState: "ASK_NAME",
      reply: "Hola 👋 Soy VEXIQO de TSC Industrial. ¿Me compartes tu nombre para apoyarte mejor?"
    };
  }

  // 2) Si ya hay nombre, empezamos calificación técnica (por ahora solo altura)
  if (conversationState === "INIT" || conversationState === "ASK_NAME") {
    return {
      action: "ASK_HEIGHT",
      nextState: "TECH_QUALIFICATION",
      reply: `Gracias, ${leadName}. Para confirmar compatibilidad rápido: ¿qué altura necesitas alcanzar? (en metros o pies)`
    };
  }

  // 3) Fallback (temporal): seguimos eco mientras construimos el resto del motor
  return {
    action: "ECHO",
    nextState: conversationState || "TECH_QUALIFICATION",
    reply: `Perfecto, ${leadName}. Recibí: "${incomingText}"`
  };
}
