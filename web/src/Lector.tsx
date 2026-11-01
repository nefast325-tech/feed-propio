import { useEffect, useMemo, useState } from 'react';
import DOMPurify from 'dompurify';
import { api, haceCuanto, type Item, type Lectura } from './api.ts';
import { preguntarAlChat } from './Chat.tsx';

/** Vista de lectura: el artículo completo dentro del feed, sin salir a la página. */
export function Lector({ item, onCerrar, onSenal }: { item: Item; onCerrar: () => void; onSenal: (id: string, tipo: 'guardar' | 'descartar') => void }) {
  const [lectura, setLectura] = useState<Lectura | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);

  const cargar = (otraVez = false) => {
    setCargando(true);
    setError(null);
    api
      .lectura(item.id, otraVez)
      .then((r) => (r.ok ? setLectura(r) : setError(r.motivo)))
      .catch((e) => setError(String(e)))
      .finally(() => setCargando(false));
  };
  useEffect(() => {
    cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id]);

  // el HTML viene de la página original: se limpia antes de pintarlo y los enlaces abren aparte
  const html = useMemo(() => {
    if (!lectura) return '';
    const limpio = DOMPurify.sanitize(lectura.html, { FORBID_TAGS: ['style', 'form', 'input', 'button', 'iframe', 'svg'], FORBID_ATTR: ['style', 'class', 'id', 'onclick'] });
    return limpio.replace(/<a\s/g, '<a target="_blank" rel="noreferrer noopener" ');
  }, [lectura]);

  const minutos = lectura ? Math.max(1, Math.round(lectura.palabras / 220)) : null;
  const sitio = item.sitio ?? item.origen;

  return (
    <div className="velo" onClick={onCerrar}>
      <div className="lector" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={item.titulo}>
        <div className="lector-barra">
          <span className="origen">
            {item.icono && <img className="icono" src={item.icono} alt="" width={16} height={16} />}
            {sitio}
            {lectura && <span className="detalle"> · {lectura.palabras} palabras · {minutos} min</span>}
          </span>
          <span className="lector-acciones">
            <button onClick={() => onSenal(item.id, 'guardar')} disabled={item.estado === 'guardado'}>☆ Guardar</button>
            <button onClick={() => { onSenal(item.id, 'descartar'); onCerrar(); }}>✕ Descartar</button>
            <button onClick={() => preguntarAlChat('Resume este artículo en cinco líneas y dime qué nos aporta.', { kind: 'item', id: item.id, titulo: item.titulo, url: item.url })}>preguntar</button>
            <a className="boton" href={item.url} target="_blank" rel="noreferrer noopener">abrir original ↗</a>
            <button className="cerrar" onClick={onCerrar} aria-label="Cerrar">✕</button>
          </span>
        </div>
        <article className="lector-cuerpo">
          <h1>{lectura?.titulo ?? item.titulo}</h1>
          <p className="autor">
            {(lectura?.autor ?? item.autor) && <span>{lectura?.autor ?? item.autor} · </span>}
            {haceCuanto(item.publicado) ?? ''}
          </p>
          {cargando && <p className="detalle">Bajando el artículo…</p>}
          {error && (
            <div className="aviso-lector">
              <p>{error}</p>
              <p>
                <a href={item.url} target="_blank" rel="noreferrer noopener">Abrir la página original ↗</a>
                {' · '}
                <button className="enlace" onClick={() => cargar(true)}>intentar otra vez</button>
              </p>
              {item.extracto && <p className="detalle">{item.extracto}</p>}
            </div>
          )}
          {lectura && <div className="texto" dangerouslySetInnerHTML={{ __html: html }} />}
        </article>
      </div>
    </div>
  );
}
