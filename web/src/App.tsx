import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Cron } from 'croner';
import { api, haceCuanto, type Cambios, type Criterio, type Estadisticas, type Estado, type EstadoServidor, type Item, type Panorama, type TipoSenal } from './api.ts';
import { Portada, Tarjeta } from './Tarjeta.tsx';
import { Chat, preguntarAlChat } from './Chat.tsx';

type Vista = Estado | 'todos';
const VISTAS: { v: Vista; n: string }[] = [
  { v: 'nuevo', n: 'Para ver' },
  { v: 'guardado', n: 'Guardados' },
  { v: 'descartado', n: 'Descartados' },
  { v: 'todos', n: 'Todos' },
];

export function App() {
  const [vista, setVista] = useState<Vista>('nuevo');
  const [items, setItems] = useState<Item[]>([]);
  const [criterios, setCriterios] = useState<Criterio[]>([]);
  const [pesosOrigen, setPesosOrigen] = useState<{ origen: string; peso: number }[]>([]);
  const [filtroCriterio, setFiltroCriterio] = useState<string | null>(null);
  const [busqueda, setBusqueda] = useState('');
  const [estado, setEstado] = useState<EstadoServidor | null>(null);
  const [panorama, setPanorama] = useState<Panorama | null>(null);
  const [stats, setStats] = useState<Estadisticas | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [verCriterios, setVerCriterios] = useState(false);
  const [verAyuda, setVerAyuda] = useState(false);
  const [bitacora, setBitacora] = useState<{ t: string; msg: string }[]>([]);
  const [enfocado, setEnfocado] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  const buscador = useRef<HTMLInputElement>(null);

  const cargar = useCallback(async () => {
    const [i, c, e, p, s] = await Promise.all([api.items(vista, busqueda), api.criterios(), api.estado(), api.panorama(), api.estadisticas()]);
    setItems(i);
    setCriterios(c.criterios);
    setPesosOrigen(c.pesos_origen);
    setEstado(e);
    setPanorama(p);
    setStats(s);
    setCargando(false);
  }, [vista, busqueda]);

  useEffect(() => {
    const t = setTimeout(() => void cargar().catch((e) => setAviso(String(e))), busqueda ? 250 : 0);
    return () => clearTimeout(t);
  }, [cargar, busqueda]);

  // progreso del investigador en vivo; cuando termina un barrido, recargamos
  useEffect(() => {
    const es = new EventSource('/api/bitacora/stream');
    es.onmessage = (ev) => {
      const l = JSON.parse(ev.data) as { t: string; msg: string };
      setBitacora((b) => [...b.slice(-40), l]);
      if (/^(Barrido|Chat) /.test(l.msg)) void cargar();
    };
    return () => es.close();
  }, [cargar]);

  const onSenal = useCallback(
    async (id: string, tipo: TipoSenal, motivo?: string) => {
      try {
        const r: Cambios = await api.senal(id, tipo, motivo);
        const cambios = r.cambios.map((c) => `${c.criterio} → ${c.peso}`).join(', ');
        setAviso(`${etiquetaSenal(tipo)}. Pesos: ${cambios || 'sin criterios'} · origen ${r.item.origen} → ${r.pesoOrigen}${r.nota ? ' · nota guardada en el vault' : ''}`);
        await cargar();
      } catch (e) {
        setAviso(String(e));
      }
    },
    [cargar],
  );

  const lanzar = async () => {
    try {
      setAviso((await api.barrido()).mensaje);
    } catch (e) {
      setAviso(String(e));
    }
  };

  const visibles = useMemo(() => (filtroCriterio ? items.filter((i) => i.criterios.includes(filtroCriterio)) : items), [items, filtroCriterio]);
  const nombreCriterio = useCallback((slug: string) => criterios.find((c) => c.slug === slug)?.nombre ?? slug, [criterios]);
  const proximo = useMemo(() => {
    if (!estado?.cron?.trim()) return null;
    try {
      return new Cron(estado.cron).nextRun();
    } catch {
      return null;
    }
  }, [estado?.cron]);

  // atajos de teclado: j/k mover, o abrir, s guardar, d descartar, + más, - menos, p preguntar, / buscar, ? ayuda
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const enCampo = ['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName) || (e.target as HTMLElement).isContentEditable;
      if (enCampo) {
        if (e.key === 'Escape') (e.target as HTMLElement).blur();
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const idx = visibles.findIndex((i) => i.id === enfocado);
      const ir = (n: number) => {
        const sig = visibles[Math.max(0, Math.min(visibles.length - 1, n))];
        if (!sig) return;
        setEnfocado(sig.id);
        document.querySelector(`[data-id="${sig.id}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      };
      const actual = idx >= 0 ? visibles[idx] : null;
      switch (e.key) {
        case 'j': case 'ArrowDown': e.preventDefault(); ir(idx + 1); break;
        case 'k': case 'ArrowUp': e.preventDefault(); ir(idx - 1); break;
        case 'o': case 'Enter': if (actual) window.open(actual.url, '_blank', 'noopener'); break;
        case 's': if (actual && actual.estado !== 'guardado') void onSenal(actual.id, 'guardar'); break;
        case 'd': if (actual && actual.estado !== 'descartado') { void onSenal(actual.id, 'descartar'); ir(idx + 1); } break;
        case '+': case '=': if (actual) void onSenal(actual.id, 'mas'); break;
        case '-': if (actual) void onSenal(actual.id, 'menos'); break;
        case 'p': if (actual) preguntarAlChat('Cuéntame más de este ítem y por qué entró.', { kind: 'item', id: actual.id, titulo: actual.titulo, url: actual.url }); break;
        case '/': e.preventDefault(); buscador.current?.focus(); break;
        case '?': setVerAyuda((v) => !v); break;
        case 'c': setVerCriterios((v) => !v); break;
        case 'Escape': setVerAyuda(false); setVerCriterios(false); setEnfocado(null); break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [visibles, enfocado, onSenal]);

  const porVer = stats?.porEstado.nuevo ?? 0;
  const ultima = estado?.corridas.find((c) => c.estado !== 'en-curso');

  return (
    <div className="app">
      <header className="cabecera">
        <div>
          <h1>Feed propio</h1>
          <p className="sub">Curado por nuestros criterios, no por el algoritmo de nadie.</p>
        </div>
        <div className="acciones">
          <input ref={buscador} className="buscador" type="search" placeholder="Buscar en el feed  ( / )" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
          <button onClick={lanzar} disabled={estado?.en_curso} className="primario">
            {estado?.en_curso ? 'Investigando…' : 'Buscar ahora'}
          </button>
          <button onClick={() => setVerCriterios((v) => !v)} className={verCriterios ? 'activa' : ''} title="Ver criterios ( c )">Criterios</button>
          <button onClick={() => preguntarAlChat('¿Qué entró hoy y por qué?')}>Preguntar</button>
          <button onClick={() => setVerAyuda((v) => !v)} title="Atajos de teclado" aria-label="Atajos">?</button>
        </div>
      </header>

      {aviso && (
        <p className="aviso" onClick={() => setAviso(null)}>
          {aviso}
        </p>
      )}
      {bitacora.length > 0 && estado?.en_curso && (
        <pre className="bitacora">{bitacora.slice(-6).map((l) => `${l.t.slice(11, 19)}  ${l.msg}`).join('\n')}</pre>
      )}

      {stats && estado && (
        <section className="cifras">
          <Cifra n={porVer} t="para ver" />
          <Cifra n={stats.porEstado.guardado ?? 0} t="guardados" />
          <Cifra n={stats.senales} t="señales dadas" />
          <Cifra n={`${estado.gasto_hoy_usd.toFixed(2)} / ${estado.tope_usd_dia}`} t="USD hoy" />
          <Cifra n={proximo ? formatearHora(proximo) : '—'} t="próximo barrido" />
          <Cifra n={ultima ? `${ultima.aceptados}/${ultima.candidatos}` : '—'} t={ultima ? `último barrido · ${haceCuanto(ultima.inicio) ?? ''}` : 'sin barridos'} />
        </section>
      )}

      {panorama && vista === 'nuevo' && !busqueda && !filtroCriterio && (
        <section className="panorama">
          <div className="texto">
            <p className="rotulo">Panorama · {haceCuanto(panorama.creado)}</p>
            {panorama.texto.split(/\n\n+/).map((p, i) => (
              <p key={i} className={i === 0 ? 'cuerpo-panorama' : 'destacado-porque'}>{p}</p>
            ))}
            <button className="enlace" onClick={() => preguntarAlChat('Amplíame el panorama de hoy: qué conecta estas piezas y qué deberíamos hacer con eso.')}>conversar sobre esto</button>
          </div>
          {panorama.destacado && (
            <div className="destacado">
              <Portada item={panorama.destacado} grande alReproducir={() => window.open(panorama.destacado!.url, '_blank', 'noopener')} />
              <p className="rotulo">Para ver primero</p>
              <h2>
                <a href={panorama.destacado.url} target="_blank" rel="noreferrer noopener">{panorama.destacado.titulo}</a>
              </h2>
              <p className="detalle">{panorama.destacado.sitio ?? panorama.destacado.origen} · {Math.round(panorama.destacado.puntaje_final)} puntos</p>
            </div>
          )}
        </section>
      )}

      {stats && stats.temas.length > 0 && (
        <div className="temas">
          {stats.temas.map((t) => (
            <button key={t.tema} className={`tema ${busqueda === t.tema ? 'activa' : ''}`} style={{ fontSize: `${Math.min(16, 11 + t.n * 1.5)}px` }} onClick={() => setBusqueda(busqueda === t.tema ? '' : t.tema)}>
              #{t.tema} <small>{t.n}</small>
            </button>
          ))}
        </div>
      )}

      {verCriterios && (
        <div className="velo" onClick={() => setVerCriterios(false)}>
        <section className="criterios cajon" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Criterios vigentes">
          <div className="fila">
            <h2>Criterios vigentes</h2>
            <button className="cerrar" onClick={() => setVerCriterios(false)} aria-label="Cerrar">✕</button>
          </div>
          <p className="sub">
            Viven en <code>vault/criterios/*.md</code>. El peso lo mueven tus señales; puedes editarlos a mano o pedirle al chat que los cambie.
          </p>
          <ul>
            {criterios.map((c) => (
              <li key={c.slug}>
                <div className="fila">
                  <strong>{c.nombre}</strong>
                  <span className="peso" title="peso actual (0.2 a 2.0)">
                    <i style={{ width: `${(c.peso / 2) * 100}%` }} /> {c.peso.toFixed(2)}
                  </span>
                </div>
                <div className="detalle">
                  {c.fuentes.reddit.map((s) => `r/${s}`).join(' · ')}
                  {c.fuentes.youtube_canales.length ? ` · ${c.fuentes.youtube_canales.join(' ')}` : ''}
                  {c.fuentes.rss.length ? ` · ${c.fuentes.rss.length} RSS` : ''}
                  {c.fuentes.consultas.length ? ` · ${c.fuentes.consultas.length} consultas web` : ''}
                </div>
                <button className="enlace" onClick={() => preguntarAlChat(`Explícame el criterio «${c.nombre}» y propón mejoras a sus fuentes y palabras.`, { kind: 'criterio', slug: c.slug })}>
                  revisar con el chat
                </button>
              </li>
            ))}
          </ul>
          {pesosOrigen.length > 0 && (
            <p className="detalle">Pesos por origen: {pesosOrigen.map((p) => `${p.origen} ${p.peso.toFixed(2)}`).join(' · ')}</p>
          )}
        </section>
        </div>
      )}

      <nav className="pestanas">
        {VISTAS.map(({ v, n }) => (
          <button key={v} className={v === vista ? 'activa' : ''} onClick={() => setVista(v)}>
            {n}
            {v === 'nuevo' && porVer > 0 && <small className="conteo">{porVer}</small>}
          </button>
        ))}
        <span className="separador" />
        <button className={!filtroCriterio ? 'activa' : ''} onClick={() => setFiltroCriterio(null)}>
          Todos los criterios
        </button>
        {criterios.map((c) => (
          <button key={c.slug} className={filtroCriterio === c.slug ? 'activa' : ''} onClick={() => setFiltroCriterio(filtroCriterio === c.slug ? null : c.slug)} title={c.nombre}>
            {c.nombre.split(',')[0].split(' y ')[0]}
          </button>
        ))}
      </nav>

      <main className="feed">
        {cargando && items.length === 0 && [0, 1, 2, 3].map((n) => <div key={n} className="tarjeta esqueleto" />)}
        {!cargando && visibles.length === 0 && (
          <p className="vacio">
            {items.length === 0 && vista === 'nuevo' && !busqueda
              ? 'Todavía no hay nada. Pulsa «Buscar ahora» para el primer barrido, o espera al automático.'
              : busqueda
                ? `Nada que coincida con «${busqueda}».`
                : 'Nada en esta vista.'}
          </p>
        )}
        {visibles.map((i) => (
          <Tarjeta key={i.id} item={i} nombreCriterio={nombreCriterio} onSenal={onSenal} onTema={setBusqueda} enfocada={enfocado === i.id} onEnfocar={() => setEnfocado(i.id)} />
        ))}
      </main>

      {verAyuda && (
        <div className="ayuda" onClick={() => setVerAyuda(false)}>
          <div className="caja" onClick={(e) => e.stopPropagation()}>
            <h2>Atajos</h2>
            <dl>
              <dt>j / k</dt><dd>siguiente / anterior tarjeta</dd>
              <dt>o</dt><dd>abrir el enlace</dd>
              <dt>s</dt><dd>guardar</dd>
              <dt>d</dt><dd>descartar y pasar a la siguiente</dd>
              <dt>+ / −</dt><dd>más así / menos así</dd>
              <dt>p</dt><dd>preguntar al chat sobre la tarjeta</dd>
              <dt>c</dt><dd>criterios vigentes</dd>
              <dt>/</dt><dd>buscar</dd>
              <dt>?</dt><dd>esta ayuda</dd>
            </dl>
            <p className="detalle">Las señales con teclado van sin motivo. Para dejar motivo, usa los botones de la tarjeta.</p>
          </div>
        </div>
      )}

      <Chat />
    </div>
  );
}

function Cifra({ n, t }: { n: number | string; t: string }) {
  return (
    <div className="cifra">
      <strong>{n}</strong>
      <span>{t}</span>
    </div>
  );
}

function formatearHora(d: Date): string {
  const hoy = new Date();
  const hora = d.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', hour12: false });
  if (d.toDateString() === hoy.toDateString()) return `hoy ${hora}`;
  const manana = new Date(hoy);
  manana.setDate(hoy.getDate() + 1);
  if (d.toDateString() === manana.toDateString()) return `mañana ${hora}`;
  return `${d.toLocaleDateString('es-CO', { weekday: 'short' })} ${hora}`;
}

const etiquetaSenal = (t: string) => ({ guardar: 'Guardado', descartar: 'Descartado', mas: 'Más así', menos: 'Menos así' })[t] ?? t;
