import { lanzarBarrido } from './agente/investigador.ts';

const orden = process.argv[2];
if (orden === 'buscar') {
  const r = await lanzarBarrido('cli');
  console.log(JSON.stringify(r, null, 2));
  process.exit(r.estado === 'hecha' ? 0 : 1);
} else {
  console.log('Uso: node server/cli.ts buscar');
  process.exit(2);
}
