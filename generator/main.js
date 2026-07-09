// generator/main.js
// Arma una locución con la HORA y el CLIMA reales, la manda a Kokoro
// y guarda el audio donde Liquidsoap lo levanta.
// Todavía sin LLM: el texto sale de una plantilla fija (eso viene en el Hito 4).

const { writeFile } = require("node:fs/promises");
const path = require("node:path");

// --- Configuración -------------------------------------------------
const KOKORO_URL = "http://localhost:8880/v1/audio/speech";
const OUTPUT_PATH = path.join(__dirname, "..", "output", "locucion_test.mp3");

// Ubicación que reporta la radio. Cambiá estas líneas por tu ciudad.
// (Estas son las de Córdoba capital.)
const CIUDAD = "General Deheza";
const LAT = -32.7558;
const LON = -63.7822;
const TZ = "America/Argentina/Cordoba";

// --- Clima (Open-Meteo, sin API key) -------------------------------
// Open-Meteo devuelve un CÓDIGO de clima (WMO), no texto. Lo traducimos.
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
   const temp = Math.round(data.current.temperature_2m);
   const desc = CLIMA_WMO[data.current.weather_code] ?? "clima variable";
   return { temp, desc };
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

// --- Texto de la locución (plantilla; después la escribe el LLM) ----
async function armarTexto() {
   const horaTexto = getHoraTexto();
   try {
      const { temp, desc } = await getClima();
      return `${horaTexto}. En ${CIUDAD}, ${temp} grados y ${desc}. Volvemos con más música.`;
   } catch (e) {
      // Si el clima falla, no dejamos a la radio muda: hablamos solo de la hora.
      console.warn("Clima no disponible:", e.message);
      return `${horaTexto}. Volvemos con más música.`;
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
   console.log("Locución:", texto);
   const bytes = await generarVoz(texto);
   console.log(`OK: ${bytes} bytes -> output/locucion_test.mp3`);
}

main().catch((e) => {
   console.error("Falló la generación:", e.message);
   process.exit(1);
});
