import { fileURLToPath } from 'node:url';
import path from 'node:path';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const config = {
  raiz,
  puerto: Number(process.env.PUERTO ?? 4400),
  rutaVault: path.join(raiz, 'vault'),
  rutaDb: path.join(raiz, 'data', 'feed.sqlite'),
  rutaWeb: path.join(raiz, 'dist'),
  topeUsdDia: Number(process.env.TOPE_USD_DIA ?? 2),
  cronBarrido: process.env.CRON_BARRIDO ?? '0 7,19 * * *',
  /** Máximo de candidatos que se le pasan al agente por barrido, para acotar costo. */
  maxCandidatosPorBarrido: 40,
  /** Candidatos por llamada de juicio: lotes pequeños = contexto pequeño = barato y recuperable. */
  candidatosPorLote: 20,
};
