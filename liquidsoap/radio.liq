# ── Radio IA · Hito 1 · radio.liq ─────────────────────────────────
# Solo música: reproduce la carpeta /music en loop y la transmite
# a Icecast en MP3 128 kbps. Todavía sin IA.
# Sintaxis de Liquidsoap 2.x.
# ──────────────────────────────────────────────────────────────────

# Logs a stdout para verlos con:  docker compose logs -f liquidsoap
settings.log.stdout.set(true)
settings.log.level.set(3)

# Fuente de música: toma todos los tracks de /music, los mezcla al
# azar y vigila la carpeta para recargar si agregás/sacás archivos.
music = playlist(
  mode="randomize",
  reload_mode="watch",
  "/music"
)

# Garantiza que la transmisión nunca se corte: si por algún motivo
# no hay audio disponible, emite silencio en lugar de morir.
radio = mksafe(music)

# Salida a Icecast, codificando en MP3.
output.icecast(
  %mp3(bitrate=128),
  host="icecast",              # nombre del servicio en docker-compose
  port=8000,
  password="fierros_source",   # debe coincidir con ICECAST_SOURCE_PASSWORD
  mount="radio.mp3",
  name="Radio IA",
  description="Radio autónoma con locutores IA — Hito 1",
  genre="Varied",
  radio
)
