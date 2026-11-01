# CLAUDE.md — instalar y operar este feed

Este repo es un feed personal de información curado por criterios escritos en Markdown, con un agente
investigador (Claude Agent SDK) y un chat. Corre entero en la máquina de la persona, en localhost. Si te pasaron
el enlace del repo para que lo instales, este archivo es tu procedimiento. Habla con la persona en su idioma;
el código y los archivos están en español.

## Qué vas a dejar funcionando

1. El servidor en `http://127.0.0.1:4400` con la interfaz construida.
2. El agente conectado a un modelo (credencial verificada con una llamada real).
3. Los criterios de la persona en `vault/criterios/` (los que vienen son un ejemplo).
4. Opcional: el servidor fijo como LaunchAgent (Mac) para que arranque con la sesión.

## Procedimiento

Corre los pasos en orden. Cada uno se verifica solo; no sigas si uno falla.

```bash
# 0. Requisito: Node 24 o superior. Si falta o es viejo: brew install node (Mac) o nvm install 26.
node -v

# 1. Instalar, configurar, construir y verificar. No arranca el servidor todavía.
bash ops/instalar.sh --sin-arrancar
```

`ops/instalar.sh` termina corriendo `npm run doctor`, que imprime una línea ✓/✗ por cada comprobación:
Node, dependencias, build, criterios, **credencial del modelo** y, con `--servidor`, el servidor. Lee esa salida.

### Si el doctor dice «sin credencial para el modelo»

El Agent SDK usa, en este orden: `ANTHROPIC_API_KEY` del `.env`, o la sesión de Claude Code de la máquina.
Tú no puedes resolver esto solo; pregúntale a la persona cuál de las dos prefiere:

- **Sesión de Claude Code** (si ya usa Claude Code en esa máquina, es lo más simple): que corra `claude` en una
  terminal y haga `/login` si no está autenticada. Luego repite `npm run doctor`.
- **Llave de API**: que la pegue ella misma en `.env` como `ANTHROPIC_API_KEY=...`. No le pidas la llave por el
  chat ni la escribas tú en ningún archivo. Luego repite `npm run doctor`.

No sigas al paso 2 hasta que el doctor diga «el modelo responde».

```bash
# 2. Criterios: ver el paso «Criterios de la persona» abajo, antes del primer barrido.

# 3. Arrancar. Elige una:
bash ops/instalar.sh                 # en segundo plano con nohup (se cae al cerrar sesión)
bash ops/instalar.sh --launchagent   # Mac: fijo, arranca solo y se reinicia si muere (pide confirmación a la persona)

# 4. Comprobación final
npm run doctor -- --servidor
```

Cuando todo esté en ✓, abre `http://127.0.0.1:4400` (o dile a la persona que lo abra) y pulsa «Buscar ahora»
para el primer barrido. Dura de dos a cinco minutos y cuesta entre 0,3 y 0,8 USD; el progreso se ve en la página.

## Criterios de la persona

Los cuatro criterios que vienen en `vault/criterios/` son del autor del repo (agentes de IA, ontologías,
negocios en Colombia, inmobiliario en el Caribe). Antes del primer barrido pregúntale a la persona qué temas
quiere seguir (tres a cinco) y escribe un archivo por tema, con el mismo formato que los existentes:

- frontmatter: `tipo: criterio`, `nombre`, `peso: 1.0`, `estado: vigente`, `palabras` (lista), `fuentes` con
  `reddit` (nombres de subreddit sin `r/`), `youtube_canales` (handles `@nombre` o ids `UC…`), `rss` (URLs de
  feeds reales) y `consultas` (búsquedas web);
- cuerpo con «# Qué nos interesa» y «# Qué no», en primera persona del plural, en el idioma de la persona.

Borra los criterios de ejemplo que no le sirvan y vacía `vault/guardados/` (son notas del autor). Si no sabe qué
fuentes poner, deja `reddit` y `rss` vacíos y pon tres o cuatro `consultas`: el investigador busca en la web.
Comprueba cada RSS con `curl -sI <url> | head -1` antes de dejarlo: muchos sitios devuelven HTML o 404.
`vault/vetos.md` es lo que nunca entra; ajústalo también.

## Lo que no debes hacer

- No pongas llaves, tokens ni contraseñas en ningún archivo del repo; `.env` está en `.gitignore` y así se queda.
- No cambies el User-Agent para hacerte pasar por un navegador ante Reddit u otros sitios: si un feed da 403 o 429, se
  espera o se quita la fuente. Reddit sin cuenta tolera unos pocos barridos al día; el código ya espacia las
  peticiones y reintenta una vez.
- No subas el tope diario (`TOPE_USD_DIA`) sin que la persona lo pida; es el freno de gasto.
- No instales el LaunchAgent sin decírselo: modifica `~/Library/LaunchAgents` de su usuario.
- No ejecutes `npm run buscar` varias veces seguidas para «probar»: cada barrido gasta dinero real.

## Cómo está hecho (para operarlo o tocarlo)

- `server/` Node 24+ con TypeScript sin transpilar, Hono, `ws`, `node:sqlite`. Entrada `server/index.ts`.
  Scripts: `npm start`, `npm run dev`, `npm run build`, `npm run buscar` (barrido desde terminal), `npm run doctor`,
  `npm run typecheck`.
- `server/agente/investigador.ts` recolecta sin modelo (RSS, Reddit, YouTube), juzga en lotes con salida
  estructurada, completa portadas (Open Graph) y escribe el panorama. `server/agente/chat.ts` atiende el widget
  por WebSocket y tiene la herramienta `publicar_en_feed`: una investigación pedida por chat termina en tarjetas.
- `server/agente/comun.ts` fija `strictMcpConfig: true` y `settingSources: []`. Sin eso el CLI del SDK carga los
  conectores MCP de la cuenta de la persona y cada llamada cuesta cientos de miles de tokens. No lo quites.
- `vault/` es el algoritmo: criterios, vetos y guardados, en texto. La base `data/feed.sqlite` guarda ítems,
  señales, barridos y panoramas; se puede borrar para empezar de cero.
- Configuración en `.env`: `PUERTO`, `TOPE_USD_DIA`, `CRON_BARRIDO` (5 campos, hora local; vacío = solo manual),
  `MODELO_INVESTIGADOR`, `MODELO_CHAT`, `ANTHROPIC_API_KEY`.

## Problemas conocidos

| Síntoma | Causa y salida |
| --- | --- |
| `EADDRINUSE :4400` | ya hay un servidor: `lsof -ti tcp:4400 \| xargs kill`, o cambia `PUERTO` en `.env` |
| `SyntaxError` o `--use-system-ca` desconocido al arrancar | Node viejo; hace falta 24 o superior |
| doctor: «sin credencial» | ver arriba; `claude` + `/login`, o `ANTHROPIC_API_KEY` en `.env` |
| Barrido termina «sin presupuesto» | el gasto del día llegó al tope; mañana vuelve, o sube `TOPE_USD_DIA` si la persona lo pide |
| Reddit 429 en la bitácora | cuota sin cuenta agotada; el barrido sigue con las demás fuentes |
| Un handle `@canal` no resuelve | el handle está mal escrito; confirma en youtube.com/@handle |
