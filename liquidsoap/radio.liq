# ── Radio IA · radio.liq ──────────────────────────────────────────
# Música + locución de Dora, con transición inteligente:
# crossfade entre temas; corte limpio al entrar o salir la voz.
# Liquidsoap 2.3.x
# ──────────────────────────────────────────────────────────────────
settings.log.stdout.set(true)
settings.log.level.set(3)

music = playlist(
  mode="randomize",
  reload_mode="watch",
  "/music"
)

# La voz va etiquetada con type="voz" para reconocerla en la transición.
speech = amplify(4.0, single('annotate:type="voz":/output/locucion_test.mp3'))

# Una canción, una locución, una canción...
radio = rotate(weights=[1, 1], [music, speech])

# Transición a medida:
# - entre dos temas de música: crossfade normal.
# - si entra o sale la voz: corte limpio (sequence), sin fundido,
#   para no comerle el saludo del principio ni el remate del final.
def transicion(old, new) =
  if old.metadata["type"] == "voz" or new.metadata["type"] == "voz" then
    sequence([old.source, new.source])
  else
    cross.simple(old, new)
  end
end
radio = cross(duration=2., transicion, radio)

# Limitador de seguridad (techo a -1 dB).
radio = limit(threshold=-1.0, radio)

# Red de seguridad: silencio si algo falla.
radio = mksafe(radio)

output.icecast(
  %mp3(bitrate=128),
  host="icecast",
  port=8000,
  password="fierros_source",
  mount="radio.mp3",
  name="Radio IA",
  description="Radio autónoma con locutores IA",
  genre="Varied",
  radio
)