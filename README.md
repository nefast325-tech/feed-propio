# Feed propio

Un feed de información curado por **nuestros criterios**, no por el algoritmo de recomendación de nadie. Corre
entero en este Mac (localhost), es un proyecto independiente y es un piloto.

- **Vault propio** (`vault/`): criterios en Markdown (temas, palabras, fuentes, peso) y notas de lo que guardamos.
  El algoritmo es ese texto: se lee, se edita y se versiona.
- **Investigador**: un agente (Claude Agent SDK) que corre dos veces al día o cuando pulsas «Buscar ahora».
  Primero recolecta sin modelo (feeds de Reddit, RSS, canales de YouTube); después juzga cada candidato contra
  los criterios y los vetos, busca en la web y en YouTube lo que las fuentes no traen, y devuelve por ítem un
  puntaje, los criterios que cumple, un resumen, dos a cuatro **temas** y **por qué entró**. Al cerrar, completa
  la **ficha** de cada ítem (portada Open Graph, favicon, nombre del sitio; sin modelo) y escribe el **panorama**:
  cuatro a seis frases sobre qué entró y qué hilo lo une, con el ítem que hay que ver primero.
- **Señales**: guardar, descartar, «más así», «menos así», con motivo opcional. Cada señal mueve el `peso` de los
  criterios (en el vault) y el peso del origen (en la base), y reordena el feed. Siempre puedes ver qué cambió.
- **Chat**: el widget `@tp3/chat-widget` conectado a un agente local que lee el feed y el vault, explica, busca,
  edita criterios cuando se lo pides, guarda y lanza barridos. Si le pides investigar un tema, no te lo vuelca en
  el chat: busca, elige entre 3 y 8 piezas y las publica como tarjetas (etiqueta CHAT, sin corrida); en el chat solo
  te dice cuántas entraron, cuál mirar primero y si el tema merece volverse criterio.
- **Portada**: panorama del día con el destacado, cifras (para ver, guardados, señales, gasto, próximo barrido),
  nube de temas, buscador y tarjetas con imagen. Atajos de teclado: `j`/`k` moverse, `o` abrir, `s` guardar,
  `d` descartar, `+`/`-` más/menos así, `p` preguntar, `/` buscar, `c` abre el panel de criterios, `?` ayuda.

## Requisitos

- **Node 24 o superior** (probado con 26). El servidor corre TypeScript sin transpilar y usa `node:sqlite`, `--use-system-ca`
  y `--env-file-if-exists`, que no existen en Node 22 ni en versiones anteriores. En Mac: `brew install node`.
- **Una credencial para el modelo**: o `ANTHROPIC_API_KEY` en `.env`, o [Claude Code](https://code.claude.com) instalado
  e iniciado con `claude` en esa máquina (ver «Credencial del modelo»). Sin una de las dos, la interfaz abre pero el
  investigador y el chat responden «sin credencial».
- Git y acceso a GitHub para instalar el widget de chat (es una dependencia que viene de un repo público).
- Nada más: no hay Docker, ni base de datos externa, ni cuentas de Reddit o YouTube.

## Correr

```bash
cp .env.example .env     # ajusta PUERTO, TOPE_USD_DIA, CRON_BARRIDO
npm install
npm run build            # construye la interfaz en dist/
npm start                # http://127.0.0.1:4400
```

Desarrollo con recarga: `npm run dev` (servidor en :4400 y Vite en :5173 con proxy).

Barrido desde la terminal, sin interfaz: `npm run buscar`.

## Credencial del modelo

El Agent SDK usa `ANTHROPIC_API_KEY` si está en `.env`; si no, cae a la sesión de Claude Code de este Mac
(`claude` con tu plan). La documentación del SDK señala la llave de API como el camino oficial; la sesión del
plan funciona en uso personal local, pero no es para distribuir el feed a terceros.

## Costo y la trampa de los conectores

El Agent SDK lanza el CLI de Claude Code, y este carga por defecto los conectores MCP de la cuenta (Notion, Gmail,
Adobe, etc.): cientos de herramientas, unos 350 mil tokens de contexto en **cada** llamada, lo que hacía que una búsqueda
web costara más de 5 USD. Por eso `server/agente/comun.ts` fija `strictMcpConfig: true` (solo nuestros servidores MCP) y
`settingSources: []`. Con eso una llamada trivial pesa ~500 tokens y una búsqueda web unos 3 centavos. Si el costo de
una corrida vuelve a dispararse, revisa primero `scripts/diag-costo.ts`.

## Fuentes y límites conocidos

- **Reddit**: se leen los feeds Atom públicos (`/r/<sub>/top/.rss`) con nuestro User-Agent, una petición por
  subreddit y seis segundos entre ellas. Reddit devuelve 403/429 a los endpoints `.json` para clientes que no
  son navegador y no nos vamos a disfrazar. Si cierra también los feeds, el camino limpio es registrar una app en
  `reddit.com/prefs/apps` y usar su API con OAuth.
- **YouTube**: feeds de canal (`youtube_canales` en cada criterio, por id `UC…` o por handle `@nombre`; el handle
  se resuelve una vez leyendo la página pública del canal y queda en SQLite) y búsqueda por WebSearch con
  `site:youtube.com`; la ficha se completa con oEmbed. Sin llave de API.
- **Portadas**: una petición GET por ítem aceptado, solo la cabeza del HTML (`og:image`, `og:site_name`, favicon,
  fecha). Para YouTube la miniatura es determinista y no se pide la página; para Reddit no se pide nada (límite
  sin cuenta) y la imagen sale del feed si el post la trae. Lo que no tiene imagen lleva una portada de color
  estable por origen. `POST /api/items/fichas` completa las de ítems viejos.
- **X**: fuera del piloto. La API cuesta y el scraping viola sus términos. Fase 2 si el piloto lo merece.
- **SIC**: su RSS tiene la cadena de certificados incompleta; el investigador la cubre por WebSearch.
- El servidor corre con `--use-system-ca` para los sitios con certificados del sistema.

## Estructura

```
server/            Node 26 + TypeScript (sin transpilar), Hono, ws, node:sqlite
  agente/          investigador.ts (barrido) · chat.ts (widget) · comun.ts (opciones y credencial)
  fuentes/         reddit.ts · rss.ts · youtube.ts · ficha.ts (Open Graph) · recolector.ts
  vault.ts         lectura y escritura de criterios, vetos y notas guardadas
  puntaje.ts       puntaje_final = puntaje × peso(criterios) × peso(origen); señales
web/               React + Vite: feed, tarjetas, criterios, widget de chat
vault/             criterios/*.md · vetos.md · guardados/*.md
data/feed.sqlite   ítems (con ficha y temas), señales, corridas, panoramas, canales resueltos, pesos, sesiones
ops/               LaunchAgent para que el servidor quede corriendo en el Mac
```
