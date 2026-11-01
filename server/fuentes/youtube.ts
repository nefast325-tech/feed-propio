import { UA, idDesdeUrl, recortar, conTiempo, type Candidato } from './tipos.ts';
import { recolectarRss } from './rss.ts';
import { canalesDb } from '../db.ts';

/**
 * En el criterio se puede escribir el canal como id (UC…) o como handle (@nombre). El handle se resuelve una vez
 * leyendo la página pública del canal y se guarda en SQLite.
 */
export async function resolverCanal(canal: string): Promise<string | null> {
  const limpio = canal.trim();
  if (/^UC[\w-]{22}$/.test(limpio)) return limpio;
  const handle = limpio.replace(/^https?:\/\/(www\.)?youtube\.com\//, '').replace(/^@?/, '@').replace(/\/.*$/, '');
  const cache = canalesDb.buscar(handle);
  if (cache) return cache;
  try {
    const r = await conTiempo(fetch(`https://www.youtube.com/${handle}`, { headers: { 'User-Agent': UA, 'Accept-Language': 'es' } }), 12000, handle);
    if (!r.ok) throw new Error(`${r.status}`);
    const html = await r.text();
    const id = html.match(/"(?:channelId|externalId)":"(UC[\w-]{22})"/)?.[1];
    if (!id) throw new Error('sin channelId en la página');
    const nombre = html.match(/<meta property="og:title" content="([^"]+)"/)?.[1] ?? null;
    canalesDb.guardar(handle, id, nombre);
    console.log(`[youtube] ${handle} → ${id}${nombre ? ` (${nombre})` : ''}`);
    return id;
  } catch (e) {
    console.warn(`[youtube] no pude resolver ${handle}: ${(e as Error).message}`);
    return null;
  }
}

/** Feed público del canal: no necesita llave de API. */
export async function recolectarCanalYoutube(canal: string, pista: string): Promise<Candidato[]> {
  const id = await resolverCanal(canal);
  if (!id) return [];
  return recolectarRss(`https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(id)}`, pista, { fuente: 'youtube', limite: 10 });
}

export function idVideo(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname === 'youtu.be') return u.pathname.slice(1) || null;
    if (u.hostname.endsWith('youtube.com')) {
      if (u.pathname === '/watch') return u.searchParams.get('v');
      const m = u.pathname.match(/^\/(shorts|live|embed)\/([\w-]{6,})/);
      if (m) return m[2];
    }
  } catch {
    /* no es URL */
  }
  return null;
}

/** Ficha de un video por oEmbed (título, canal, miniatura), sin llave. */
export async function fichaYoutube(url: string, pista: string): Promise<Candidato | null> {
  const v = idVideo(url);
  if (!v) return null;
  const canonica = `https://www.youtube.com/watch?v=${v}`;
  try {
    const r = await conTiempo(fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(canonica)}&format=json`, { headers: { 'User-Agent': UA } }), 10000, canonica);
    if (!r.ok) return null;
    const j = (await r.json()) as { title: string; author_name: string; thumbnail_url?: string };
    return {
      id: idDesdeUrl(canonica),
      fuente: 'youtube',
      origen: `yt/${j.author_name}`,
      url: canonica,
      titulo: j.title,
      autor: j.author_name,
      publicado: null,
      extracto: recortar(`Video de ${j.author_name}.`),
      pistas: [pista],
      imagen: j.thumbnail_url ?? `https://i.ytimg.com/vi/${v}/hqdefault.jpg`,
    };
  } catch {
    return null;
  }
}
