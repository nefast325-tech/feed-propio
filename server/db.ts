import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.ts';

export type Fuente = 'youtube' | 'reddit' | 'rss' | 'web';
export type Estado = 'nuevo' | 'guardado' | 'descartado';

export interface Item {
  id: string;
  fuente: Fuente;
  origen: string; // subreddit, canal, dominio
  url: string;
  titulo: string;
  autor: string | null;
  publicado: string | null; // ISO
  extracto: string | null;
  resumen: string | null;
  puntaje: number; // 0..100 asignado por el agente
  puntaje_final: number; // puntaje × pesos
  criterios: string[]; // slugs de criterios cumplidos
  razones: string | null;
  /** portada: og:image, miniatura del video o imagen del feed */
  imagen: string | null;
  /** favicon del sitio */
  icono: string | null;
  /** nombre legible del sitio (og:site_name) */
  sitio: string | null;
  /** etiquetas cortas que pone el investigador */
  temas: string[];
  estado: Estado;
  visto: number;
  creado: string;
  corrida: number | null;
}

export interface Senal {
  id: number;
  item_id: string;
  tipo: 'guardar' | 'descartar' | 'mas' | 'menos';
  motivo: string | null;
  creado: string;
}

fs.mkdirSync(path.dirname(config.rutaDb), { recursive: true });
export const db = new DatabaseSync(config.rutaDb);
db.exec('PRAGMA journal_mode = WAL');
db.exec(`
CREATE TABLE IF NOT EXISTS items (
  id TEXT PRIMARY KEY,
  fuente TEXT NOT NULL,
  origen TEXT NOT NULL,
  url TEXT NOT NULL UNIQUE,
  titulo TEXT NOT NULL,
  autor TEXT,
  publicado TEXT,
  extracto TEXT,
  resumen TEXT,
  puntaje REAL NOT NULL DEFAULT 0,
  puntaje_final REAL NOT NULL DEFAULT 0,
  criterios TEXT NOT NULL DEFAULT '[]',
  razones TEXT,
  estado TEXT NOT NULL DEFAULT 'nuevo',
  visto INTEGER NOT NULL DEFAULT 0,
  creado TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  corrida INTEGER
);
CREATE INDEX IF NOT EXISTS items_estado ON items(estado, puntaje_final DESC);
CREATE TABLE IF NOT EXISTS senales (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id TEXT NOT NULL REFERENCES items(id),
  tipo TEXT NOT NULL,
  motivo TEXT,
  creado TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS corridas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  inicio TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  fin TEXT,
  disparo TEXT NOT NULL,
  estado TEXT NOT NULL DEFAULT 'en-curso',
  candidatos INTEGER NOT NULL DEFAULT 0,
  aceptados INTEGER NOT NULL DEFAULT 0,
  costo_usd REAL NOT NULL DEFAULT 0,
  turnos INTEGER NOT NULL DEFAULT 0,
  nota TEXT
);
CREATE TABLE IF NOT EXISTS pesos_origen (
  origen TEXT PRIMARY KEY,
  peso REAL NOT NULL DEFAULT 1.0
);
CREATE TABLE IF NOT EXISTS panoramas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  corrida INTEGER,
  texto TEXT NOT NULL,
  destacado_id TEXT,
  creado TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS canales_youtube (
  handle TEXT PRIMARY KEY,
  canal_id TEXT NOT NULL,
  nombre TEXT,
  creado TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS lecturas (
  item_id TEXT PRIMARY KEY,
  titulo TEXT,
  autor TEXT,
  html TEXT NOT NULL,
  texto TEXT NOT NULL,
  palabras INTEGER NOT NULL,
  creado TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS conversaciones (
  sesion_widget TEXT PRIMARY KEY,
  sesion_agente TEXT,
  actualizado TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
`);

