/**
 * Reddit se lee por sus feeds Atom públicos, que aceptan un lector con User-Agent propio. Los endpoints .json
 * devuelven 403/404 a cualquier cliente que no sea el sitio, y no vamos a hacernos pasar por navegador.
 *
 * Sin cuenta el límite es estrecho (~10 peticiones por minuto y menos por hora), así que:
 *   - un criterio = UNA petición: multireddit r/a+b+c/top/.rss, y el origen sale de la <category> de cada entrada;
 *   - una petición a la vez, diez segundos entre ellas;
 *   - ante un 429 esperamos un minuto y reintentamos una sola vez.
 * Si Reddit llega a cerrar también los feeds, el camino limpio es registrar una app en reddit.com/prefs/apps y usar
 * su API con OAuth.
 */
import type { Candidato } from './tipos.ts';
import { recolectarRss, ErrorHttp } from './rss.ts';

let enVuelo = 0;
const cola: (() => void)[] = [];
async function turno() {
  if (enVuelo >= 1) await new Promise<void>((res) => cola.push(res));
  enVuelo++;
}
function soltar() {
  enVuelo--;
  setTimeout(() => cola.shift()?.(), 10_000);
}
const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

const origenDeEntrada = (e: Record<string, any>): string | null => {
  const cat = Array.isArray(e.category) ? e.category[0] : e.category;
  const label: string | undefined = cat?.['@_label'] ?? (cat?.['@_term'] ? `r/${cat['@_term']}` : undefined);
  return label ?? null;
};

/** Lo mejor de la semana en varios subreddits con una sola petición. */
export async function recolectarReddit(subreddits: string[], pista: string, limitePorSub = 8): Promise<Candidato[]> {
  if (!subreddits.length) return [];
  const limite = Math.min(100, subreddits.length * limitePorSub);
  const url = `https://www.reddit.com/r/${subreddits.map(encodeURIComponent).join('+')}/top/.rss?t=week&limit=${limite}`;
  const opciones = { fuente: 'reddit' as const, limite, origen: origenDeEntrada, propagar: true };
  await turno();
  try {
    try {
      return await recolectarRss(url, pista, opciones);
    } catch (e) {
      if (!(e instanceof ErrorHttp && e.status === 429)) throw e;
      console.warn(`[reddit] 429 en r/${subreddits.join('+')}: esperamos un minuto y reintentamos una vez`);
      await esperar(60_000);
      return await recolectarRss(url, pista, opciones);
    }
  } catch (e) {
    console.warn('[reddit]', (e as Error).message);
    return [];
  } finally {
    soltar();
  }
}
