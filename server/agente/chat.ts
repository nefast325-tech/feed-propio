/**
 * El agente del chat: habla con la persona sobre el feed y el vault. Puede consultar ítems, leer y editar criterios,
 * ajustar pesos, guardar o descartar, lanzar un barrido y buscar en la web. Cada conversación del widget
 * se reanuda con su session_id del SDK.
 */
import { query, tool, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { conversacionesDb, corridasDb, itemsDb, pesosOrigenDb, type Fuente } from '../db.ts';
import { idDesdeUrl, recortar } from '../fuentes/tipos.ts';
import { bitacora } from '../bitacora.ts';
import { puntajeFinal } from '../puntaje.ts';
import { escribirCriterio, leerCriterios, leerVetos, listarGuardados, textoCriterio } from '../vault.ts';
import { aplicarSenal } from '../puntaje.ts';
import { lanzarBarrido, hayBarridoEnCurso, completarFichas } from './investigador.ts';
import { opcionesBase, errorLegible, MODELO_CHAT } from './comun.ts';

const txt = (text: string) => ({ content: [{ type: 'text' as const, text }] });
const json = (v: unknown) => txt(JSON.stringify(v, null, 1));


/** Fuente y origen legible a partir de la URL: r/sub para Reddit, YouTube para videos, el dominio para lo demás. */
function clasificarUrl(url: string): { fuente: Fuente; origen: string } {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return { fuente: 'web', origen: 'web' };
  }
  const host = u.hostname.replace(/^www\./, '');
  if (/(^|\.)youtube\.com$|^youtu\.be$/.test(host)) return { fuente: 'youtube', origen: 'YouTube' };
  if (/(^|\.)reddit\.com$/.test(host)) {
    const m = u.pathname.match(/\/r\/([^/]+)/);
    return { fuente: 'reddit', origen: m ? `r/${m[1]}` : 'reddit' };
  }
  return { fuente: 'web', origen: host };
}

const esquemaItem = z.object({
  url: z.string().url(),
  titulo: z.string().min(3).max(200),
  resumen: z.string().min(20).max(600).describe('Dos o tres frases: qué es y qué aporta.'),
  razones: z.string().min(10).max(400).describe('Por qué entra, en voz nuestra.'),
  puntaje: z.number().int().min(0).max(100).describe('Cuánto vale para nosotros.'),
  criterios: z.array(z.string()).optional().describe('Slugs de criterios vigentes que cumple; vacío si es un tema fuera de los criterios.'),
  temas: z.array(z.string().max(24)).min(1).max(4).describe('Etiquetas cortas en minúscula.'),
  autor: z.string().max(120).optional(),
  publicado: z.string().optional().describe('Fecha ISO si se conoce.'),
});

