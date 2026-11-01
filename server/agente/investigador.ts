/**
 * El investigador, en pasos pequeños e independientes para que el costo sea acotado y nada se pierda a medias:
 *
 *   1. recolectar  — sin modelo: feeds de Reddit, RSS y canales de YouTube declarados en los criterios.
 *   2. descubrir   — una llamada corta por criterio: UNA búsqueda web (YouTube o web) y hasta cuatro hallazgos.
 *   3. juzgar      — lotes de ~20 candidatos, sin herramientas, salida estructurada: acepta, puntaje, criterios,
 *                    resumen y por qué. Cada lote se guarda al terminar.
 *
 * Cada llamada lleva su propio maxBudgetUsd, repartido de lo que queda del tope diario. Si el presupuesto se agota,
 * los lotes ya juzgados quedan en el feed y la corrida termina en «parcial».
 */
import { query } from '@anthropic-ai/claude-agent-sdk';
import { config } from '../config.ts';
import { corridasDb, itemsDb, panoramasDb } from '../db.ts';
import { leerCriterios, leerVetos, type Criterio } from '../vault.ts';
import { recolectarCandidatos } from '../fuentes/recolector.ts';
import { fichaYoutube } from '../fuentes/youtube.ts';
import { ficha } from '../fuentes/ficha.ts';
import { idDesdeUrl, recortar, type Candidato } from '../fuentes/tipos.ts';
import { puntajeFinal } from '../puntaje.ts';
import { opcionesBase, errorLegible, MODELO_INVESTIGADOR } from './comun.ts';

export interface ResultadoBarrido {
  corrida: number;
  candidatos: number;
  aceptados: number;
  costo_usd: number;
  turnos: number;
  estado: string;
  nota?: string;
}

type Veredicto = { id: string; acepta: boolean; puntaje: number; criterios: string[]; resumen: string; razones: string; temas?: string[] };
type Hallazgo = { url: string; titulo?: string; extracto?: string };

const esquemaVeredictos = {
  type: 'object',
  properties: {
    veredictos: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          acepta: { type: 'boolean' },
          puntaje: { type: 'number', description: '0 a 100: cuánto vale para nosotros' },
          criterios: { type: 'array', items: { type: 'string' }, description: 'slugs de los criterios que cumple' },
          resumen: { type: 'string', description: 'Tres líneas, en nuestra voz: qué dice y qué aporta' },
          razones: { type: 'string', description: 'Por qué entra o no: qué regla cumple, qué veto rompe' },
          temas: { type: 'array', items: { type: 'string' }, description: 'Dos a cuatro etiquetas cortas en minúsculas (una o dos palabras) para agrupar: p. ej. "mcp", "tributario", "cartagena"' },
        },
        required: ['id', 'acepta', 'puntaje', 'criterios', 'resumen', 'razones', 'temas'],
      },
    },
  },
  required: ['veredictos'],
} as const;

const esquemaHallazgos = {
  type: 'object',
  properties: {
    hallazgos: {
      type: 'array',
      items: {
        type: 'object',
        properties: { url: { type: 'string' }, titulo: { type: 'string' }, extracto: { type: 'string', description: 'De qué trata, una o dos frases' } },
        required: ['url'],
      },
    },
    nota: { type: 'string' },
  },
  required: ['hallazgos'],
} as const;

const esquemaPanorama = {
  type: 'object',
  properties: {
    panorama: { type: 'string', description: 'Cuatro a seis frases, en nuestra voz, que cuenten qué entró hoy y qué hilo lo une. Sin listas ni títulos.' },
    destacado_id: { type: 'string', description: 'id del ítem que hay que ver primero' },
    por_que_destacado: { type: 'string', description: 'Una frase' },
  },
  required: ['panorama', 'destacado_id', 'por_que_destacado'],
} as const;

const VOZ = `Trabajas para una sola persona que quiere reemplazar los algoritmos de recomendación de YouTube, Reddit y X por
criterios propios, escritos por ella en Markdown, que puede leer y corregir. Hablas en español, en primera persona del
plural («nos interesa», «lo descartamos»), sin adulación y sin relleno. Sé exigente: un feed con cinco cosas buenas vale
más que uno con cuarenta regulares. Cuando dudes, no aceptes.`;

