// scripts/fetch-music.js
// Baja temas Creative Commons de Jamendo a music/ y registra los créditos
// (para respetar la atribución de las licencias CC). Sin dependencias.
//
// Requiere un client_id gratis (https://developer.jamendo.com/) en el .env:
//   JAMENDO_CLIENT_ID=tu-client-id
// Correr con:  node --env-file=.env scripts/fetch-music.js

const { writeFile, readFile, mkdir, access } = require("node:fs/promises");
const path = require("node:path");

// --- Configuración (ajustá a gusto) --------------------------------
const CANTIDAD = 300; // cuántos temas bajar
const TAGS = "jazz"; // género: "rock", "jazz", "electronic", "folk", "cumbia"...
const ORDER = "popularity_total"; // populares primero
const MUSIC_DIR = path.join(__dirname, "..", "music");
const CREDITOS_PATH = path.join(__dirname, "..", "creditos-musica.json");
const API = "https://api.jamendo.com/v3.0/tracks";
const CLIENT_ID = process.env.JAMENDO_CLIENT_ID;

function sanitizar(nombre) {
   return nombre
      .replace(/[^a-z0-9]+/gi, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 60);
}

async function existe(p) {
   try {
      await access(p);
      return true;
   } catch {
      return false;
   }
}

async function traerPagina(offset, limit) {
   const params = new URLSearchParams({
      client_id: CLIENT_ID,
      format: "json",
      limit: String(limit),
      offset: String(offset),
      order: ORDER,
      audiodownload_allowed: "true",
      tags: TAGS,
   });
   const res = await fetch(`${API}/?${params}`);
   if (!res.ok) throw new Error(`Jamendo respondió ${res.status}`);
   const data = await res.json();
   if (data.headers?.status !== "success") {
      throw new Error(
         `Jamendo error: ${data.headers?.error_message || "desconocido"}`,
      );
   }
   return data.results ?? [];
}

async function descargar(track) {
   const nombreArchivo = `${track.id}_${sanitizar(track.name)}.mp3`;
   const destino = path.join(MUSIC_DIR, nombreArchivo);
   if (await existe(destino)) return { nombreArchivo, saltado: true };
   const res = await fetch(track.audiodownload);
   if (!res.ok) throw new Error(`descarga falló (${res.status})`);
   await writeFile(destino, Buffer.from(await res.arrayBuffer()));
   return { nombreArchivo, saltado: false };
}

async function cargarCreditos() {
   try {
      return JSON.parse(await readFile(CREDITOS_PATH, "utf8"));
   } catch {
      return {};
   }
}

async function main() {
   if (!CLIENT_ID) throw new Error("Falta JAMENDO_CLIENT_ID en el .env");
   await mkdir(MUSIC_DIR, { recursive: true });
   const creditos = await cargarCreditos();

   let bajados = 0,
      saltados = 0,
      offset = 0;
   const LIMITE_API = 200; // máximo por pedido

   while (bajados + saltados < CANTIDAD) {
      const faltan = CANTIDAD - (bajados + saltados);
      const pagina = await traerPagina(offset, Math.min(LIMITE_API, faltan));
      if (pagina.length === 0) {
         console.log("No hay más temas para este filtro.");
         break;
      }

      for (const track of pagina) {
         try {
            const { nombreArchivo, saltado } = await descargar(track);
            creditos[track.id] = {
               archivo: nombreArchivo,
               titulo: track.name,
               artista: track.artist_name,
               licencia: track.license_ccurl,
               url: track.shareurl,
            };
            if (saltado) saltados++;
            else {
               bajados++;
               console.log(
                  `  ${bajados}. ${track.artist_name} - ${track.name}`,
               );
            }
         } catch (e) {
            console.warn(`  saltado (${track.name}): ${e.message}`);
         }
         await new Promise((r) => setTimeout(r, 200)); // pausa cortés
      }
      offset += pagina.length;
   }

   await writeFile(CREDITOS_PATH, JSON.stringify(creditos, null, 2));
   console.log(
      `\nListo: ${bajados} nuevos, ${saltados} ya estaban. Créditos en creditos-musica.json`,
   );
}

main().catch((e) => {
   console.error("Error:", e.message);
   process.exit(1);
});
