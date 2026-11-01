/**
 * Texto completo de un artículo para leerlo dentro del feed, sin salir a la página.
 * Páginas web: se baja el HTML (hasta 3 MB) y Readability extrae el cuerpo del artículo.
 * Reddit: la página bloquea clientes que no son navegador, pero el feed Atom del post trae el texto.
 * YouTube: no aplica (se reproduce embebido).
 * El HTML que devolvemos se limpia en el navegador con DOMPurify antes de pintarse.
 */
import { JSDOM, VirtualConsole } from 'jsdom';
import { Readability } from '@mozilla/readability';
import { XMLParser } from 'fast-xml-parser';
import { UA, conTiempo } from './tipos.ts';

export interface Lectura {
  titulo: string | null;
  autor: string | null;
  html: string;
  texto: string;
  palabras: number;
}

const MAX_BYTES = 3_000_000;

async function bajar(url: string, accept: string): Promise<string> {
  const ctrl = new AbortController();
  const r = await conTiempo(fetch(url, { headers: { 'User-Agent': UA, Accept: accept }, signal: ctrl.signal, redirect: 'follow' }), 15000, url);
  if (!r.ok) {
    ctrl.abort();
    throw new Error(`HTTP ${r.status}`);
  }
  const lector = r.body?.getReader();
  if (!lector) return '';
  const dec = new TextDecoder();
  let cuerpo = '';
  while (cuerpo.length < MAX_BYTES) {
    const { value, done } = await lector.read();
    if (done) break;
    cuerpo += dec.decode(value, { stream: true });
  }
  ctrl.abort();
  return cuerpo;
}

function contarPalabras(t: string): number {
  return t.split(/\s+/).filter(Boolean).length;
}

async function leerPagina(url: string): Promise<Lectura | null> {
  const html = await bajar(url, 'text/html,application/xhtml+xml');
  // jsdom sin scripts ni recursos externos: solo el árbol para Readability
  const dom = new JSDOM(html, { url, virtualConsole: new VirtualConsole() });
  const articulo = new Readability(dom.window.document, { charThreshold: 200 }).parse();
  if (!articulo?.content || !articulo.textContent?.trim()) return null;
  const texto = articulo.textContent.replace(/\s+\n/g, '\n').trim();
  return { titulo: articulo.title ?? null, autor: articulo.byline ?? null, html: articulo.content, texto, palabras: contarPalabras(texto) };
}

async function leerReddit(url: string): Promise<Lectura | null> {
  const u = new URL(url);
  const feed = `${u.origin}${u.pathname.replace(/\/?$/, '/')}.rss`;
  const xml = await bajar(feed, 'application/atom+xml,application/xml');
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', textNodeName: '#text' });
  const doc = parser.parse(xml) as { feed?: { entry?: unknown } };
  const entradas = ([] as Record<string, unknown>[]).concat((doc.feed?.entry as Record<string, unknown>[]) ?? []);
  const post = entradas[0];
  if (!post) return null;
  const contenido = post.content as { '#text'?: string } | string | undefined;
  const htmlCrudo = typeof contenido === 'string' ? contenido : (contenido?.['#text'] ?? '');
  if (!htmlCrudo) return null;
  // el feed envuelve el post en <!-- SC_OFF --><div class="md">…</div><!-- SC_ON --> seguido del enlace a los comentarios
  const dom = new JSDOM(`<body>${htmlCrudo}</body>`, { url });
  const md = dom.window.document.querySelector('.md') ?? dom.window.document.body;
  const texto = (md.textContent ?? '').trim();
  if (!texto) return null;
  const autor = (post.author as { name?: string } | undefined)?.name ?? null;
  return { titulo: (post.title as string) ?? null, autor, html: md.innerHTML, texto, palabras: contarPalabras(texto) };
}

export async function leerArticulo(url: string): Promise<Lectura | null> {
  const host = new URL(url).hostname;
  if (/(^|\.)youtube\.com$|^youtu\.be$/.test(host)) return null;
  if (/(^|\.)reddit\.com$/.test(host)) return leerReddit(url);
  return leerPagina(url);
}
