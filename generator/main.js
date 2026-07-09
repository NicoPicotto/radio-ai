// generator/main.js
// Dora (LLM) escribe el guion a partir de la hora y el clima reales,
// y Kokoro lo convierte en voz. La personalidad vive en DORA_PROMPT.

const { writeFile } = require("node:fs/promises");
const path = require("node:path");

// --- Configuración -------------------------------------------------
const KOKORO_URL = "http://localhost:8880/v1/audio/speech";
const OUTPUT_PATH = path.join(__dirname, "..", "output", "locucion_test.mp3");
const GEMINI_MODEL = "gemini-2.5-flash";

const CIUDAD = "General Deheza";
const LAT = -32.7558;
const LON = -63.7822;
const TZ = "America/Argentina/Cordoba";

// --- La personalidad de Dora (acá se ajusta todo el personaje) ------
const DORA_PROMPT = `
Sos Dora, la locutora de una pequeña radio de ${CIUDAD}, un pueblo de la provincia de Córdoba, Argentina.

Quién sos: una señora de pueblo, chusma y verborrágica, con una opinión sobre absolutamente todo. Te entusiasmás, exagerás, te vas por las ramas y sos un poco delirante, graciosa casi sin querer. Hablás como la vecina que se cree con autoridad para comentar cualquier cosa.

Tu trabajo: presentar la hora y el clima que te paso, pero a TU manera: envolviéndolos en tu opinión, tu chisme y tu delirio. El dato tiene que estar siempre, pero la gracia está en cómo lo decís.

Reglas que NUNCA rompés:
- Escribís entre 3 y 4 frases. Verborrágica, pero no infinita.
- Hablás en español rioplatense, con voseo, natural y de pueblo. Nada de lunfardo tan cerrado que no se entienda.
- SIEMPRE mencionás la hora y el clima que te doy. Podés opinar todo lo que quieras, pero los datos son sagrados: no inventás temperaturas, ni lugares, ni gente, ni noticias.
- Sos una señora de verdad. No sabés que sos una inteligencia artificial y JAMÁS lo mencionás ni rompés el personaje.
- Escribís TEXTO PLANO para leer en voz alta: sin asteriscos, sin Markdown, sin emojis, sin acotaciones entre paréntesis como "(risas)". Los números y la hora, escritos como se dicen ("nueve grados", "las cuatro menos veinte"), no como cifras.
- Variás cada vez: no arranques siempre igual ni repitas las mismas frases.

Devolvés SOLO lo que Dora dice al aire, nada más.
`;

// --- Clima (Open-Meteo, sin API key) -------------------------------
const CLIMA_WMO = {
   0: "cielo despejado",
   1: "mayormente despejado",
   2: "parcialmente nublado",
   3: "nublado",
   45: "niebla",
   48: "niebla",
   51: "llovizna leve",
   53: "llovizna",
   55: "llovizna intensa",
   61: "lluvia leve",
   63: "lluvia",
   65: "lluvia intensa",
   71: "nieve leve",
   73: "nieve",
   75: "nieve intensa",
   80: "chaparrones",
   81: "chaparrones",
   82: "chaparrones fuertes",
   95: "tormenta",
   96: "tormenta con granizo",
   99: "tormenta con granizo",
};

async function getClima() {
   const url = `https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LON}&current=temperature_2m,weather_code&timezone=auto`;
   const res = await fetch(url);
   if (!res.ok) throw new Error(`Open-Meteo respondió ${res.status}`);
   const data = await res.json();
   return {
      temp: Math.round(data.current.temperature_2m),
      desc: CLIMA_WMO[data.current.weather_code] ?? "clima variable",
   };
}

// --- Hora en palabras ----------------------------------------------
function getHoraTexto() {
   const partes = new Intl.DateTimeFormat("es-AR", {
      timeZone: TZ,
      hour: "numeric",
      minute: "numeric",
      hour12: false,
   }).formatToParts(new Date());
   const hora = Number(partes.find((p) => p.type === "hour").value);
   const min = Number(partes.find((p) => p.type === "minute").value);

   let franja;
   if (hora < 6) franja = "madrugada";
   else if (hora < 12) franja = "mañana";
   else if (hora < 20) franja = "tarde";
   else franja = "noche";

   let h12 = hora % 12;
   if (h12 === 0) h12 = 12;

   let base = h12 === 1 ? "Es la una" : `Son las ${h12}`;
   if (min > 0) base += ` y ${min}`;
   return `${base} de la ${franja}`;
}

// --- Guion (Gemini escribe como Dora) ------------------------------
async function getGuion(hora, clima) {
   const KEY = process.env.GEMINI_API_KEY;
   if (!KEY) throw new Error("Falta GEMINI_API_KEY (¿creaste el .env?)");

   const datos = [
      `- Hora: ${hora}`,
      clima
         ? `- Temperatura: ${clima.temp} grados`
         : "- Temperatura: (no disponible)",
      clima ? `- Clima: ${clima.desc}` : "- Clima: (no disponible)",
   ].join("\n");

   const userMsg = `Datos de este momento en ${CIUDAD}:\n${datos}\n\nEscribí lo que diría Dora al aire ahora mismo.`;

   const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
   const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": KEY },
      body: JSON.stringify({
         systemInstruction: { parts: [{ text: DORA_PROMPT }] },
         contents: [{ role: "user", parts: [{ text: userMsg }] }],
         generationConfig: {
            temperature: 1.2,
            maxOutputTokens: 300,
            thinkingConfig: { thinkingBudget: 0 },
         },
      }),
   });
   if (!res.ok)
      throw new Error(`Gemini respondió ${res.status}: ${await res.text()}`);

   const data = await res.json();
   const raw = (data.candidates?.[0]?.content?.parts ?? [])
      .map((p) => p.text)
      .filter(Boolean)
      .join(" ");
   // Red de seguridad: sacar cualquier símbolo de Markdown que se cuele
   const limpio = raw
      .replace(/[*_#\`]/g, "")
      .replace(/\s+/g, " ")
      .trim();
   if (!limpio) throw new Error("Gemini devolvió vacío");
   return limpio;
}

// --- Arma el texto: Gemini, con fallback a plantilla ---------------
async function armarTexto() {
   const hora = getHoraTexto();
   let clima = null;
   try {
      clima = await getClima();
   } catch (e) {
      console.warn("Clima no disponible:", e.message);
   }

   try {
      return await getGuion(hora, clima);
   } catch (e) {
      // Si Gemini falla, la radio no queda muda: plantilla simple.
      console.warn("Gemini no disponible, uso plantilla:", e.message);
      const climaTxt = clima ? `, ${clima.temp} grados y ${clima.desc}` : "";
      return `${hora}${climaTxt}. Volvemos con más música.`;
   }
}

// --- Voz (Kokoro) --------------------------------------------------
async function generarVoz(texto) {
   const res = await fetch(KOKORO_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
         model: "kokoro",
         input: texto,
         voice: "ef_dora",
         response_format: "mp3",
         speed: 1.0,
      }),
   });
   if (!res.ok)
      throw new Error(`Kokoro respondió ${res.status}: ${await res.text()}`);
   const audio = Buffer.from(await res.arrayBuffer());
   await writeFile(OUTPUT_PATH, audio);
   return audio.length;
}

// --- Orquestación --------------------------------------------------
async function main() {
   const texto = await armarTexto();
   console.log("Dora dice:", texto);
   const bytes = await generarVoz(texto);
   console.log(`OK: ${bytes} bytes -> output/locucion_test.mp3`);
}

main().catch((e) => {
   console.error("Falló la generación:", e.message);
   process.exit(1);
});
