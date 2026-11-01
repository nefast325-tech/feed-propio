import { query } from '@anthropic-ai/claude-agent-sdk';
for (const [etiqueta, model, tools] of [['sin herramientas', 'claude-opus-5-5', []], ['con WebSearch', 'claude-opus-5-5', ['WebSearch']]] as const) {
  const t0 = Date.now();
  for await (const m of query({
    prompt: tools.length ? 'Haz una sola búsqueda web de "Claude Agent SDK" y responde en una frase qué encontraste.' : 'Responde solo: hola.',
    options: { model, cwd: process.cwd(), settingSources: [], permissionMode: 'dontAsk', strictMcpConfig: true, systemPrompt: 'Responde breve.', tools: [...tools], allowedTools: [...tools], maxTurns: 4 },
  })) {
    if (m.type === 'system' && m.subtype === 'init') console.log(etiqueta, '| modelo', m.model, '| apiKeySource', (m as any).apiKeySource);
    if (m.type === 'result') {
      console.log(etiqueta, '| costo', m.total_cost_usd, '| turnos', m.num_turns, '| ms', Date.now() - t0);
      console.log('  usage', JSON.stringify(m.usage));
      console.log('  modelUsage', JSON.stringify((m as any).modelUsage));
    }
  }
}
