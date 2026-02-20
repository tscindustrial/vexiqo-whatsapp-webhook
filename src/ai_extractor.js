import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function extractLeadFields({ text, known }) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("Missing OPENAI_API_KEY");
  }

  const instructions = `
Eres un extractor de requisitos para renta de plataformas elevadoras (TSC Industrial).
Devuelve SOLO JSON válido.

Reglas:
- No inventes datos. Si no está explícito, usa null.
- Extrae nombre aunque venga dentro de una frase (ej: "me llamo Sergio").
- Normaliza:
  - height_m: número en metros (float) o null
  - type: "BRAZO" | "TIJERA" | null
  - activity: "PINTURA" | "GENERAL" | null
  - terrain: "PISO_FIRME" | "TERRACERIA" | null
  - city: string o null
  - duration_days: entero o null
- confidence: 0..1
- missing: array con campos faltantes clave
`;

  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      name: { type: ["string", "null"] },
      height_m: { type: ["number", "null"] },
      type: { type: ["string", "null"], enum: ["BRAZO", "TIJERA", null] },
      activity: { type: ["string", "null"], enum: ["PINTURA", "GENERAL", null] },
      terrain: { type: ["string", "null"], enum: ["PISO_FIRME", "TERRACERIA", null] },
      city: { type: ["string", "null"] },
      duration_days: { type: ["integer", "null"] },
      confidence: { type: "number" },
      missing: { type: "array", items: { type: "string" } }
    },
    required: [
      "name",
      "height_m",
      "type",
      "activity",
      "terrain",
      "city",
      "duration_days",
      "confidence",
      "missing"
    ]
  };

  const resp = await client.responses.create({
    model: "gpt-4o-mini",
    instructions,
    input: [
      {
        role: "user",
        content: `KNOWN (JSON): ${JSON.stringify(known || {})}\nUSER_TEXT: ${text}`
      }
    ],
    // ✅ ASÍ SE HACE EN RESPONSES API:
    text: {
      format: {
        type: "json_schema",
        name: "lead_extractor",
        strict: true,
        schema
      }
    }
  });

  const jsonText = resp.output_text;
  return JSON.parse(jsonText);
}
