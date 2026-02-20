import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function extractLeadFields({ text, known }) {
  // known: lo que ya sabes del lead (name ya guardado, altura ya guardada, etc.)
  // Regla: si no está en el texto, debe regresar null. NO inventar.
  const instructions = `
Eres un extractor de requisitos para renta de plataformas elevadoras (TSC Industrial).
Devuelve SOLO JSON válido (sin markdown, sin explicación).

Reglas:
- No inventes datos. Si no está explícito, usa null.
- Si el usuario escribe su nombre dentro de una frase, extráelo.
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
      missing: {
        type: "array",
        items: { type: "string" }
      }
    },
    required: ["name", "height_m", "type", "activity", "terrain", "city", "duration_days", "confidence", "missing"]
  };

  const input = [
    { role: "user", content: `KNOWN (JSON): ${JSON.stringify(known || {})}\nUSER_TEXT: ${text}` }
  ];

  const resp = await client.responses.create({
    model: "gpt-4o-mini",
    instructions,
    input,
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "lead_extractor",
        schema,
        strict: true
      }
    }
  });

  // SDK expone texto final como output_text en ejemplos oficiales :contentReference[oaicite:2]{index=2}
  const jsonText = resp.output_text;
  return JSON.parse(jsonText);
}
