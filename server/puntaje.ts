import { itemsDb, pesosOrigenDb, senalesDb, type Item, type Senal } from './db.ts';
import { ajustarPesoCriterio, guardarNota, leerCriterios } from './vault.ts';

/** puntaje_final = puntaje del agente × promedio de pesos de los criterios cumplidos × peso del origen. */
export function puntajeFinal(puntaje: number, criterios: string[], origen: string): number {
  const todos = leerCriterios();
  const pesos = criterios.map((s) => todos.find((c) => c.slug === s)?.peso ?? 1);
  const pesoCriterios = pesos.length ? pesos.reduce((a, b) => a + b, 0) / pesos.length : 1;
  return Math.round(puntaje * pesoCriterios * pesosOrigenDb.peso(origen) * 10) / 10;
}

const DELTA: Record<Senal['tipo'], { criterio: number; origen: number }> = {
  guardar: { criterio: 0.05, origen: 0.05 },
  mas: { criterio: 0.1, origen: 0.08 },
  descartar: { criterio: -0.03, origen: -0.05 },
  menos: { criterio: -0.1, origen: -0.1 },
};

/**
 * Una señal tuya mueve los pesos (criterios en el vault, origen en la base) y, si guardas, deja nota en el vault.
 * Devuelve qué cambió para que la interfaz lo muestre: el algoritmo se explica, no se esconde.
 */
export function aplicarSenal(itemId: string, tipo: Senal['tipo'], motivo: string | null) {
  const item = itemsDb.porId(itemId);
  if (!item) throw new Error('ítem no encontrado');
  senalesDb.registrar(itemId, tipo, motivo);
  const d = DELTA[tipo];
  const cambios: { criterio: string; peso: number }[] = [];
  for (const slug of item.criterios) {
    const nuevo = ajustarPesoCriterio(slug, d.criterio);
    if (nuevo != null) cambios.push({ criterio: slug, peso: nuevo });
  }
  const pesoOrigen = pesosOrigenDb.ajustar(item.origen, d.origen);
  let nota: string | null = null;
  if (tipo === 'guardar') {
    itemsDb.cambiarEstado(itemId, 'guardado');
    nota = guardarNota({ ...item, motivo });
  } else if (tipo === 'descartar') {
    itemsDb.cambiarEstado(itemId, 'descartado');
  }
  // reordenar lo pendiente con los pesos nuevos
  for (const i of itemsDb.listar('nuevo', 500)) itemsDb.recalcularFinal(i.id, puntajeFinal(i.puntaje, i.criterios, i.origen));
  return { item: itemsDb.porId(itemId) as Item, cambios, pesoOrigen, nota };
}