let enCurso: Promise<ResultadoBarrido> | null = null;
export const hayBarridoEnCurso = () => enCurso != null;

export function lanzarBarrido(disparo: 'cron' | 'manual' | 'cli', avisar: (msg: string) => void = console.log): Promise<ResultadoBarrido> {
  if (enCurso) return enCurso;
  enCurso = barrido(disparo, avisar).finally(() => (enCurso = null));
  return enCurso;
}

/** Una llamada acotada al modelo con salida estructurada. Devuelve la salida (o null) y lo que costó. */
async function llamar<T>(prompt: string, sistema: string, presupuesto: number, conBusqueda: boolean, schema: Record<string, unknown>, avisar: (m: string) => void): Promise<{ salida: T | null; costo: number; turnos: number; error?: string }> {
  let costo = 0, turnos = 0, salida: T | null = null, error: string | undefined;
  try {
    for await (const m of query({
      prompt,
      options: {
        ...opcionesBase,
        model: MODELO_INVESTIGADOR,
        tools: conBusqueda ? ['WebSearch'] : [],
        allowedTools: conBusqueda ? ['WebSearch'] : [],
        maxTurns: conBusqueda ? 4 : 2,
        maxBudgetUsd: presupuesto,
        outputFormat: { type: 'json_schema', schema },
        systemPrompt: sistema,
      },
    })) {
      if (m.type === 'assistant') for (const b of m.message.content) if (b.type === 'tool_use') avisar(`→ ${b.name}: ${(b.input as { query?: string }).query ?? ''}`);
      if (m.type === 'result') {
        costo = m.total_cost_usd;
        turnos = m.num_turns;
        if (m.subtype === 'success') salida = (m.structured_output as T) ?? null;
        else error = `${m.subtype}${m.errors?.length ? `: ${m.errors.join('; ')}` : ''}`;
      }
    }
  } catch (e) {
    error = errorLegible(e);
  }
  return { salida, costo, turnos, error };
}

