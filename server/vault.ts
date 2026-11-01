/**
 * El vault propio del feed: criterios y vetos en Markdown con frontmatter YAML sencillo.
 * Lo leemos y escribimos nosotros mismos (sin dependencia de YAML completo): el frontmatter que generamos es
 * siempre un subconjunto plano, con listas en una línea o con guiones.
 */
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.ts';

export interface Criterio {
  slug: string;
  ruta: string;
  nombre: string;
  peso: number;
  estado: string;
  palabras: string[];
  fuentes: { reddit: string[]; youtube_canales: string[]; rss: string[]; consultas: string[] };
  cuerpo: string;
}

const dirCriterios = () => path.join(config.rutaVault, 'criterios');

function partirFrontmatter(texto: string): { fm: string; cuerpo: string } {
  const m = texto.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  return m ? { fm: m[1], cuerpo: m[2] } : { fm: '', cuerpo: texto };
}

/** Parser mínimo: escalares, listas en línea [a, b] y listas con guiones, un nivel de anidación. */
function parsearFm(fm: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const lineas = fm.split(/\r?\n/);
  let i = 0;
  const limpiar = (v: string) => v.trim().replace(/^["']|["']$/g, '');
  const listaEnLinea = (v: string) =>
    v
      .slice(1, -1)
      .split(',')
      .map((s) => limpiar(s))
      .filter(Boolean);
  const leerValor = (v: string, indent: number): unknown => {
    v = v.trim();
    if (v.startsWith('[')) return listaEnLinea(v);
    if (v !== '') {
      const n = Number(v);
      return Number.isNaN(n) ? limpiar(v) : n;
    }
    // bloque anidado: lista con guiones o mapa
    const lista: string[] = [];
    const mapa: Record<string, unknown> = {};
    let esLista = false;
    while (i + 1 < lineas.length) {
      const l = lineas[i + 1];
      const ind = l.search(/\S/);
      if (l.trim() === '') { i++; continue; }
      if (ind <= indent) break;
      i++;
      if (l.trim().startsWith('- ')) { esLista = true; lista.push(limpiar(l.trim().slice(2))); continue; }
      const mm = l.match(/^\s*([\w-]+):\s?(.*)$/);
      if (mm) mapa[mm[1]] = leerValor(mm[2], ind);
    }
    return esLista ? lista : mapa;
  };
  for (; i < lineas.length; i++) {
    const l = lineas[i];
    const m = l.match(/^([\w-]+):\s?(.*)$/);
    if (!m) continue;
    out[m[1]] = leerValor(m[2], 0);
  }
  return out;
}

const lista = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);

export function leerCriterios(): Criterio[] {
  const dir = dirCriterios();
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .map((f) => {
      const ruta = path.join(dir, f);
      const { fm, cuerpo } = partirFrontmatter(fs.readFileSync(ruta, 'utf8'));
      const d = parsearFm(fm);
      const fu = (d.fuentes ?? {}) as Record<string, unknown>;
      return {
        slug: f.replace(/\.md$/, ''),
        ruta,
        nombre: String(d.nombre ?? f),
        peso: typeof d.peso === 'number' ? d.peso : 1,
        estado: String(d.estado ?? 'vigente'),
        palabras: lista(d.palabras),
        fuentes: {
          reddit: lista(fu.reddit),
          youtube_canales: lista(fu.youtube_canales),
          rss: lista(fu.rss),
          consultas: lista(fu.consultas),
        },
        cuerpo: cuerpo.trim(),
      } satisfies Criterio;
    })
    .filter((c) => c.estado === 'vigente');
}

export function leerVetos(): string {
  const ruta = path.join(config.rutaVault, 'vetos.md');
  return fs.existsSync(ruta) ? partirFrontmatter(fs.readFileSync(ruta, 'utf8')).cuerpo.trim() : '';
}

/** Cambia solo la línea `peso:` del frontmatter, sin reescribir nada más del archivo. */
export function ajustarPesoCriterio(slug: string, delta: number): number | null {
  const ruta = path.join(dirCriterios(), `${slug}.md`);
  if (!fs.existsSync(ruta)) return null;
  const texto = fs.readFileSync(ruta, 'utf8');
  const m = texto.match(/^peso:\s*([\d.]+)\s*$/m);
  const actual = m ? Number(m[1]) : 1;
  const nuevo = Math.round(Math.min(2, Math.max(0.2, actual + delta)) * 100) / 100;
  const nuevoTexto = m ? texto.replace(/^peso:\s*[\d.]+\s*$/m, `peso: ${nuevo}`) : texto.replace(/^---\n/, `---\npeso: ${nuevo}\n`);
  fs.writeFileSync(ruta, nuevoTexto);
  return nuevo;
}

export function textoCriterio(slug: string): string | null {
  const ruta = path.join(dirCriterios(), `${slug}.md`);
  return fs.existsSync(ruta) ? fs.readFileSync(ruta, 'utf8') : null;
}

export function escribirCriterio(slug: string, texto: string) {
  if (!/^[a-z0-9-]+$/.test(slug)) throw new Error('slug inválido');
  fs.writeFileSync(path.join(dirCriterios(), `${slug}.md`), texto);
}

export function guardarNota(datos: { id: string; titulo: string; url: string; fuente: string; origen: string; resumen: string | null; razones: string | null; criterios: string[]; motivo: string | null }) {
  const dir = path.join(config.rutaVault, 'guardados');
  fs.mkdirSync(dir, { recursive: true });
  const fecha = new Date().toISOString().slice(0, 10);
  const slug = datos.titulo.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || datos.id;
  const ruta = path.join(dir, `${fecha}-${slug}.md`);
  const cuerpo = `---
tipo: guardado
item: ${datos.id}
fuente: ${datos.fuente}
origen: ${datos.origen}
url: ${datos.url}
criterios: [${datos.criterios.join(', ')}]
guardado: ${fecha}
---
# ${datos.titulo}

${datos.resumen ?? ''}

## Por qué entró

${datos.razones ?? ''}

## Por qué lo guardamos

${datos.motivo ?? '(sin motivo escrito)'}
`;
  fs.writeFileSync(ruta, cuerpo);
  return ruta;
}

export function listarGuardados(): { archivo: string; texto: string }[] {
  const dir = path.join(config.rutaVault, 'guardados');
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .sort()
    .reverse()
    .map((f) => ({ archivo: f, texto: fs.readFileSync(path.join(dir, f), 'utf8') }));
}
