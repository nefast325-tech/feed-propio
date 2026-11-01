/**
 * Doctor: comprueba que esta máquina puede correr el feed con el agente conectado.
 *   node --use-system-ca --env-file-if-exists=.env scripts/doctor.ts            comprueba Node, build, vault y credencial
 *   … scripts/doctor.ts --servidor                                              además pide /api/estado al servidor local
 * Sale con 0 si todo está bien, 1 si algo falla. Pensado para que una persona o un agente lo lean sin interpretar nada.
 */
import fs from 'node:fs';
import path from 'node:path';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { config } from '../server/config.ts';
import { opcionesBase, errorLegible } from '../server/agente/comun.ts';

const conServidor = process.argv.includes('--servidor');
let fallos = 0;
const ok = (m: string) => console.log(`✓ ${m}`);
const mal = (m: string, pista?: string) => {
  fallos++;
  console.log(`✗ ${m}${pista ? `\n    → ${pista}` : ''}`);
};

// 1. Node
const mayor = Number(process.versions.node.split('.')[0]);
if (mayor >= 24) ok(`Node ${process.versions.node}`);
else mal(`Node ${process.versions.node} es viejo`, 'hace falta Node 24 o superior (brew install node, o nvm install 26)');

// 2. dependencias y build
if (fs.existsSync(path.join(config.raiz, 'node_modules', '@anthropic-ai', 'claude-agent-sdk'))) ok('dependencias instaladas');
else mal('faltan dependencias', 'npm install');
if (fs.existsSync(path.join(config.rutaWeb, 'index.html'))) ok('interfaz construida en dist/');
else mal('la interfaz no está construida', 'npm run build');

// 3. vault y datos
const criterios = fs.existsSync(path.join(config.rutaVault, 'criterios')) ? fs.readdirSync(path.join(config.rutaVault, 'criterios')).filter((f) => f.endsWith('.md')) : [];
if (criterios.length) ok(`${criterios.length} criterios en vault/criterios`);
else mal('no hay criterios en vault/criterios', 'escribe al menos uno (ver vault/README.md)');
fs.mkdirSync(path.dirname(config.rutaDb), { recursive: true });
ok(`datos en ${path.relative(config.raiz, config.rutaDb)} (tope ${config.topeUsdDia} USD/día, cron «${config.cronBarrido}», puerto ${config.puerto})`);
if (!fs.existsSync(path.join(config.raiz, '.env'))) console.log('· sin .env: se usan los valores por defecto (cp .env.example .env para cambiarlos)');

// 4. credencial del modelo: una llamada mínima, sin herramientas, con el modelo más barato
const fuente = process.env.ANTHROPIC_API_KEY ? 'ANTHROPIC_API_KEY' : 'sesión de Claude Code de esta máquina';
try {
  let respuesta = '';
  let modelo = '';
  let costo = 0;
  for await (const m of query({
    prompt: 'Responde solo con la palabra OK.',
    options: { ...opcionesBase, model: 'claude-haiku-5-5', tools: [], allowedTools: [], maxTurns: 1, maxBudgetUsd: 0.05, systemPrompt: 'Responde breve.' },
  })) {
    if (m.type === 'system' && m.subtype === 'init') modelo = m.model;
    if (m.type === 'result') {
      costo = m.total_cost_usd;
      if (m.subtype === 'success') respuesta = m.result;
      else throw new Error(`${m.subtype}: ${m.errors?.join('; ') ?? ''}`);
    }
  }
  if (/ok/i.test(respuesta)) ok(`el modelo responde (${modelo}, vía ${fuente}, ${costo.toFixed(4)} USD)`);
  else mal(`el modelo respondió algo raro: «${respuesta.slice(0, 80)}»`);
} catch (e) {
  mal(`sin credencial para el modelo (probé vía ${fuente})`, `${errorLegible(e)}\n    → o pones ANTHROPIC_API_KEY en .env, o inicias sesión con \`claude\` (comando /login) en esta máquina`);
}

// 5. servidor
if (conServidor) {
  try {
    const r = await fetch(`http://127.0.0.1:${config.puerto}/api/estado`);
    const e = (await r.json()) as { en_curso: boolean; gasto_hoy_usd: number; corridas: unknown[] };
    ok(`servidor en http://127.0.0.1:${config.puerto} (${e.corridas.length} barridos registrados, ${e.gasto_hoy_usd.toFixed(2)} USD hoy)`);
  } catch {
    mal(`no responde http://127.0.0.1:${config.puerto}`, 'npm start (o bash ops/instalar-launchagent.sh para dejarlo fijo)');
  }
}

console.log(fallos ? `\n${fallos} problema(s).` : '\nTodo listo.');
process.exit(fallos ? 1 : 0);