async function barrido(disparo: 'cron' | 'manual' | 'cli', avisar: (msg: string) => void): Promise<ResultadoBarrido> {
  const corrida = corridasDb.abrir(disparo);
  const gastado = corridasDb.gastoHoy();
  let presupuesto = Math.max(0, config.topeUsdDia - gastado);
  let costo = 0, turnos = 0, aceptados = 0;
  const notas: string[] = [];
  const cerrar = (estado: string, candidatos: number) => {
    const r = { candidatos, aceptados, costo_usd: costo, turnos, estado, nota: notas.join(' · ') || undefined };
    corridasDb.cerrar(corrida, r);
    avisar(`Barrido ${estado}: ${aceptados} de ${candidatos} entran al feed. Costo estimado ${costo.toFixed(3)} USD en ${turnos} turnos.`);
    return { corrida, ...r };
  };
  const gastar = (r: { costo: number; turnos: number }) => {
    costo += r.costo;
    turnos += r.turnos;
    presupuesto = Math.max(0, presupuesto - r.costo);
  };

  if (presupuesto < 0.1) {
    avisar(`Tope diario alcanzado (${gastado.toFixed(2)} de ${config.topeUsdDia} USD). No se lanza el barrido.`);
    return cerrar('sin-presupuesto', 0);
  }
  const criterios = leerCriterios();
  if (!criterios.length) {
    notas.push('No hay criterios vigentes en vault/criterios');
    return cerrar('sin-criterios', 0);
  }
  const vetos = leerVetos();

  // 1. recolectar
  avisar('Recolectando candidatos de Reddit, RSS y YouTube…');
  const candidatos = await recolectarCandidatos(criterios, config.maxCandidatosPorBarrido);
  const porId = new Map(candidatos.map((c) => [c.id, c]));
  avisar(`${candidatos.length} candidatos nuevos de las fuentes declaradas.`);

  // 2. descubrir: una búsqueda por criterio, con el 40 % del presupuesto repartido
  const porCriterio = Math.min(0.35, (presupuesto * 0.4) / criterios.length);
  for (const c of criterios) {
    if (presupuesto < porCriterio + 0.2) {
      notas.push(`sin presupuesto para descubrir ${c.slug}`);
      break;
    }
    avisar(`Buscando en la web para «${c.nombre}»…`);
    const r = await llamar<{ hallazgos: Hallazgo[]; nota?: string }>(promptDescubrir(c, vetos), VOZ, porCriterio, true, esquemaHallazgos, avisar);
    gastar(r);
    if (r.error) notas.push(`descubrir ${c.slug}: ${r.error}`);
    for (const h of (r.salida?.hallazgos ?? []).slice(0, 4)) {
      if (!h.url || itemsDb.existeUrl(h.url) || [...porId.values()].some((x) => x.url === h.url)) continue;
      let cand = await fichaYoutube(h.url, c.slug);
      if (!cand) {
        let host = 'web';
        try { host = new URL(h.url).hostname.replace(/^www\./, ''); } catch { continue; }
        cand = { id: idDesdeUrl(h.url), fuente: 'web', origen: host, url: h.url, titulo: h.titulo ?? h.url, autor: null, publicado: null, extracto: recortar(h.extracto), pistas: [c.slug] };
      } else if (h.extracto) cand.extracto = recortar(h.extracto);
      porId.set(cand.id, cand);
    }
    if (r.salida?.nota) notas.push(`${c.slug}: ${r.salida.nota}`);
  }
  avisar(`${porId.size} candidatos en total. Pasan al juicio en lotes de ${config.candidatosPorLote}.`);

  // 3. juzgar por lotes
  const todos = [...porId.values()];
  const lotes: Candidato[][] = [];
  for (let i = 0; i < todos.length; i += config.candidatosPorLote) lotes.push(todos.slice(i, i + config.candidatosPorLote));
  let estado = 'hecha';
  for (const [n, lote] of lotes.entries()) {
    const porLote = Math.min(0.6, presupuesto / (lotes.length - n));
    if (porLote < 0.1) {
      notas.push(`presupuesto agotado antes del lote ${n + 1} de ${lotes.length}`);
      estado = 'parcial';
      break;
    }
    avisar(`Juzgando lote ${n + 1} de ${lotes.length} (${lote.length} candidatos)…`);
    const r = await llamar<{ veredictos: Veredicto[] }>(promptJuzgar(criterios, vetos, lote), VOZ, porLote, false, esquemaVeredictos, avisar);
    gastar(r);
    if (r.error) {
      notas.push(`lote ${n + 1}: ${r.error}`);
      estado = 'parcial';
      continue;
    }
    for (const v of r.salida?.veredictos ?? []) {
      const c = porId.get(v.id);
      if (!c || !v.acepta) continue;
      const criteriosValidos = v.criterios.filter((s) => criterios.some((k) => k.slug === s));
      const puntaje = Math.max(0, Math.min(100, v.puntaje));
      const temas = (v.temas ?? []).map((t) => t.toLowerCase().trim()).filter((t) => t && t.length <= 24).slice(0, 4);
      itemsDb.insertar({ ...c, resumen: v.resumen, puntaje, puntaje_final: puntajeFinal(puntaje, criteriosValidos, c.origen), criterios: criteriosValidos, razones: v.razones, corrida, imagen: c.imagen ?? null, temas });
      aceptados++;
    }
    avisar(`Lote ${n + 1}: ${aceptados} aceptados hasta ahora (${costo.toFixed(3)} USD).`);
  }
  if (aceptados === 0 && estado === 'parcial' && notas.some((n) => /error|budget|presupuesto/i.test(n))) estado = 'error';

  // 4. fichas: portada, favicon y sitio de lo aceptado (sin modelo, una petición por ítem)
  if (aceptados > 0) {
    avisar(`Buscando portadas e iconos de ${aceptados} ítems…`);
    const n = await completarFichas(itemsDb.deCorrida(corrida));
    avisar(`${n} ítems con portada.`);
  }

  // 5. panorama: una llamada corta sin herramientas que cuenta qué entró y qué ver primero
  if (aceptados > 0 && presupuesto >= 0.15) {
    avisar('Escribiendo el panorama de hoy…');
    const entrados = itemsDb.deCorrida(corrida);
    const r = await llamar<{ panorama: string; destacado_id: string; por_que_destacado: string }>(promptPanorama(entrados), VOZ, Math.min(0.3, presupuesto), false, esquemaPanorama, avisar);
    gastar(r);
    if (r.salida?.panorama) {
      const destacado = entrados.find((i) => i.id === r.salida!.destacado_id) ?? entrados[0];
      panoramasDb.guardar(corrida, `${r.salida.panorama.trim()}\n\n${r.salida.por_que_destacado.trim()}`, destacado?.id ?? null);
    } else if (r.error) notas.push(`panorama: ${r.error}`);
  }
  return cerrar(estado, porId.size);
}