const herramientas = createSdkMcpServer({
  name: 'feed',
  tools: [
    tool('consultar_feed', 'Lista ítems del feed por estado (nuevo, guardado, descartado, todos) o busca por texto.', { estado: z.enum(['nuevo', 'guardado', 'descartado', 'todos']).optional(), texto: z.string().optional(), limite: z.number().int().min(1).max(50).optional() }, async ({ estado, texto, limite }) => {
      const items = texto ? itemsDb.buscar(texto, limite ?? 20) : itemsDb.listar(estado ?? 'nuevo', limite ?? 20);
      return json(items.map((i) => ({ id: i.id, titulo: i.titulo, fuente: i.fuente, origen: i.origen, url: i.url, puntaje: i.puntaje, puntaje_final: i.puntaje_final, criterios: i.criterios, estado: i.estado, resumen: i.resumen, razones: i.razones })));
    }),
    tool('leer_criterios', 'Devuelve los criterios vigentes del vault con su peso, palabras, fuentes y texto, más los vetos globales.', {}, async () => json({ criterios: leerCriterios(), vetos: leerVetos(), pesos_origen: pesosOrigenDb.todos() })),
    tool('leer_criterio', 'Devuelve el archivo Markdown completo de un criterio.', { slug: z.string() }, async ({ slug }) => txt(textoCriterio(slug) ?? 'No existe ese criterio.')),
    tool(
      'escribir_criterio',
      'Crea o reemplaza un criterio del vault. El texto debe ser el archivo Markdown completo con frontmatter (tipo, nombre, peso, estado, palabras, fuentes{reddit, youtube_canales, rss, consultas}) y cuerpo con «Qué nos interesa» y «Qué no». Úsalo solo cuando la persona lo pida o lo apruebe.',
      { slug: z.string().regex(/^[a-z0-9-]+$/), texto: z.string() },
      async ({ slug, texto }) => {
        escribirCriterio(slug, texto);
        return txt(`Criterio ${slug} escrito en vault/criterios/${slug}.md`);
      },
    ),
    tool(
      'publicar_en_feed',
      'Publica en el feed, como tarjetas, los resultados de una investigación pedida por la persona. Cada ítem necesita URL real (la que abriste o encontraste), título, resumen, razones, puntaje y temas. Las portadas y el favicon se completan solos. Devuelve cuántos entraron y cuáles ya existían.',
      { tema: z.string().min(2).max(120).describe('Qué pidió investigar la persona, en pocas palabras.'), items: z.array(esquemaItem).min(1).max(12) },
      async ({ tema, items }) => {
        const criteriosVigentes = new Set(leerCriterios().map((c) => c.slug));
        const nuevos: { id: string; url: string; imagen: string | null; titulo: string }[] = [];
        const repetidos: string[] = [];
        for (const it of items) {
          if (itemsDb.existeUrl(it.url)) {
            repetidos.push(it.url);
            continue;
          }
          const { fuente, origen } = clasificarUrl(it.url);
          const criterios = (it.criterios ?? []).filter((c) => criteriosVigentes.has(c));
          const temas = Array.from(new Set([...it.temas, tema].map((t) => t.toLowerCase().trim()).filter((t) => t && t.length <= 24))).slice(0, 4);
          const id = idDesdeUrl(it.url);
          itemsDb.insertar({
            id, fuente, origen, url: it.url, titulo: it.titulo.trim(), autor: it.autor ?? null, publicado: it.publicado ?? null,
            extracto: null, resumen: recortar(it.resumen, 600), puntaje: it.puntaje, puntaje_final: puntajeFinal(it.puntaje, criterios, origen),
            criterios, razones: `Pedido en el chat («${tema}»). ${it.razones.trim()}`, corrida: null, imagen: null, temas,
          });
          nuevos.push({ id, url: it.url, imagen: null, titulo: it.titulo });
        }
        if (nuevos.length) {
          await completarFichas(nuevos).catch(() => 0);
          bitacora.anotar(`Chat: ${nuevos.length} ítems publicados en el feed sobre «${tema}».`);
        }
        return json({ publicados: nuevos.map((n) => ({ id: n.id, titulo: n.titulo })), ya_existian: repetidos, tema });
      },
    ),
    tool('senal', 'Aplica una señal sobre un ítem en nombre de la persona: guardar, descartar, mas («más así») o menos. Mueve pesos y, si guarda, deja nota en el vault.', { id: z.string(), tipo: z.enum(['guardar', 'descartar', 'mas', 'menos']), motivo: z.string().optional() }, async ({ id, tipo, motivo }) => json(aplicarSenal(id, tipo, motivo ?? null))),
    tool('leer_guardados', 'Lista las notas de vault/guardados (lo que decidimos conservar).', {}, async () => json(listarGuardados().map((g) => ({ archivo: g.archivo, texto: g.texto.slice(0, 1200) })))),
    tool('estado_barridos', 'Últimos barridos del investigador: cuándo, cuántos candidatos, cuántos entraron, costo.', {}, async () => json({ en_curso: hayBarridoEnCurso(), gasto_hoy_usd: corridasDb.gastoHoy(), corridas: corridasDb.recientes(8) })),
    tool('lanzar_barrido', 'Lanza un barrido del investigador ahora (si no hay uno en curso). Responde de inmediato; el resultado aparece en el feed.', {}, async () => {
      if (hayBarridoEnCurso()) return txt('Ya hay un barrido en curso.');
      void lanzarBarrido('manual');
      return txt('Barrido lanzado. En unos minutos aparecen los ítems nuevos en el feed.');
    }),
  ],
});

