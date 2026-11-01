import type { Fuente } from '../db.ts';

/** Un candidato recolectado antes de que el agente lo juzgue. */
export interface Candidato {
  id: string;
  fuente: Fuente;
  origen: string;
  url: string;
  titulo: string;
  autor: string | null;
  publicado: string | null;
  extracto: string | null;
  /** slugs de criterios cuyas fuentes lo trajeron (pista, no veredicto) */
  pistas: string[];
  /** portada si la fuente ya la trae (miniatura de YouTube, media:thumbnail, imagen del post) */
  imagen?: string | null;
}

export const UA = 'feed-propio/0.1 (lector personal; contacto en el repo local)';

export function idDesdeUrl(url: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < url.length; i++) {
    h ^= url.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36) + url.length.toString(36);
}

export function recortar(texto: string | null | undefined, max = 400): string | null {
  if (!texto) return null;
  const limpio = texto.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return limpio.length > max ? limpio.slice(0, max - 1) + '…' : limpio || null;
}

export async function conTiempo<T>(p: Promise<T>, ms: number, etiqueta: string): Promise<T> {
  let t: ReturnType<typeof setTimeout>;
  const tope = new Promise<never>((_, rej) => {
    t = setTimeout(() => rej(new Error(`tiempo agotado: ${etiqueta}`)), ms);
  });
  try {
    return await Promise.race([p, tope]);
  } finally {
    clearTimeout(t!);
  }
}