/** Completa la ficha de los ítems que no la tienen. Devuelve cuántos quedaron con portada. */
export async function completarFichas(items: { id: string; url: string; imagen: string | null }[]): Promise<number> {
  let conPortada = 0;
  // de a cinco a la vez: son sitios distintos, no hace falta ir uno por uno
  for (let i = 0; i < items.length; i += 5) {
    await Promise.all(
      items.slice(i, i + 5).map(async (it) => {
        const f = await ficha(it.url);
        itemsDb.ponerFicha(it.id, { imagen: f.imagen, icono: f.icono, sitio: f.sitio, extracto: f.descripcion, publicado: f.publicado });
        if (it.imagen || f.imagen) conPortada++;
      }),
    );
  }
  return conPortada;
}

function promptPanorama(items: { id: string; titulo: string; origen: string; puntaje_final: number; resumen: string | null; criterios: string[] }[]): string {
  const lista = items.map((i) => `- id=${i.id} [${i.origen} · ${Math.round(i.puntaje_final)}] ${i.titulo}\n  ${i.resumen ?? ''}\n  criterios: ${i.criterios.join(', ')}`).join('\n');
  return `# Lo que entró al feed en este barrido (${items.length})

${lista}

# Qué hacer

Sin herramientas. Escribe el panorama: cuatro a seis frases en nuestra voz que digan qué entró y qué hilo lo une, como
quien le cuenta a un socio lo que vale la pena hoy. Nada de listas ni de «en resumen». Luego elige el ítem que hay
que ver primero (destacado_id, con su id exacto) y di en una frase por qué.`;
}

function textoCriterios(criterios: Criterio[]): string {
  return criterios.map((c) => `## ${c.slug} — ${c.nombre} (peso ${c.peso})\nPalabras clave: ${c.palabras.join(', ')}\n${c.cuerpo}`).join('\n\n');
}

function promptDescubrir(c: Criterio, vetos: string): string {
  return `# Criterio

${textoCriterios([c])}

# Vetos globales

${vetos}

# Qué hacer

Haz UNA sola búsqueda con WebSearch para este criterio, pensada para traer lo mejor de las últimas semanas. Alterna:
si las consultas sugeridas (${c.fuentes.consultas.join(' | ') || 'ninguna'}) apuntan a video, agrega "site:youtube.com";
si no, busca en la web abierta. No hagas más de una búsqueda. Luego devuelve hasta cuatro hallazgos que de verdad
cumplan el criterio y ningún veto, con su URL exacta tal como salió en los resultados, título y un extracto de una o dos
frases. Si nada vale la pena, devuelve la lista vacía y dilo en «nota».`;
}

function promptJuzgar(criterios: Criterio[], vetos: string, lote: Candidato[]): string {
  const lista = lote
    .map((c) => `- id=${c.id} [${c.fuente} · ${c.origen}] ${c.titulo}${c.publicado ? ` (${c.publicado.slice(0, 10)})` : ''}\n  ${c.url}\n  ${c.extracto ?? ''}\n  pistas: ${c.pistas.join(', ')}`)
    .join('\n');
  return `# Criterios vigentes (del vault)

${textoCriterios(criterios)}

# Vetos globales

${vetos}

# Candidatos (${lote.length})

${lista}

# Qué hacer

Sin herramientas: juzga con el título, el extracto y lo que sabes. Devuelve un veredicto por CADA candidato, con su id
exacto. acepta=true solo si cumple al menos un criterio y ningún veto. El puntaje refleja cuánto vale para nosotros
(90+: hay que verlo; 60-89: vale la pena; menos de 60: no debería entrar, pon acepta=false). En «razones» cita el
criterio o el veto concreto: la persona va a leer por qué entró cada cosa. El resumen va en nuestra voz, tres líneas.`;
}
