import { Hono } from 'hono';
import { corridasDb, itemsDb, panoramasDb, pesosOrigenDb, senalesDb, type Estado } from '../db.ts';
import { leerCriterios, leerVetos, listarGuardados, textoCriterio } from '../vault.ts';
import { aplicarSenal } from '../puntaje.ts';
import { lanzarBarrido, hayBarridoEnCurso, completarFichas } from '../agente/investigador.ts';
import { config } from '../config.ts';
import { bitacora } from '../bitacora.ts';

export const api = new Hono();

api.get('/items', (c) => {
  const estado = (c.req.query('estado') ?? 'nuevo') as Estado | 'todos';
  const limite = Number(c.req.query('limite') ?? 100);
  return c.json(itemsDb.listar(estado, limite, c.req.query('q')));
});

api.get('/panorama', (c) => {
  const p = panoramasDb.ultimo();
  return c.json(p ? { ...p, destacado: p.destacado_id ? itemsDb.porId(p.destacado_id) : null } : null);
});

api.get('/estadisticas', (c) => c.json(itemsDb.estadisticas()));

/** Completa portadas e iconos de ítems que entraron antes de que existiera la ficha. */
api.post('/items/fichas', async (c) => {
  const pendientes = itemsDb.sinFicha(40);
  const n = await completarFichas(pendientes);
  return c.json({ revisados: pendientes.length, con_portada: n });
});

api.post('/items/:id/visto', (c) => {
  itemsDb.marcarVisto(c.req.param('id'));
  return c.json({ ok: true });
});

api.post('/items/:id/senal', async (c) => {
  const { tipo, motivo } = (await c.req.json()) as { tipo: 'guardar' | 'descartar' | 'mas' | 'menos'; motivo?: string };
  if (!['guardar', 'descartar', 'mas', 'menos'].includes(tipo)) return c.json({ error: 'tipo inválido' }, 400);
  try {
    return c.json(aplicarSenal(c.req.param('id'), tipo, motivo?.trim() || null));
  } catch (e) {
    return c.json({ error: (e as Error).message }, 404);
  }
});

api.get('/criterios', (c) => c.json({ criterios: leerCriterios(), vetos: leerVetos(), pesos_origen: pesosOrigenDb.todos() }));
api.get('/criterios/:slug', (c) => {
  const t = textoCriterio(c.req.param('slug'));
  return t == null ? c.json({ error: 'no existe' }, 404) : c.text(t);
});
api.get('/guardados', (c) => c.json(listarGuardados()));
api.get('/senales', (c) => c.json(senalesDb.recientes(50)));

api.get('/estado', (c) =>
  c.json({
    en_curso: hayBarridoEnCurso(),
    gasto_hoy_usd: corridasDb.gastoHoy(),
    tope_usd_dia: config.topeUsdDia,
    cron: config.cronBarrido,
    corridas: corridasDb.recientes(10),
    bitacora: bitacora.ultimas(30),
  }),
);

api.post('/barrido', (c) => {
  if (hayBarridoEnCurso()) return c.json({ ok: false, mensaje: 'Ya hay un barrido en curso' }, 409);
  void lanzarBarrido('manual', bitacora.anotar);
  return c.json({ ok: true, mensaje: 'Barrido lanzado' });
});
