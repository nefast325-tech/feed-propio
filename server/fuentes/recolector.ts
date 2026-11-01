import type { Criterio } from '../vault.ts';
import type { Candidato } from './tipos.ts';
import { recolectarReddit } from './reddit.ts';
import { recolectarRss } from './rss.ts';
import { recolectarCanalYoutube } from './youtube.ts';
import { itemsDb } from '../db.ts';

/** Primera pasada, sin modelo: trae lo nuevo de las fuentes declaradas en cada criterio y descarta lo ya visto. */
export async function recolectarCandidatos(criterios: Criterio[], maximo: number): Promise<Candidato[]> {
  const tareas: Promise<Candidato[]>[] = [];
  for (const c of criterios) {
    if (c.fuentes.reddit.length) tareas.push(recolectarReddit(c.fuentes.reddit, c.slug));
    for (const url of c.fuentes.rss) tareas.push(recolectarRss(url, c.slug));
    for (const canal of c.fuentes.youtube_canales) tareas.push(recolectarCanalYoutube(canal, c.slug));
  }
  const resultados = (await Promise.allSettled(tareas)).flatMap((r) => (r.status === 'fulfilled' ? r.value : []));

  // fusionar duplicados (misma URL traída por dos criterios) sumando pistas
  const porUrl = new Map<string, Candidato>();
  for (const c of resultados) {
    const previo = porUrl.get(c.url);
    if (previo) previo.pistas = [...new Set([...previo.pistas, ...c.pistas])];
    else porUrl.set(c.url, { ...c });
  }
  const conocidas = itemsDb.urlsConocidas([...porUrl.keys()]);
  const nuevos = [...porUrl.values()].filter((c) => !conocidas.has(c.url));

  // prioridad: coincidencia de palabras clave del criterio, después recencia
  const puntuar = (c: Candidato) => {
    const texto = `${c.titulo} ${c.extracto ?? ''}`.toLowerCase();
    let hits = 0;
    for (const slug of c.pistas) {
      const cr = criterios.find((k) => k.slug === slug);
      for (const p of cr?.palabras ?? []) if (texto.includes(p.toLowerCase())) hits++;
    }
    const edadDias = c.publicado ? (Date.now() - new Date(c.publicado).getTime()) / 86_400_000 : 30;
    return hits * 10 - Math.min(edadDias, 60);
  };
  // máximo ocho por origen para que un diario o un subreddit activo no acapare el barrido
  const porOrigen = new Map<string, number>();
  return nuevos
    .filter((c) => !c.publicado || Date.now() - new Date(c.publicado).getTime() < 90 * 86_400_000)
    .sort((a, b) => puntuar(b) - puntuar(a))
    .filter((c) => {
      const n = (porOrigen.get(c.origen) ?? 0) + 1;
      porOrigen.set(c.origen, n);
      return n <= 8;
    })
    .slice(0, maximo);
}
