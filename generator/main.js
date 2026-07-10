// generator/main.js
// Corre en loop: Gemini escribe un diálogo entre Dora y Cacho (matrimonio),
// Kokoro pone cada voz, y se pegan en un solo WAV. Liquidsoap lo levanta solo.
// Las personalidades viven en GUION_PROMPT.

const { writeFile, rename } = require("node:fs/promises");
const path = require("node:path");

// --- Configuración -------------------------------------------------
const KOKORO_URL = "http://kokoro:8880/v1/audio/speech";
const OUT_DIR = path.join(__dirname, "..", "output");
const OUTPUT_PATH = path.join(OUT_DIR, "locucion.wav");
const TMP_PATH = path.join(OUT_DIR, ".locucion.tmp.wav");
const GEMINI_MODEL = "gemini-2.5-flash-lite";
const INTERVALO_MS = 10 * 60 * 1000; // cada 10 minutos, alineado a cada 3 temas
const NEWS_FEED_URL =
   "https://news.google.com/rss/search?q=Cordoba+Argentina&hl=es-419&gl=AR&ceid=AR:es-419";

const CIUDAD = "General Deheza";
const LAT = -32.7558;
const LON = -63.7822;
const TZ = "America/Argentina/Cordoba";

const VOCES = { DORA: "ef_dora", CACHO: "em_alex" };
const PAUSA = 0.45; // segundos de silencio entre intervenciones

const CLIMA_CADA_MS = 60 * 60 * 1000; // el clima, a lo sumo una vez por hora
let ultimoClimaMs = 0; // última vez que se mencionó el clima

