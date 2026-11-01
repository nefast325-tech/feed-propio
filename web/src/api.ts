export type Estado = 'nuevo' | 'guardado' | 'descartado';
export type TipoSenal = 'guardar' | 'descartar' | 'mas' | 'menos';
export interface Item {
  id: string;
  fuente: 'youtube' | 'reddit' | 'rss' | 'web';
  origen: string;
  url: string;
  titulo: string;
  autor: string | null;
  publicado: string | null;
  extracto: string | null;
  resumen: string | null;
  puntaje: number;
  puntaje_final: number;
  criterios: string[];
  razones: string | null;
  imagen: string | null;
  icono: string | null;
  sitio: string | null;
  temas: string[];
  corrida: number | null;
  estado: Estado;
  visto: number;
  creado: string;
}
export interface Criterio { slug: string; nombre: string; peso: number; palabras: string[]; fuentes: { reddit: string[]; youtube_canales: string[]; rss: string[]; consultas: string[] }; cuerpo: string }
export interface Corrida { id: number; inicio: string; fin: string | null; disparo: string; estado: string; candidatos: number; aceptados: number; costo_usd: number; turnos: number; nota: string | null }
export interface EstadoServidor { en_curso: boolean; gasto_hoy_usd: number; tope_usd_dia: number; cron: string; corridas: Corrida[]; bitacora: { t: string; msg: string }[] }
export interface Cambios { item: Item; cambios: { criterio: string; peso: number }[]; pesoOrigen: number; nota: string | null }
export interface Panorama { id: number; corrida: number; texto: string; destacado_id: string | null; creado: string; destacado: Item | null }
export interface Estadisticas { porEstado: Record<string, number>; porFuente: Record<string, number>; senales: number; temas: { tema: string; n: number }[] }

const j = async <T,>(r: Response): Promise<T> => {
  if (!r.ok) throw new Error((await r.json().catch(() => ({ error: r.statusText }))).error ?? r.statusText);
  return r.json() as Promise<T>;
};

export const api = {
  items: (estado: Estado | 'todos', q?: string) => fetch(`/api/items?estado=${estado}${q ? `&q=${encodeURIComponent(q)}` : ''}`).then((r) => j<Item[]>(r)),
  senal: (id: string, tipo: TipoSenal, motivo?: string) =>
    fetch(`/api/items/${id}/senal`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tipo, motivo }) }).then((r) => j<Cambios>(r)),
  visto: (id: string) => fetch(`/api/items/${id}/visto`, { method: 'POST' }),
  criterios: () => fetch('/api/criterios').then((r) => j<{ criterios: Criterio[]; vetos: string; pesos_origen: { origen: string; peso: number }[] }>(r)),
  estado: () => fetch('/api/estado').then((r) => j<EstadoServidor>(r)),
  panorama: () => fetch('/api/panorama').then((r) => j<Panorama | null>(r)),
  estadisticas: () => fetch('/api/estadisticas').then((r) => j<Estadisticas>(r)),
  barrido: () => fetch('/api/barrido', { method: 'POST' }).then((r) => j<{ ok: boolean; mensaje: string }>(r)),
  fichas: () => fetch('/api/items/fichas', { method: 'POST' }).then((r) => j<{ revisados: number; con_portada: number }>(r)),
};

/** «hace 3 días», «ayer», «hace 2 h» */
export function haceCuanto(iso: string | null): string | null {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms)) return null;
  const h = Math.round(ms / 3_600_000);
  if (h < 1) return 'hace un momento';
  if (h < 24) return `hace ${h} h`;
  const d = Math.round(h / 24);
  if (d === 1) return 'ayer';
  if (d < 30) return `hace ${d} días`;
  const m = Math.round(d / 30);
  return m === 1 ? 'hace un mes' : `hace ${m} meses`;
}

/** Color estable por origen para las portadas sin imagen. */
export function tonoDe(texto: string): number {
  let h = 0;
  for (let i = 0; i < texto.length; i++) h = (h * 31 + texto.charCodeAt(i)) >>> 0;
  return h % 360;
}