// columnas agregadas después de la primera versión: se añaden si faltan (SQLite no tiene ADD COLUMN IF NOT EXISTS)
const columnas = new Set((db.prepare('PRAGMA table_info(items)').all() as { name: string }[]).map((c) => c.name));
for (const [col, def] of [['imagen', 'TEXT'], ['icono', 'TEXT'], ['sitio', 'TEXT'], ['temas', "TEXT NOT NULL DEFAULT '[]'"], ['ficha_intentada', 'INTEGER NOT NULL DEFAULT 0']] as const) {
  if (!columnas.has(col)) db.exec(`ALTER TABLE items ADD COLUMN ${col} ${def}`);
}

type Fila = Record<string, unknown>;
const aItem = (f: Fila): Item => ({
  ...(f as unknown as Item),
  criterios: JSON.parse((f.criterios as string) || '[]'),
  temas: JSON.parse((f.temas as string) || '[]'),
});

export const itemsDb = {
  existeUrl(url: string): boolean {
    return !!db.prepare('SELECT 1 FROM items WHERE url = ?').get(url);
  },
  urlsConocidas(urls: string[]): Set<string> {
    if (!urls.length) return new Set();
    const marcas = urls.map(() => '?').join(',');
    const filas = db.prepare(`SELECT url FROM items WHERE url IN (${marcas})`).all(...urls) as Fila[];
    return new Set(filas.map((f) => f.url as string));
  },
  insertar(i: Omit<Item, 'creado' | 'visto' | 'estado' | 'puntaje_final' | 'imagen' | 'icono' | 'sitio' | 'temas'> & { puntaje_final?: number; imagen?: string | null; icono?: string | null; sitio?: string | null; temas?: string[] }) {
    db.prepare(
      `INSERT OR IGNORE INTO items (id,fuente,origen,url,titulo,autor,publicado,extracto,resumen,puntaje,puntaje_final,criterios,razones,corrida,imagen,icono,sitio,temas)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(i.id, i.fuente, i.origen, i.url, i.titulo, i.autor, i.publicado, i.extracto, i.resumen, i.puntaje, i.puntaje_final ?? i.puntaje, JSON.stringify(i.criterios), i.razones, i.corrida, i.imagen ?? null, i.icono ?? null, i.sitio ?? null, JSON.stringify(i.temas ?? []));
  },
  /** Completa portada, favicon y nombre del sitio (lo que trae la ficha Open Graph). */
  ponerFicha(id: string, f: { imagen?: string | null; icono?: string | null; sitio?: string | null; extracto?: string | null; publicado?: string | null }) {
    db.prepare(
      `UPDATE items SET imagen = COALESCE(?, imagen), icono = COALESCE(?, icono), sitio = COALESCE(?, sitio),
         extracto = COALESCE(extracto, ?), publicado = COALESCE(publicado, ?), ficha_intentada = 1 WHERE id = ?`,
    ).run(f.imagen ?? null, f.icono ?? null, f.sitio ?? null, f.extracto ?? null, f.publicado ?? null, id);
  },
  sinFicha(limite = 30): Item[] {
    return (db.prepare('SELECT * FROM items WHERE ficha_intentada = 0 ORDER BY creado DESC LIMIT ?').all(limite) as Fila[]).map(aItem);
  },
  deCorrida(corrida: number): Item[] {
    return (db.prepare('SELECT * FROM items WHERE corrida = ? ORDER BY puntaje_final DESC').all(corrida) as Fila[]).map(aItem);
  },
  estadisticas() {
    const porEstado = Object.fromEntries((db.prepare('SELECT estado, COUNT(*) n FROM items GROUP BY estado').all() as { estado: string; n: number }[]).map((f) => [f.estado, f.n]));
    const porFuente = Object.fromEntries((db.prepare(`SELECT fuente, COUNT(*) n FROM items WHERE estado != 'descartado' GROUP BY fuente`).all() as { fuente: string; n: number }[]).map((f) => [f.fuente, f.n]));
    const senales = (db.prepare('SELECT COUNT(*) n FROM senales').get() as { n: number }).n;
    const temas = db.prepare(`SELECT j.value tema, COUNT(*) n FROM items, json_each(items.temas) j WHERE items.estado != 'descartado' GROUP BY j.value ORDER BY n DESC, tema LIMIT 24`).all() as { tema: string; n: number }[];
    return { porEstado, porFuente, senales, temas };
  },
  listar(estado: Estado | 'todos' = 'nuevo', limite = 100, q?: string): Item[] {
    const cond: string[] = [];
    const args: (string | number)[] = [];
    if (estado !== 'todos') { cond.push('estado = ?'); args.push(estado); }
    if (q?.trim()) {
      const like = `%${q.trim()}%`;
      cond.push('(titulo LIKE ? OR resumen LIKE ? OR razones LIKE ? OR origen LIKE ? OR temas LIKE ?)');
      args.push(like, like, like, like, like);
    }
    const sql = `SELECT * FROM items ${cond.length ? 'WHERE ' + cond.join(' AND ') : ''} ORDER BY puntaje_final DESC, creado DESC LIMIT ?`;
    return (db.prepare(sql).all(...args, limite) as Fila[]).map(aItem);
  },
  porId(id: string): Item | null {
    const f = db.prepare('SELECT * FROM items WHERE id = ?').get(id) as Fila | undefined;
    return f ? aItem(f) : null;
  },
  cambiarEstado(id: string, estado: Estado) {
    db.prepare('UPDATE items SET estado = ? WHERE id = ?').run(estado, id);
  },
  marcarVisto(id: string) {
    db.prepare('UPDATE items SET visto = 1 WHERE id = ?').run(id);
  },
  recalcularFinal(id: string, puntajeFinal: number) {
    db.prepare('UPDATE items SET puntaje_final = ? WHERE id = ?').run(puntajeFinal, id);
  },
  buscar(texto: string, limite = 20): Item[] {
    const q = `%${texto}%`;
    return (db.prepare('SELECT * FROM items WHERE titulo LIKE ? OR resumen LIKE ? OR razones LIKE ? ORDER BY puntaje_final DESC LIMIT ?').all(q, q, q, limite) as Fila[]).map(aItem);
  },
};

export const senalesDb = {
  registrar(itemId: string, tipo: Senal['tipo'], motivo: string | null) {
    db.prepare('INSERT INTO senales (item_id, tipo, motivo) VALUES (?,?,?)').run(itemId, tipo, motivo);
  },
  recientes(limite = 50): (Senal & { titulo: string; criterios: string[]; origen: string })[] {
    return (
      db
        .prepare(
          `SELECT s.*, i.titulo, i.criterios, i.origen FROM senales s JOIN items i ON i.id = s.item_id ORDER BY s.id DESC LIMIT ?`,
        )
        .all(limite) as Fila[]
    ).map((f) => ({ ...(f as unknown as Senal & { titulo: string; origen: string }), criterios: JSON.parse((f.criterios as string) || '[]') }));
  },
};

export const corridasDb = {
  abrir(disparo: 'cron' | 'manual' | 'cli'): number {
    const r = db.prepare('INSERT INTO corridas (disparo) VALUES (?)').run(disparo);
    return Number(r.lastInsertRowid);
  },
  cerrar(id: number, datos: { estado: string; candidatos: number; aceptados: number; costo_usd: number; turnos: number; nota?: string }) {
    db.prepare(
      `UPDATE corridas SET fin = strftime('%Y-%m-%dT%H:%M:%fZ','now'), estado=?, candidatos=?, aceptados=?, costo_usd=?, turnos=?, nota=? WHERE id=?`,
    ).run(datos.estado, datos.candidatos, datos.aceptados, datos.costo_usd, datos.turnos, datos.nota ?? null, id);
  },
  gastoHoy(): number {
    const f = db.prepare(`SELECT COALESCE(SUM(costo_usd),0) g FROM corridas WHERE date(inicio,'localtime') = date('now','localtime')`).get() as Fila;
    return Number(f.g);
  },
  recientes(limite = 10) {
    return db.prepare('SELECT * FROM corridas ORDER BY id DESC LIMIT ?').all(limite) as Fila[];
  },
  enCurso(): boolean {
    return !!db.prepare(`SELECT 1 FROM corridas WHERE estado = 'en-curso'`).get();
  },
  abortarColgadas() {
    db.prepare(`UPDATE corridas SET estado='abortada', fin=strftime('%Y-%m-%dT%H:%M:%fZ','now'), nota='quedó en curso al reiniciar el servidor' WHERE estado='en-curso'`).run();
  },
};

export const pesosOrigenDb = {
  peso(origen: string): number {
    const f = db.prepare('SELECT peso FROM pesos_origen WHERE origen = ?').get(origen) as Fila | undefined;
    return f ? Number(f.peso) : 1;
  },
  ajustar(origen: string, delta: number) {
    const actual = this.peso(origen);
    const nuevo = Math.min(2, Math.max(0.2, actual + delta));
    db.prepare('INSERT INTO pesos_origen (origen, peso) VALUES (?,?) ON CONFLICT(origen) DO UPDATE SET peso = excluded.peso').run(origen, nuevo);
    return nuevo;
  },
  todos(): { origen: string; peso: number }[] {
    return db.prepare('SELECT origen, peso FROM pesos_origen ORDER BY peso DESC').all() as { origen: string; peso: number }[];
  },
};

export const panoramasDb = {
  guardar(corrida: number, texto: string, destacadoId: string | null) {
    db.prepare('INSERT INTO panoramas (corrida, texto, destacado_id) VALUES (?,?,?)').run(corrida, texto, destacadoId);
  },
  ultimo(): { id: number; corrida: number; texto: string; destacado_id: string | null; creado: string } | null {
    return (db.prepare('SELECT * FROM panoramas ORDER BY id DESC LIMIT 1').get() as never) ?? null;
  },
};

export const canalesDb = {
  buscar(handle: string): string | null {
    const f = db.prepare('SELECT canal_id FROM canales_youtube WHERE handle = ?').get(handle) as Fila | undefined;
    return (f?.canal_id as string) ?? null;
  },
  guardar(handle: string, canalId: string, nombre: string | null) {
    db.prepare('INSERT OR REPLACE INTO canales_youtube (handle, canal_id, nombre) VALUES (?,?,?)').run(handle, canalId, nombre);
  },
};

export interface LecturaGuardada { item_id: string; titulo: string | null; autor: string | null; html: string; texto: string; palabras: number; creado: string }
export const lecturasDb = {
  buscar(itemId: string): LecturaGuardada | null {
    return (db.prepare('SELECT * FROM lecturas WHERE item_id = ?').get(itemId) as never) ?? null;
  },
  guardar(itemId: string, l: { titulo: string | null; autor: string | null; html: string; texto: string; palabras: number }) {
    db.prepare('INSERT OR REPLACE INTO lecturas (item_id, titulo, autor, html, texto, palabras) VALUES (?,?,?,?,?,?)').run(itemId, l.titulo, l.autor, l.html, l.texto, l.palabras);
  },
  borrar(itemId: string) {
    db.prepare('DELETE FROM lecturas WHERE item_id = ?').run(itemId);
  },
};

export const conversacionesDb = {
  sesionAgente(sesionWidget: string): string | null {
    const f = db.prepare('SELECT sesion_agente FROM conversaciones WHERE sesion_widget = ?').get(sesionWidget) as Fila | undefined;
    return (f?.sesion_agente as string) ?? null;
  },
  guardar(sesionWidget: string, sesionAgente: string) {
    db.prepare(
      `INSERT INTO conversaciones (sesion_widget, sesion_agente) VALUES (?,?)
       ON CONFLICT(sesion_widget) DO UPDATE SET sesion_agente = excluded.sesion_agente, actualizado = strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
    ).run(sesionWidget, sesionAgente);
  },
};
