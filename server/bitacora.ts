/** Mensajes de progreso del investigador para mostrarlos en la interfaz y en el flujo SSE. */
type Oyente = (linea: { t: string; msg: string }) => void;
const lineas: { t: string; msg: string }[] = [];
const oyentes = new Set<Oyente>();

export const bitacora = {
  anotar(msg: string) {
    const linea = { t: new Date().toISOString(), msg };
    lineas.push(linea);
    if (lineas.length > 200) lineas.shift();
    console.log(`[investigador] ${msg}`);
    for (const o of oyentes) o(linea);
  },
  ultimas(n: number) {
    return lineas.slice(-n);
  },
  suscribir(o: Oyente) {
    oyentes.add(o);
    return () => oyentes.delete(o);
  },
};
