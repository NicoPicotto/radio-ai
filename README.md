# Radio IA

Radio online autónoma 24/7 con locutores 100% sintéticos. Pasa música de
licencia libre y, entre canciones, dos "locutores" generados por IA —**Dora**
y **Cacho**— presentan la hora, comentan el clima y opinan de la actualidad,
cada uno con su personalidad. No hay nadie hablando en vivo ni operando la
consola: todo el ciclo —elegir qué decir, escribir el guion, convertirlo en
voz e insertarlo entre temas— corre solo.

Proyecto sin fines comerciales: fines lúdicos y de aprendizaje.

## Los locutores

- **Dora** — una señora de pueblo de General Deheza (Córdoba): chusma,
  verborrágica y con una opinión sobre absolutamente todo. Conduce el
  programa. No sabe que es una IA. _(voz: `ef_dora`)_
- **Cacho** — el marido de Dora. Tan chismoso como ella y se dan manija juntos,
  pero tiene el vicio de tirar chistes malos de tío. Dora los sufre, pero se
  ríe igual. _(voz: `em_alex`)_

## Cómo funciona

El corazón del proyecto es un **generador** que trabaja adelantado a la
transmisión, siempre con una locución fresca lista:

1. Junta el contexto del momento: **hora** local, **clima** (Open-Meteo) y, a
   veces, un **titular** de noticias de Córdoba (Google News RSS).
2. **Gemini** escribe un diálogo corto entre Dora y Cacho con ese contexto.
3. **Kokoro** (TTS) convierte cada intervención en voz, con la voz de cada uno.
4. El generador **pega los clips** en un único `output/locucion.wav`.
5. **Liquidsoap** levanta ese archivo de forma dinámica y lo intercala entre
   canciones, con transiciones limpias.
6. **Icecast** transmite el stream.

Si una fuente falla (el clima, las noticias, el LLM), el sistema degrada con
gracia y la radio nunca queda muda.

## Stack

| Componente        | Herramienta                              |
|-------------------|------------------------------------------|
| Motor de radio    | Liquidsoap `v2.3.2`                      |
| Servidor de stream| Icecast (`libretime/icecast:2.4.4`)     |
| Generador         | Node.js (sin dependencias externas)      |
| Voz (TTS)         | Kokoro (`kokoro-fastapi-cpu`, self-host) |
| Guion (LLM)       | Gemini 2.5 Flash (tier gratis)           |
| Clima             | Open-Meteo (sin API key)                 |
| Noticias          | Google News RSS (sin API key)            |

## Requisitos

- Docker (con `docker compose`).
- Node 20.6+ (usa `fetch` nativo y `--env-file`).
- Una API key de Google AI Studio para Gemini (tier gratis, sin tarjeta).
- Archivos de música `.mp3` con licencia libre.

## Puesta en marcha

1. Poné música con licencia libre en `music/`.
2. Creá un archivo `.env` en la raíz con tu clave:
   ```
   GEMINI_API_KEY=tu-key-aca
   ```
3. Levantá los servicios (Icecast + Liquidsoap + Kokoro):
   ```
   docker compose up
   ```
   La primera vez baja las imágenes (Kokoro es pesada); puede tardar.
4. Arrancá el generador, que corre en loop:
   ```
   node --env-file=.env generator/main.js
   ```
5. Escuchá en el navegador o en VLC:
   ```
   http://localhost:8000/radio.mp3
   ```

## Estructura

```
radio-ia/
├── docker-compose.yml      # icecast + liquidsoap + kokoro
├── liquidsoap/
│   └── radio.liq           # motor: música, voz dinámica, transiciones
├── generator/
│   └── main.js             # contexto -> Gemini -> Kokoro -> locucion.wav
├── music/                  # biblioteca de música (no versionada)
├── output/                 # locución generada (no versionada)
├── .env                    # GEMINI_API_KEY (no versionado)
└── README.md
```

## Licencias

- **Música:** usar solo temas con licencia clara (Creative Commons o
  royalty-free), respetando atribución cuando corresponda.
- **Clima:** datos de [Open-Meteo](https://open-meteo.com/), bajo CC BY 4.0
  (requiere atribución en el reproductor web cuando exista).

## Estado

Funciona de punta a punta en local: radio autónoma con dos locutores que
dialogan con datos reales (hora, clima, noticias).

Pendiente: ajustes de frecuencia (cada cuántos temas hablan, cada cuánto dan
el clima), reproductor web y deploy a un VPS para que corra 24/7 de verdad.
