// generator/main.js
// Corre en loop: cada pocos minutos, Dora escribe una locución nueva
// (hora + clima reales) y Kokoro la convierte en voz. Liquidsoap la
// levanta sola. La personalidad vive en DORA_PROMPT.

const { writeFile, rename } = require("node:fs/promises");
const path = require("node:path");

// --- Configuración -------------------------------------------------
const KOKORO_URL = "http://localhost:8880/v1/audio/speech";
const OUT_DIR = path.join(__dirname, "..", "output");
const OUTPUT_PATH = path.join(OUT_DIR, "locucion.mp3");
const TMP_PATH = path.join(OUT_DIR, ".locucion.tmp.mp3");
const GEMINI_MODEL = "gemini-2.5-flash";
const INTERVALO_MS = 3 * 60 * 1000; // regenera cada 3 minutos
const NEWS_FEED_URL =
   "https://news.google.com/rss/search?q=Cordoba+Argentina&hl=es-419&gl=AR&ceid=AR:es-419";

const CIUDAD = "General Deheza";
const LAT = -32.7558;
const LON = -63.7822;
const TZ = "America/Argentina/Cordoba";

// --- La personalidad de Dora (acá se ajusta el personaje) ----------
const DORA_PROMPT = `
Sos Dora, la locutora de una pequeña radio de ${CIUDAD}, un pueblo de la provincia de Córdoba, Argentina.

Quién sos: una señora de pueblo, chusma y verborrágica, con una opinión sobre absolutamente todo. Te entusiasmás, exagerás, te vas por las ramas y sos un poco delirante, graciosa casi sin querer. Hablás como la vecina que se cree con autoridad para comentar cualquier cosa.

Tu trabajo: presentar la hora y el clima que te paso, pero a TU manera: envolviéndolos en tu opinión, tu chisme y tu delirio. El dato tiene que estar siempre, pero la gracia está en cómo lo decís.

Reglas que NUNCA rompés:
- Escribís entre 3 y 4 frases. Verborrágica, pero no infinita.
- Hablás en español rioplatense, con voseo, natural y de pueblo. Nada de lunfardo tan cerrado que no se entienda.
- SIEMPRE mencionás la hora y el clima que te doy. Podés opinar todo lo que quieras, pero los datos son sagrados: no inventás temperaturas, ni lugares, ni gente, ni noticias.
- La hora que te paso puede tener unos minutos de atraso para cuando salga al aire, así que decila SIEMPRE aproximada ("cerca de las cuatro", "las tres y media pasadas"), nunca exacta al minuto.
- Sos una señora de verdad. No sabés que sos una inteligencia artificial y JAMÁS lo mencionás ni rompés el personaje.
- Escribís TEXTO PLANO para leer en voz alta: sin asteriscos, sin Markdown, sin emojis, sin acotaciones entre paréntesis. Los números escritos como se dicen ("nueve grados"), no como cifras.
- Variás cada vez: no arranques siempre igual ni repitas las mismas frases.
- A veces te paso un titular de noticia real para comentar. Cuando lo tengas, opinás sobre ese titular con tu estilo (te indignás, chusmeás, te sorprendés), pero SIEMPRE ateniéndote a lo que dice: no agregás datos ni detalles que no estén en el titular. Cuando no te paso noticia, hablás solo de la hora y el clima.
- Si el titular es sobre una tragedia, un accidente o algo doloroso, NO hacés chistes ni lo trivializás: lo comentás con respeto y sensibilidad, aunque sigas siendo vos.

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

   const userMsg = `Datos de este momento en ${CIUDAD}:\n${datos.join("\n")}\n\nEscribí lo que diría Dora al aire ahora mismo.`;

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
      console.warn("  Clima no disponible:", e.message);
   }

   // La mitad de las veces Dora comenta una noticia; la otra mitad, solo hora y clima.
   let noticia = null;
   if (Math.random() < 0.5) {
      try {
         const titulares = await getNoticias();
         noticia = titulares[Math.floor(Math.random() * titulares.length)];
      } catch (e) {
         console.warn("  Noticias no disponibles:", e.message);
      }
   }

   try {
      return await getGuion(hora, clima, noticia);
   } catch (e) {
      console.warn("  Gemini no disponible, uso plantilla:", e.message);
      const climaTxt = clima ? `, ${clima.temp} grados y ${clima.desc}` : "";
      return `${hora}${climaTxt}. Volvemos con más música.`;
   }
}

// --- Voz (Kokoro), con escritura atómica ---------------------------
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
   // Escribimos a un temporal y renombramos: así Liquidsoap nunca
   // lee un archivo a medio escribir (el rename es atómico).
   await writeFile(TMP_PATH, audio);
   await rename(TMP_PATH, OUTPUT_PATH);
   return audio.length;
}

// --- Una vuelta completa -------------------------------------------
async function generarUna() {
   const texto = await armarTexto();
   console.log(new Date().toLocaleTimeString("es-AR"), "Dora dice:", texto);
   const bytes = await generarVoz(texto);
   console.log(`  OK: ${bytes} bytes -> output/locucion.mp3`);
}

// --- Loop infinito: regenera cada INTERVALO_MS ---------------------
async function main() {
   console.log(
      `Generador de Dora en marcha. Regenera cada ${INTERVALO_MS / 60000} min.`,
   );
   while (true) {
      try {
         await generarUna();
      } catch (e) {
         // Una falla no mata el loop: queda la locución anterior sonando.
         console.error("  Falló esta vuelta (sigo igual):", e.message);
      }
      await new Promise((r) => setTimeout(r, INTERVALO_MS));
   }
}

// Decodifica las entidades HTML más comunes de los titulares.
function decodeEntities(s) {
   return s
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");
}

// Trae unos titulares del feed RSS. Sin librerías: extrae los <title> a mano.
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
         t = t.replace(/^<!\[CDATA\[/, "").replace(/\]\]>$/, ""); // por si viene en CDATA
         t = decodeEntities(t)
            .replace(/\s+-\s+[^-]+$/, "")
            .trim(); // saco el " - Fuente" del final
         return t;
      })
      .filter(Boolean);
   if (titulares.length === 0) throw new Error("Sin titulares en el feed");
   return titulares;
}

main();
