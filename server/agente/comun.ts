import type { Options } from '@anthropic-ai/claude-agent-sdk';
import { config } from '../config.ts';

/** Modelos: se pueden cambiar en .env sin tocar código. El investigador corre dos veces al día; el chat, cuando preguntas. */
export const MODELO_INVESTIGADOR = process.env.MODELO_INVESTIGADOR ?? process.env.MODELO ?? 'claude-opus-5-5';
export const MODELO_CHAT = process.env.MODELO_CHAT ?? process.env.MODELO ?? 'claude-opus-5-5';

/**
 * Opciones comunes a los dos agentes. Corren sin preguntar nada (dontAsk) y solo con las herramientas que les damos.
 * Credencial: si hay ANTHROPIC_API_KEY en el entorno, el SDK la usa; si no, cae a la sesión de Claude Code del Mac.
 */
export const opcionesBase: Options = {
  cwd: config.raiz,
  settingSources: [],
  permissionMode: 'dontAsk',
  // solo nuestros servidores MCP: sin esto el CLI carga los conectores de la cuenta (cientos de herramientas, ~350k tokens por llamada)
  strictMcpConfig: true,
  tools: ['WebSearch', 'WebFetch'],
};

export function errorLegible(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  if (/not logged in|login|authentication|401|api key/i.test(m))
    return `Sin credencial para el modelo: inicia sesión con \`claude\` en este Mac o pon ANTHROPIC_API_KEY en .env. (${m})`;
  return m;
}
