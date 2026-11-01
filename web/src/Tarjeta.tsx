import { useState } from 'react';
import type { Item, TipoSenal } from './api.ts';
import { api, haceCuanto, tonoDe } from './api.ts';
import { preguntarAlChat } from './Chat.tsx';

export const idVideo = (url: string) => {
  try {
    const u = new URL(url);
    if (u.hostname === 'youtu.be') return u.pathname.slice(1);
    if (u.hostname.endsWith('youtube.com')) return u.searchParams.get('v') ?? u.pathname.match(/\/(?:shorts|live|embed)\/([\w-]+)/)?.[1] ?? null;
  } catch { /* no es URL */ }
  return null;
};

const ETIQUETA: Record<string, string> = { youtube: 'YouTube', reddit: 'Reddit', rss: 'RSS', web: 'Web' };

export function Portada({ item, grande = false, alReproducir, alLeer }: { item: Item; grande?: boolean; alReproducir?: () => void; alLeer?: () => void }) {
  const [rota, setRota] = useState(false);
  const video = item.fuente === 'youtube' ? idVideo(item.url) : null;
  const src = item.imagen ?? (video ? `https://i.ytimg.com/vi/${video}/hqdefault.jpg` : null);
  const tono = tonoDe(item.origen);
  const inicial = (item.sitio ?? item.origen).replace(/^(r\/|yt\/)/, '').charAt(0).toUpperCase();
  const cuerpo =
    src && !rota ? (
      <img src={src} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setRota(true)} />
    ) : (
      <div className="portada-vacia" style={{ background: `linear-gradient(135deg, hsl(${tono} 45% 38%), hsl(${(tono + 40) % 360} 55% 24%))` }}>
        <span>{inicial}</span>
      </div>
    );
  if (video)
    return (
      <button className={`portada ${grande ? 'grande' : ''}`} onClick={alReproducir} aria-label="Reproducir">
        {cuerpo}
        <span className="play">▶</span>
      </button>
    );
  return (
    <a
      className={`portada ${grande ? 'grande' : ''}`}
      href={item.url}
      target="_blank"
      rel="noreferrer noopener"
      tabIndex={-1}
      onClick={(e) => {
        if (!alLeer || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        alLeer();
      }}
    >
      {cuerpo}
    </a>
  );
}

