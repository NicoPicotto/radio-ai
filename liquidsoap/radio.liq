# ── Radio IA · Hito 2 · radio.liq ─────────────────────────────────
# Música + locución pregrabada, alternando una y una, con crossfade.
# Sintaxis de Liquidsoap 2.3.x.
# ──────────────────────────────────────────────────────────────────
settings.log.stdout.set(true)
settings.log.level.set(3)

# Música: igual que en el Hito 1.
music = playlist(
  mode="randomize",
  reload_mode="watch",
  "/music"
)

# Locución de prueba: un único clip fijo que se repite.
# Más adelante esto lo va a reemplazar la voz generada por IA.
speech = amplify(4.0, single("/output/locucion_test.mp3"))

# Alternar: una canción, una locución, una canción, una locución...
# weights=[1,1] = un track de cada fuente por turno.
# El orden [music, speech] hace que arranque con una canción.
radio = rotate(weights=[1, 1], [music, speech])

# Transición suave para que no haya cortes secos entre track y track.
radio = crossfade(duration=2., radio)

# Limitador de seguridad: techo a -1 dB. Deja subir el volumen sin que distorsione.
radio = limit(threshold=-1.0, radio)

radio = mksafe(radio)

# Red de seguridad: si algo falla, silencio en vez de morir.
radio = mksafe(radio)

output.icecast(
  %mp3(bitrate=128),
  host="icecast",
  port=8000,
  password="fierros_source",
  mount="radio.mp3",
  name="Radio IA",
  description="Radio autónoma con locutores IA — Hito 2",
  genre="Varied",
  radio
)