const SISTEMA = `Eres el asistente de un feed personal que reemplaza los algoritmos de recomendación de las plataformas por
criterios propios de la persona, escritos en Markdown en su vault. Hablas en español, directo, sin adulación.
Puedes: explicar por qué entró o no un ítem, resumirlo, buscar en el feed y en la web, leer y editar criterios
(solo cuando te lo pidan o aprueben el cambio que propones), ajustar pesos con señales, guardar o descartar, lanzar un barrido,
y publicar en el feed lo que investigas.

Regla principal: el feed es la pantalla, el chat es el control remoto. Cuando la persona te pida investigar, buscar,
explorar o «traer» algo sobre un tema (o te pregunte qué hay de nuevo sobre algo), NO le vuelques la investigación en el
chat. Haz esto: busca en la web (varias búsquedas si hace falta, abre las páginas que valgan la pena), elige entre 3 y 8
piezas concretas y verificables —artículos, videos, hilos, documentos, cada una con su URL real—, y publícalas con
publicar_en_feed con resumen, razones, puntaje y temas. Si alguna encaja con un criterio vigente, pon su slug en criterios
(léelos con leer_criterios si no los tienes). Después responde en el chat con dos o tres líneas: cuántas tarjetas
publicaste, cuál mirar primero y por qué, y si vale la pena convertir el tema en un criterio para que el investigador lo
siga solo. Nada de listas largas con enlaces en el chat: eso ya está en el feed.

Solo respondes por texto largo cuando la persona pide una explicación, una comparación o una opinión, no material nuevo.
Cuando edites un criterio, muestra antes qué vas a cambiar. Cuando des una cifra, di de dónde sale.
Si te pasan un contexto con un ítem, es el que la persona tiene abierto: habla de ese.`;

export interface Emisor {
  estado(s: 'typing' | 'idle'): void;
  token(t: string): void;
  listo(id: string): void;
  error(msg: string): void;
}

export async function responderChat(sesionWidget: string, texto: string, contexto: Record<string, unknown> | undefined, emisor: Emisor, abort: AbortController) {
  const previa = conversacionesDb.sesionAgente(sesionWidget);
  const prompt = contexto && Object.keys(contexto).length ? `${texto}\n\n[contexto de la página: ${JSON.stringify(contexto)}]` : texto;
  emisor.estado('typing');
  let emitido = 0;
  let final = '';
  try {
    for await (const m of query({
      prompt,
      options: {
        ...opcionesBase,
        model: MODELO_CHAT,
        ...(previa ? { resume: previa } : {}),
        mcpServers: { feed: herramientas },
        allowedTools: ['WebSearch', 'WebFetch', 'mcp__feed__*'],
        maxTurns: 40,
        maxBudgetUsd: 1.5,
        includePartialMessages: true,
        systemPrompt: SISTEMA,
        abortController: abort,
      },
    })) {
      if (m.type === 'system' && m.subtype === 'init') conversacionesDb.guardar(sesionWidget, m.session_id);
      if (m.type === 'stream_event') {
        const e = m.event as { type: string; delta?: { type: string; text?: string } };
        if (e.type === 'content_block_delta' && e.delta?.type === 'text_delta' && e.delta.text) {
          emisor.token(e.delta.text);
          emitido += e.delta.text.length;
        }
      }
      if (m.type === 'result') {
        conversacionesDb.guardar(sesionWidget, m.session_id);
        final = m.subtype === 'success' ? m.result : `No pude terminar (${m.subtype}). ${m.errors?.join('; ') ?? ''}`;
      }
    }
    // si el streaming no soltó nada (p. ej. respuesta tras herramientas), mandamos el texto final de una vez
    if (!emitido && final) emisor.token(final);
    emisor.listo(`msg_${Date.now().toString(36)}`);
  } catch (e) {
    if (abort.signal.aborted) return;
    emisor.error(errorLegible(e));
  } finally {
    emisor.estado('idle');
  }
}
