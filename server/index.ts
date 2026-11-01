import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { Cron } from 'croner';
import fs from 'node:fs';
import path from 'node:path';
import type { Server } from 'node:http';
import { config } from './config.ts';
import { corridasDb } from './db.ts';
import { api } from './rutas/api.ts';
import { montarChat } from './ws.ts';
import { lanzarBarrido } from './agente/investigador.ts';
import { bitacora } from './bitacora.ts';

corridasDb.abortarColgadas();

const app = new Hono();
app.route('/api', api);

// progreso del investigador en vivo
app.get('/api/bitacora/stream', (c) =>
  new Response(
    new ReadableStream({
      start(ctrl) {
        const enc = new TextEncoder();
        const mandar = (l: unknown) => ctrl.enqueue(enc.encode(`data: ${JSON.stringify(l)}\n\n`));
        for (const l of bitacora.ultimas(20)) mandar(l);
        const baja = bitacora.suscribir(mandar);
        c.req.raw.signal.addEventListener('abort', () => {
          baja();
          ctrl.close();
        });
      },
    }),
    { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' } },
  ),
);

// la interfaz construida (npm run build); en desarrollo la sirve Vite en otro puerto
if (fs.existsSync(path.join(config.rutaWeb, 'index.html'))) {
  app.use('/*', serveStatic({ root: path.relative(process.cwd(), config.rutaWeb) || '.' }));
  app.get('*', (c) => c.html(fs.readFileSync(path.join(config.rutaWeb, 'index.html'), 'utf8')));
} else {
  app.get('/', (c) => c.text('Interfaz sin construir. Corre `npm run build` o usa `npm run dev` (Vite en :5173).'));
}

const servidor = serve({ fetch: app.fetch, port: config.puerto, hostname: '127.0.0.1' }, (info) => {
  console.log(`Feed propio en http://127.0.0.1:${info.port}  (vault: ${config.rutaVault})`);
}) as Server;
montarChat(servidor);

if (config.cronBarrido.trim()) {
  new Cron(config.cronBarrido, { timezone: process.env.TZ }, () => void lanzarBarrido('cron', bitacora.anotar));
  console.log(`Barrido automático: "${config.cronBarrido}" · tope ${config.topeUsdDia} USD/día`);
} else console.log('Barrido automático apagado (CRON_BARRIDO vacío): solo manual.');