// --- Las personalidades (acá se ajustan los personajes) ------------
const GUION_PROMPT = `
Escribís el guion de una pequeña radio de ${CIUDAD}, un pueblo de la provincia de Córdoba, Argentina, conducida por un matrimonio: Dora y Cacho.

DORA: una señora de pueblo, chusma y verborrágica, con una opinión sobre absolutamente todo. Se entusiasma, exagera, se va por las ramas, es un poco delirante y graciosa casi sin querer. Es la que lleva la conducción.

CACHO: el marido de Dora. Tan chusma como ella: se enganchan y exageran juntos, se dan manija. Pero tiene un sello propio: cada tanto suelta un chiste malísimo, de esos de tío (juegos de palabras bobos, ocurrencias que le causan mucha gracia a él). Dora los sufre ("ay, este hombre"), pone los ojos en blanco, pero lo quiere y termina riéndose igual.

Escribís un diálogo cortito entre los dos, presentando la hora y el clima (y a veces una noticia) a su manera: chusmeando, opinando, y con alguna ocurrencia de Cacho.

Reglas que NUNCA rompés:
- El diálogo tiene entre 4 y 6 intervenciones en total, cortas (una o dos frases cada una). No se eterniza.
- Cada intervención va en su propia línea, empezando con "DORA:" o "CACHO:". Nada más: sin acotaciones, sin describir tonos, sin paréntesis.
- Empieza y termina Dora (ella conduce).
- SIEMPRE se dice la hora. El clima y la noticia se mencionan SOLO si figuran en los datos de abajo; si no están, no se los inventa ni se los nombra. Los datos son sagrados: no inventan ningún dato extra, ni siquiera para comparar o dar contexto.
- No escriben risas ni interjecciones sueltas para leer ("ja", "je", "jaja"): un TTS las lee literales y suena mal. La gracia va en lo que dicen, no en risas escritas.
- La hora se dice aproximada ("cerca de las cuatro", "las tres y media pasadas"), nunca exacta al minuto.
- No todos los chistes de Cacho tienen que ser puns perfectos: alcanza con la energía de chiste malo. Si no sale uno bueno, mejor una ocurrencia boba que un pun forzado.
- Hablan en español rioplatense, con voseo, natural y de pueblo.
- Son dos personas de verdad. No saben que son inteligencias artificiales y JAMÁS lo mencionan.
- TEXTO PLANO: sin asteriscos, sin Markdown, sin emojis; los números escritos como se dicen ("nueve grados"), no en cifra.
- Si la noticia es sobre una tragedia o algo doloroso, no hacen chistes ni la trivializan: la comentan con respeto, aunque sigan siendo ellos.
- Varían cada vez: no arrancan siempre igual.

Devolvés SOLO el diálogo con las etiquetas DORA: y CACHO:, nada más.
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

// --- Noticias (RSS Google News Córdoba, sin key) -------------------
function decodeEntities(s) {
   return s
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");
}

async function getNoticias() {
   const res = await fetch(NEWS_FEED_URL);
   if (!res.ok) throw new Error(`RSS respondió ${res.status}`);
   const xml = await res.text();
   const items = xml.match(/<item>[\s\S]*?<\/item>/g) ?? [];
   const titulares = items
      .slice(0, 6)
      .map((it) => {
         const m = it.match(/<title>([\s\S]*?)<\/title>/);
         let t = m ? m[1] : "";
         t = t.replace(/^<!\[CDATA\[/, "").replace(/\]\]>$/, "");
         t = decodeEntities(t)
            .replace(/\s+-\s+[^-]+$/, "")
            .trim();
         return t;
      })
      .filter(Boolean);
   if (titulares.length === 0) throw new Error("Sin titulares en el feed");
   return titulares;
}

// --- Guion en diálogo (Gemini) -------------------------------------
async function getGuion(hora, clima, noticia) {
   const KEY = process.env.GEMINI_API_KEY;
   if (!KEY) throw new Error("Falta GEMINI_API_KEY (¿creaste el .env?)");

   const datos = [
      `- Hora: ${hora}`,
      clima
         ? `- Temperatura: ${clima.temp} grados`
         : "- Temperatura: (no disponible)",
      clima ? `- Clima: ${clima.desc}` : "- Clima: (no disponible)",
   ];
   if (noticia) datos.push(`- Titular de noticia para comentar: "${noticia}"`);

   const userMsg = `Datos de este momento en ${CIUDAD}:\n${datos.join("\n")}\n\nEscribí el diálogo de Dora y Cacho para este momento.`;

   const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
   const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": KEY },
      body: JSON.stringify({
         systemInstruction: { parts: [{ text: GUION_PROMPT }] },
         contents: [{ role: "user", parts: [{ text: userMsg }] }],
         generationConfig: {
            temperature: 1.2,
            maxOutputTokens: 500,
            thinkingConfig: { thinkingBudget: 0 },
         },
      }),
   });
   if (!res.ok)
      throw new Error(`Gemini respondió ${res.status}: ${await res.text()}`);

   const data = await res.json();
   const texto = (data.candidates?.[0]?.content?.parts ?? [])
      .map((p) => p.text)
      .filter(Boolean)
      .join("")
      .trim();
   if (!texto) throw new Error("Gemini devolvió vacío");
   return texto;
}

// Convierte el diálogo etiquetado en una lista de { voice, text }.
function parseDialogo(texto) {
   const turnos = [];
   for (const linea of texto.split("\n")) {
      const m = linea.match(/^\s*(DORA|CACHO)\s*:\s*(.+)$/i);
      if (!m) continue;
      const dicho = m[2].replace(/[*_#\`]/g, "").trim();
      if (dicho) turnos.push({ voice: VOCES[m[1].toUpperCase()], text: dicho });
   }
   return turnos;
}

// --- Junta datos y arma la lista de turnos (con fallback) ----------
async function armarDialogo() {
   const hora = getHoraTexto();

   // Clima: a lo sumo una vez por hora, si no lo repiten demasiado.
   let clima = null;
   if (Date.now() - ultimoClimaMs >= CLIMA_CADA_MS) {
      try {
         clima = await getClima();
         ultimoClimaMs = Date.now();
      } catch (e) {
         console.warn("  Clima no disponible:", e.message);
      }
   }

   // Noticia: casi siempre que hablan, si hay alguna disponible.
   let noticia = null;
   try {
      const titulares = await getNoticias();
      noticia = titulares[Math.floor(Math.random() * titulares.length)];
   } catch (e) {
      console.warn("  Noticias no disponibles:", e.message);
   }

   try {
      const texto = await getGuion(hora, clima, noticia);
      const turnos = parseDialogo(texto);
      if (turnos.length === 0) throw new Error("No se pudo parsear el diálogo");
      return turnos;
   } catch (e) {
      console.warn("  Gemini falló, uso plantilla (solo Dora):", e.message);
      const climaTxt = clima ? `, ${clima.temp} grados y ${clima.desc}` : "";
      return [
         {
            voice: "ef_dora",
            text: `${hora}${climaTxt}. Volvemos con más música.`,
         },
      ];
   }
}

// --- WAV: parseo, silencio y armado (Node puro, sin librerías) -----
function parseWav(buf) {
   let offset = 12; // salto "RIFF" + size + "WAVE"
   let fmt = null,
      pcm = null;
   while (offset + 8 <= buf.length) {
      const id = buf.toString("ascii", offset, offset + 4);
      const size = buf.readUInt32LE(offset + 4);
      const start = offset + 8;
      if (id === "fmt ") {
         fmt = {
            channels: buf.readUInt16LE(start + 2),
            sampleRate: buf.readUInt32LE(start + 4),
            bitsPerSample: buf.readUInt16LE(start + 14),
         };
      } else if (id === "data") {
         pcm = buf.subarray(start, start + size);
      }
      offset = start + size + (size % 2); // padding a byte par
   }
   if (!fmt || !pcm) throw new Error("WAV inesperado de Kokoro");
   return { ...fmt, pcm };
}

function silencio(segundos, fmt) {
   const muestras = Math.round(segundos * fmt.sampleRate);
   return Buffer.alloc(muestras * fmt.channels * (fmt.bitsPerSample / 8));
}

function buildWav(fmt, pcm) {
   const { channels, sampleRate, bitsPerSample } = fmt;
   const blockAlign = channels * (bitsPerSample / 8);
   const byteRate = sampleRate * blockAlign;
   const h = Buffer.alloc(44);
   h.write("RIFF", 0, "ascii");
   h.writeUInt32LE(36 + pcm.length, 4);
   h.write("WAVE", 8, "ascii");
   h.write("fmt ", 12, "ascii");
   h.writeUInt32LE(16, 16);
   h.writeUInt16LE(1, 20); // PCM
   h.writeUInt16LE(channels, 22);
   h.writeUInt32LE(sampleRate, 24);
   h.writeUInt32LE(byteRate, 28);
   h.writeUInt16LE(blockAlign, 32);
   h.writeUInt16LE(bitsPerSample, 34);
   h.write("data", 36, "ascii");
   h.writeUInt32LE(pcm.length, 40);
   return Buffer.concat([h, pcm]);
}

// --- Sintetiza una línea con Kokoro (formato WAV) ------------------
async function sintetizarLinea(texto, voice) {
   const res = await fetch(KOKORO_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
         model: "kokoro",
         input: texto,
         voice,
         response_format: "wav",
         speed: 1.0,
      }),
   });
   if (!res.ok) throw new Error(`Kokoro (${voice}) respondió ${res.status}`);
   return parseWav(Buffer.from(await res.arrayBuffer()));
}

// --- Sintetiza todo el diálogo y pega los clips en un WAV ----------
async function generarVozDialogo(turnos) {
   const wavs = [];
   for (const t of turnos) {
      wavs.push(await sintetizarLinea(t.text, t.voice));
   }
   const fmt = {
      channels: wavs[0].channels,
      sampleRate: wavs[0].sampleRate,
      bitsPerSample: wavs[0].bitsPerSample,
   };
   const partes = [silencio(0.15, fmt)]; // pequeño respiro inicial
   wavs.forEach((w, i) => {
      if (i > 0) partes.push(silencio(PAUSA, fmt));
      partes.push(w.pcm);
   });
   partes.push(silencio(0.3, fmt)); // respiro final

   const wavFinal = buildWav(fmt, Buffer.concat(partes));
   await writeFile(TMP_PATH, wavFinal);
   await rename(TMP_PATH, OUTPUT_PATH);
   return wavFinal.length;
}

// --- Una vuelta completa -------------------------------------------
async function generarUna() {
   const turnos = await armarDialogo();
   console.log(new Date().toLocaleTimeString("es-AR"), "Guion:");
   for (const t of turnos) {
      console.log(`  ${t.voice === "ef_dora" ? "DORA " : "CACHO"}: ${t.text}`);
   }
   const bytes = await generarVozDialogo(turnos);
   console.log(`  OK: ${bytes} bytes -> output/locucion.wav`);
}

// --- Loop infinito -------------------------------------------------
async function main() {
   console.log(
      `Generador Dora + Cacho en marcha. Regenera cada ${INTERVALO_MS / 60000} min.`,
   );
   while (true) {
      try {
         await generarUna();
      } catch (e) {
         console.error("  Falló esta vuelta (sigo igual):", e.message);
      }
      await new Promise((r) => setTimeout(r, INTERVALO_MS));
   }
}

main();
