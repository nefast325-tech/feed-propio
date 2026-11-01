import { lazy, Suspense } from 'react';

const ChatWidget = lazy(() => import('@tp3/chat-widget'));

const urlWs = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;

/** Manda una pregunta al widget con contexto (la misma vía que usa el widget 0.5: evento hermes-chat:ask). */
export function preguntarAlChat(text: string, context: Record<string, unknown> = {}) {
  document.dispatchEvent(new CustomEvent('hermes-chat:ask', { detail: { text, context } }));
}

export function Chat() {
  return (
    <Suspense fallback={null}>
      <ChatWidget
        hermesUrl={urlWs}
        brandName="Feed propio"
        brandSubtitle="Investigador y vault"
        agentName="Investigador"
        launcherLabel="Investigador"
        welcomeMessage="Pregúntame qué entró y por qué, pídeme que cambie un criterio, que guarde algo o que busque ahora."
        suggestions={['¿Qué entró hoy y por qué?', 'Muéstrame los criterios y sus pesos', 'Agrega r/ExperiencedDevs al criterio de agentes', 'Lanza un barrido ahora']}
        disclaimer="Agente de IA local. Lee el feed y el vault; cambia criterios solo cuando se lo pides."
        maxLength={4000}
      />
    </Suspense>
  );
}
