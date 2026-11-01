/**
 * WebSocket con el protocolo del widget @tp3/chat-widget:
 *   cliente → {"type":"message","text":"…","sessionId":"…","context":{…}}
 *   servidor → {"type":"status","status":"typing"} · {"type":"token","text":"…"} · {"type":"done","messageId":"…"}
 */
import { WebSocketServer, type WebSocket } from 'ws';
import type { Server } from 'node:http';
import { responderChat } from './agente/chat.ts';

export function montarChat(servidor: Server) {
  const wss = new WebSocketServer({ server: servidor, path: '/ws' });
  wss.on('connection', (ws: WebSocket) => {
    let abort: AbortController | null = null;
    const enviar = (o: unknown) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(o));
    ws.on('message', async (raw) => {
      let m: { type?: string; text?: string; sessionId?: string; context?: Record<string, unknown> };
      try {
        m = JSON.parse(String(raw));
      } catch {
        return enviar({ type: 'error', message: 'JSON inválido' });
      }
      if (m.type !== 'message' || !m.text?.trim()) return;
      abort?.abort();
      abort = new AbortController();
      await responderChat(
        m.sessionId ?? 'anonima',
        m.text.trim(),
        m.context,
        {
          estado: (s) => enviar({ type: 'status', status: s }),
          token: (t) => enviar({ type: 'token', text: t }),
          listo: (id) => enviar({ type: 'done', messageId: id }),
          error: (msg) => {
            enviar({ type: 'token', text: `⚠️ ${msg}` });
            enviar({ type: 'done', messageId: `err_${Date.now()}` });
          },
        },
        abort,
      );
    });
    ws.on('close', () => abort?.abort());
  });
  return wss;
}
