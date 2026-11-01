/**
 * Ficha de una página: portada (og:image), favicon, nombre del sitio, descripción y fecha.
 * Una sola petición GET con nuestro User-Agent, leyendo solo la cabeza del HTML. Sin modelo.
 */
import { UA, conTiempo, recortar } from './tipos.ts';
import { idVideo } from './youtube.ts';

export interface Ficha {
  imagen: string | null;
  icono: string | null;
  sitio: string | null;
  descripcion: string | null;
  publicado: string | null;
}

const vacia: Ficha = { imagen: null, icono: null, sitio: null, descripcion: null, publicado: null };

function meta(html: string, nombre: string): string | null {
  // <meta property="og:image" content="…"> en cualquier orden de atributos
  const re = new RegExp(`<meta\\s+[^>]*?(?:property|name)=["']${nombre.replace(':', '\\:')}["'][^>]*>`, 'i');
  const tag = html.match(re)?.[0];
  if (!tag) return null;
  const v = tag.match(/content=["']([^"']*)["']/i)?.[1];
  return v ? decodificar(v) : null;
}

function iconoDeclarado(html: string): string | null {
  const links = html.match(/<link\s+[^>]*rel=["'][^"']*icon[^"']*["'][^>]*>/gi) ?? [];
  // preferimos el más grande declarado (apple-touch-icon suele ser 180px)
  const apple = links.find((l) => /apple-touch-icon/i.test(l));
  const l = apple ?? links[0];
  return l?.match(/href=["']([^"']+)["']/i)?.[1] ?? null;
}

const decodificar = (s: string) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');

const absoluta = (base: string, href: string | null): string | null => {
  if (!href) return null;
  try {
    const u = new URL(href, base);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null;
  } catch {
    return null;
  }
};

export async function ficha(url: string): Promise<Ficha> {
  // YouTube: la miniatura es determinista y la página es pesada; no la pedimos
  const v = idVideo(url);
  if (v) return { ...vacia, imagen: `https://i.ytimg.com/vi/${v}/hqdefault.jpg`, icono: 'https://www.youtube.com/favicon.ico', sitio: 'YouTube' };
  let host: URL;
  try {
    host = new URL(url);
  } catch {
    return vacia;
  }
  // Reddit limita las peticiones sin cuenta; su feed ya trae lo que necesitamos
  if (/(^|\.)reddit\.com$/.test(host.hostname)) return { ...vacia, icono: 'https://www.reddit.com/favicon.ico', sitio: 'Reddit' };
  try {
    const ctrl = new AbortController();
    const r = await conTiempo(fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml' }, signal: ctrl.signal, redirect: 'follow' }), 10000, url);
    if (!r.ok || !/html/i.test(r.headers.get('content-type') ?? '')) {
      ctrl.abort();
      return { ...vacia, icono: `${host.origin}/favicon.ico` };
    }
    // solo los primeros ~200 KB: las metas viven en <head>
    const lector = r.body?.getReader();
    let html = '';
    if (lector) {
      const dec = new TextDecoder();
      while (html.length < 200_000) {
        const { value, done } = await lector.read();
        if (done) break;
        html += dec.decode(value, { stream: true });
        if (/<\/head>/i.test(html)) break;
      }
      ctrl.abort();
    }
    const base = r.url || url;
    const fecha = meta(html, 'article:published_time') ?? meta(html, 'datePublished') ?? html.match(/<time[^>]+datetime=["']([^"']+)["']/i)?.[1] ?? null;
    let publicado: string | null = null;
    if (fecha && !Number.isNaN(Date.parse(fecha))) publicado = new Date(fecha).toISOString();
    return {
      imagen: absoluta(base, meta(html, 'og:image') ?? meta(html, 'og:image:url') ?? meta(html, 'twitter:image') ?? meta(html, 'twitter:image:src')),
      icono: absoluta(base, iconoDeclarado(html)) ?? `${host.origin}/favicon.ico`,
      sitio: meta(html, 'og:site_name') ?? null,
      descripcion: recortar(meta(html, 'og:description') ?? meta(html, 'description'), 300),
      publicado,
    };
  } catch {
    return { ...vacia, icono: `${host.origin}/favicon.ico` };
  }
}
