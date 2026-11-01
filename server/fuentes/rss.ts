import { XMLParser } from 'fast-xml-parser';
import { UA, idDesdeUrl, recortar, conTiempo, type Candidato } from './tipos.ts';
import type { Fuente } from '../db.ts';

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', textNodeName: '#text' });

const texto = (v: unknown): string | null => {
  if (v == null) return null;
  if (typeof v === 'string') return v;
  if (typeof v === 'object' && '#text' in (v as Record<string, unknown>)) return String((v as Record<string, unknown>)['#text']);
  if (Array.isArray(v)) return texto(v[0]);
  return String(v);
};

/** Imagen que ya viene en la entrada: media:thumbnail, media:content, enclosure o el primer <img> del cuerpo. */
const imagenDe = (e: Record<string, any>, cuerpo: string | null): string | null => {
  const url = (v: unknown): string | null => {
    const arr = Array.isArray(v) ? v : v ? [v] : [];
    for (const x of arr) {
      const u = typeof x === 'object' ? (x as Record<string, string>)['@_url'] : null;
      if (u && /^https?:/.test(u)) return u;
    }
    return null;
  };
  const media = e['media:group']?.['media:thumbnail'] ?? e['media:thumbnail'];
  const contenido = [].concat(e['media:content'] ?? []).filter((m: Record<string, string>) => !m['@_type'] || /^image/.test(m['@_type']));
  const enclosure = [].concat(e.enclosure ?? []).filter((m: Record<string, string>) => /^image/.test(m['@_type'] ?? ''));
  const img = cuerpo?.match(/<img[^>]+src=["'](https?:[^"']+)["']/i)?.[1] ?? null;
  // Reddit pone la miniatura como <img> dentro del cuerpo: sirve, pero no las de tamaño «thumbnail» externas
  return url(media) ?? url(contenido) ?? url(enclosure) ?? (img && !/external-preview/.test(img) ? img : null);
};

const enlace = (v: unknown): string | null => {
  if (!v) return null;
  if (typeof v === 'string') return v;
  const arr = Array.isArray(v) ? v : [v];
  const alt = arr.find((l) => typeof l === 'object' && ((l as Record<string, string>)['@_rel'] ?? 'alternate') === 'alternate');
  const l = (alt ?? arr[0]) as Record<string, string> | string;
  return typeof l === 'string' ? l : l['@_href'] ?? texto(l);
};

export interface OpcionesRss {
  fuente?: Fuente;
  limite?: number;
  /** origen fijo, o una función que lo saque de la entrada (p. ej. la categoría de un multireddit) */
  origen?: string | ((entrada: Record<string, any>) => string | null);
  /** si es true, los errores HTTP se lanzan en vez de registrarse y devolver [] */
  propagar?: boolean;
}

export class ErrorHttp extends Error {
  status: number;
  constructor(status: number, url: string) {
    super(`rss ${status}${status === 429 ? ' (nos pidieron bajar el ritmo)' : ''} ${url}`);
    this.status = status;
  }
}

/** Lee RSS 2.0 o Atom. Sirve también para los feeds de canales de YouTube y los de Reddit. */
export async function recolectarRss(url: string, pista: string, opciones: OpcionesRss = {}): Promise<Candidato[]> {
  const { fuente = 'rss', limite = 15, origen, propagar = false } = opciones;
  try {
    const r = await conTiempo(fetch(url, { headers: { 'User-Agent': UA } }), 12000, url);
    if (!r.ok) throw new ErrorHttp(r.status, url);
    const doc = parser.parse(await r.text()) as Record<string, any>;
    const canal = doc.rss?.channel ?? doc.feed;
    if (!canal) return [];
    const nombre = texto(canal.title) ?? new URL(url).hostname;
    const entradas: Record<string, any>[] = [].concat(canal.item ?? canal.entry ?? []);
    return entradas.slice(0, limite).flatMap((e) => {
      const href = enlace(e.link);
      const titulo = texto(e.title);
      if (!href || !titulo) return [];
      const fecha = texto(e.pubDate ?? e.published ?? e.updated ?? e['dc:date']);
      const crudo = e['media:group']?.['media:description'] ?? e.description ?? e.summary ?? e.content;
      const cuerpo = texto(crudo);
      const autor = texto(e.author?.name ?? e.author ?? e['dc:creator']);
      const origenEntrada = typeof origen === 'function' ? origen(e) : origen;
      return [
        {
          id: idDesdeUrl(href),
          fuente,
          origen: origenEntrada ?? (fuente === 'youtube' ? `yt/${nombre}` : nombre),
          url: href,
          titulo,
          autor,
          publicado: fecha ? new Date(fecha).toISOString() : null,
          extracto: recortar(cuerpo),
          pistas: [pista],
          imagen: imagenDe(e, cuerpo),
        } satisfies Candidato,
      ];
    });
  } catch (e) {
    if (propagar) throw e;
    console.warn('[rss]', (e as Error).message);
    return [];
  }
}