export function Tarjeta({
  item,
  nombreCriterio,
  onSenal,
  onTema,
  enfocada,
  onEnfocar,
  onLeer,
}: {
  item: Item;
  nombreCriterio: (s: string) => string;
  onSenal: (id: string, tipo: TipoSenal, motivo?: string) => void;
  onTema: (tema: string) => void;
  enfocada: boolean;
  onEnfocar: () => void;
  onLeer?: (item: Item) => void;
}) {
  const [verPorQue, setVerPorQue] = useState(false);
  const [reproducir, setReproducir] = useState(false);
  const [expandido, setExpandido] = useState(false);
  const [pidiendoMotivo, setPidiendoMotivo] = useState<null | TipoSenal>(null);
  const [motivo, setMotivo] = useState('');
  const video = item.fuente === 'youtube' ? idVideo(item.url) : null;
  const cuando = haceCuanto(item.publicado);

  const confirmar = () => {
    if (!pidiendoMotivo) return;
    onSenal(item.id, pidiendoMotivo, motivo);
    setPidiendoMotivo(null);
    setMotivo('');
  };

  return (
    <article
      className={`tarjeta ${item.visto ? 'vista' : ''} ${enfocada ? 'enfocada' : ''} ${item.estado}`}
      data-id={item.id}
      onMouseEnter={() => !item.visto && void api.visto(item.id)}
      onClick={onEnfocar}
    >
      {reproducir && video ? (
        <div className="video">
          <iframe src={`https://www.youtube-nocookie.com/embed/${video}?autoplay=1`} title={item.titulo} allow="autoplay; encrypted-media; picture-in-picture" allowFullScreen />
        </div>
      ) : (
        <Portada item={item} alReproducir={() => setReproducir(true)} alLeer={!video && onLeer ? () => onLeer(item) : undefined} />
      )}
      <div className="cuerpo">
        <div className="meta">
          {item.icono && <img className="icono" src={item.icono} alt="" width={16} height={16} onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')} />}
          <span className="origen" title={item.origen}>{item.sitio && (item.fuente === 'web' || item.fuente === 'rss') ? item.sitio : item.origen}</span>
          <span className={`fuente ${item.fuente}`}>{ETIQUETA[item.fuente]}</span>
          {item.corrida == null && <span className="fuente chat" title="Lo pediste en el chat">chat</span>}
          {cuando && <span className="fecha" title={item.publicado ?? ''}>{cuando}</span>}
          <span className="puntaje" title={`puntaje del investigador ${item.puntaje} × pesos = ${item.puntaje_final.toFixed(1)}`}>
            <svg viewBox="0 0 36 36" aria-hidden>
              <circle cx="18" cy="18" r="15.5" className="anillo-fondo" />
              <circle cx="18" cy="18" r="15.5" className="anillo" strokeDasharray={`${Math.min(100, item.puntaje_final)} 100`} pathLength={100} />
            </svg>
            {Math.round(item.puntaje_final)}
          </span>
        </div>
        <h3>
          <a
            href={item.url}
            target="_blank"
            rel="noreferrer noopener"
            title={video ? undefined : 'Leer aquí · clic con ⌘ para abrir la página'}
            onClick={(e) => {
              if (video || !onLeer || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
              e.preventDefault();
              onLeer(item);
            }}
          >
            {item.titulo}
          </a>
        </h3>
        {item.autor && item.fuente !== 'youtube' && <p className="autor">{item.autor}</p>}
        {item.resumen && (
          <p className={`resumen ${expandido ? '' : 'recortado'}`} onClick={() => setExpandido((v) => !v)}>
            {item.resumen}
          </p>
        )}
        {(item.temas.length > 0 || item.criterios.length > 0) && (
          <div className="etiquetas">
            {item.temas.map((t) => (
              <button key={t} className="tema" onClick={(e) => { e.stopPropagation(); onTema(t); }}>
                #{t}
              </button>
            ))}
            {item.criterios.map((c) => (
              <span key={c} className="chip" title="criterio que cumple">
                {nombreCriterio(c)}
              </span>
            ))}
          </div>
        )}
        {verPorQue && (
          <div className="porque">
            <p>{item.razones}</p>
            <p className="detalle">
              Puntaje del investigador {item.puntaje} · con pesos {item.puntaje_final.toFixed(1)} · origen {item.origen}
            </p>
          </div>
        )}
        {pidiendoMotivo ? (
          <div className="motivo" onClick={(e) => e.stopPropagation()}>
            <input autoFocus value={motivo} onChange={(e) => setMotivo(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') confirmar(); if (e.key === 'Escape') setPidiendoMotivo(null); }} placeholder={`Motivo (opcional) para «${pidiendoMotivo}»: afina los criterios`} />
            <button className="primario" onClick={confirmar}>Listo</button>
            <button onClick={() => setPidiendoMotivo(null)}>Cancelar</button>
          </div>
        ) : (
          <div className="botones" onClick={(e) => e.stopPropagation()}>
            {item.estado !== 'guardado' && <button title="Guardar (s)" onClick={() => setPidiendoMotivo('guardar')}>☆ Guardar</button>}
            {item.estado !== 'descartado' && <button title="Descartar (d)" onClick={() => setPidiendoMotivo('descartar')}>✕ Descartar</button>}
            <button title="Más así (+)" onClick={() => setPidiendoMotivo('mas')}>▲ Más así</button>
            <button title="Menos así (−)" onClick={() => setPidiendoMotivo('menos')}>▼ Menos</button>
            <span className="relleno" />
            <button className="enlace" onClick={() => setVerPorQue((v) => !v)}>{verPorQue ? 'ocultar' : '¿por qué entró?'}</button>
            <button className="enlace" title="Preguntar al chat (p)" onClick={() => preguntarAlChat('Cuéntame más de este ítem y por qué entró.', { kind: 'item', id: item.id, titulo: item.titulo, url: item.url })}>
              preguntar
            </button>
          </div>
        )}
      </div>
    </article>
  );
}
