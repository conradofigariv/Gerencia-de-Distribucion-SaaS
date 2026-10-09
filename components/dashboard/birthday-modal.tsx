"use client";

// Cartel de feliz cumpleaños: aparece en CADA ingreso (cada carga de la app)
// el día del cumpleaños de alguien del equipo, para todos los usuarios —
// incluido el cumpleañero. Se monta una sola vez en el Header, que no se
// desmonta al cambiar de sección.
//
// Bloqueo (pedido explícito): no se cierra con X, Esc ni clic afuera, y la
// flecha del mouse desaparece en toda la página hasta que se aprieta Enter o
// se toca el botón. Cerrar la pestaña/el navegador NO se puede impedir: los
// navegadores no lo permiten (a lo sumo muestran su propio «¿Salir del
// sitio?», que igual deja salir) — ver docs en design-system.md §4.26.
//
// Video: el que subió un admin para esa persona (Configuración → Usuarios →
// editar; supabase/cumpleanos_imagenes.sql), SIEMPRE mudo y en loop — así
// arranca solo en todos los navegadores (con sonido lo bloquean hasta que la
// persona toque algo). Sin video, la foto de perfil, y sin foto, las
// iniciales. Lo subido como imagen antes de pasar a video se sigue mostrando.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Cake } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { fetchCumpleanerosDeHoy, type Cumpleanero } from "@/lib/birthdays";

const SIN_CURSOR = "gd-cumple-sin-cursor";
// Cuánto se espera a que bajen imágenes/videos antes de mostrar el cartel (así
// no aparece con el recuadro vacío). Pasado esto se muestra igual y el video
// arranca cuando llegue.
const ESPERA_MEDIA_MS = 3000;

const juntar = (xs: string[]) =>
  xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} y ${xs[xs.length - 1]}`;

type Media = { url: string; tipo: "imagen" | "video" };

/** Lo que se muestra de cada uno: su video/imagen o, si no, la foto. */
const mediaDe = (p: Cumpleanero): Media | null =>
  p.media ?? (p.avatarUrl ? { url: p.avatarUrl, tipo: "imagen" } : null);

function precargar(medias: Media[]): Promise<void> {
  if (!medias.length) return Promise.resolve();
  const todas = Promise.all(medias.map((m) => new Promise<void>((res) => {
    if (m.tipo === "video") {
      // Alcanza con el primer cuadro; el resto se sigue bajando ya visible.
      const v = document.createElement("video");
      v.preload = "auto";
      v.muted = true;
      v.onloadeddata = v.onerror = () => res();
      v.src = m.url;
    } else {
      const img = new Image();
      img.onload = img.onerror = () => res();
      img.src = m.url;
    }
  })));
  return Promise.race([todas.then(() => undefined), new Promise<void>((r) => setTimeout(r, ESPERA_MEDIA_MS))]);
}

function Retrato({ p }: { p: Cumpleanero }) {
  // Si el video/imagen no carga se pasa al siguiente: foto → iniciales.
  const [fallidos, setFallidos] = useState<string[]>([]);
  const opciones: Media[] = [p.media, p.avatarUrl ? { url: p.avatarUrl, tipo: "imagen" as const } : null]
    .filter((m): m is Media => !!m && !fallidos.includes(m.url));
  const m = opciones[0] ?? null;
  const fallo = () => m && setFallidos((f) => [...f, m.url]);
  const iniciales = p.completo.split(/\s+/).map((w) => w[0] ?? "").join("").slice(0, 2).toUpperCase();
  return (
    <figure className="gd-cumple-retrato">
      {m?.tipo === "video"
        ? (
          <video
            key={m.url}
            src={m.url}
            autoPlay
            muted
            loop
            playsInline
            disablePictureInPicture
            controls={false}
            aria-label={`Video de cumpleaños de ${p.completo}`}
            onError={fallo}
          />
        )
        : m
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={m.url} alt={`Cumpleaños de ${p.completo}`} onError={fallo} />
          : <span className="gd-cumple-iniciales" aria-hidden>{iniciales}</span>}
    </figure>
  );
}

export function BirthdayModal() {
  const [gente, setGente] = useState<Cumpleanero[] | null>(null);
  const [yoId, setYoId] = useState<string | null>(null);
  const [saliendo, setSaliendo] = useState(false);
  const botonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const [lista, { data: { user } }] = await Promise.all([fetchCumpleanerosDeHoy(), supabase.auth.getUser()]);
        if (!vivo || !lista.length) return;
        await precargar(lista.flatMap((p) => { const m = mediaDe(p); return m ? [m] : []; }));
        if (!vivo) return;
        setYoId(user?.id ?? null);
        setGente(lista);
      } catch { /* sin cartel: nunca debe trabar el ingreso */ }
    })();
    return () => { vivo = false; };
  }, []);

  const abierto = !!gente?.length;

  const cerrar = useCallback(() => {
    setSaliendo(true);
    document.documentElement.classList.remove(SIN_CURSOR);
    setTimeout(() => setGente(null), 180);
  }, []);

  // Bloqueo: sin flecha, foco atrapado en el botón, Esc anulado y ninguna
  // tecla llega a la sección de abajo (atajos del Buscador, de la grilla…).
  // Solo Enter cierra.
  useEffect(() => {
    if (!abierto || saliendo) return;
    const html = document.documentElement;
    html.classList.add(SIN_CURSOR);
    const overflowPrevio = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    botonRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      e.stopPropagation();
      if (e.key === "Enter") { e.preventDefault(); cerrar(); return; }
      if (e.key === "Escape" || e.key === "Tab") e.preventDefault();
      botonRef.current?.focus();
    };
    // Un clic afuera del botón no cierra, pero sí devuelve el foco (para que
    // Enter siga funcionando).
    const onFoco = () => requestAnimationFrame(() => botonRef.current?.focus());
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("mousedown", onFoco, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("mousedown", onFoco, true);
      html.classList.remove(SIN_CURSOR);
      document.body.style.overflow = overflowPrevio;
    };
  }, [abierto, saliendo, cerrar]);

  // Papel picado: posiciones al azar una sola vez por apertura.
  const papeles = useMemo(() => Array.from({ length: 42 }, (_, i) => ({
    left: Math.random() * 100,
    delay: Math.random() * 2.4,
    dur: 3.2 + Math.random() * 2.4,
    rot: Math.random() * 360,
    tono: i % 4,
    ancho: 6 + Math.random() * 6,
  })), [abierto]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!abierto || !gente) return null;

  const soyYo = !!yoId && gente.some((p) => p.id === yoId);
  const titulo = soyYo && gente.length === 1
    ? `¡Feliz cumpleaños, ${gente[0].nombre}!`
    : `¡Feliz cumpleaños, ${juntar(gente.map((p) => p.nombre))}!`;
  // Para el resto de la oficina alcanza con el título (se sacó «Hoy cumple
  // años X. ¡No te olvides de saludar!» a pedido); el cumpleañero sí tiene
  // una línea propia.
  const bajada = !soyYo
    ? null
    : gente.length === 1
      ? "Toda la oficina te saluda en tu día. ¡Que lo disfrutes!"
      : `Hoy es tu día, y también el de ${juntar(gente.filter((p) => p.id !== yoId).map((p) => p.completo))}. ¡Que lo disfruten!`;

  return createPortal(
    <div
      className={`ido-terminal ido-modal-overlay gd-cumple-overlay${saliendo ? " is-saliendo" : ""}`}
      role="dialog"
      aria-modal="true"
      aria-labelledby="gd-cumple-titulo"
      aria-describedby={bajada ? "gd-cumple-bajada" : undefined}
      data-k="cumple-modal"
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="gd-cumple-papeles" aria-hidden>
        {papeles.map((p, i) => (
          <span
            key={i}
            className={`gd-cumple-papel t${p.tono}`}
            style={{ left: `${p.left}%`, width: p.ancho, animationDelay: `${p.delay}s`, animationDuration: `${p.dur}s`, rotate: `${p.rot}deg` }}
          />
        ))}
      </div>

      <div className="ido-modal gd-cumple" style={{ maxWidth: gente.length > 1 ? 760 : 520 }}>
        <div className="gd-cumple-retratos" style={{ gridTemplateColumns: `repeat(${Math.min(gente.length, 3)}, minmax(0, 1fr))` }}>
          {gente.map((p) => <Retrato key={p.id} p={p} />)}
        </div>
        <div className="gd-cumple-cuerpo">
          <span className="gd-cumple-icono"><Cake className="w-5 h-5" /></span>
          <h2 id="gd-cumple-titulo" className="gd-cumple-titulo">{titulo}</h2>
          {bajada && <p id="gd-cumple-bajada" className="gd-cumple-bajada">{bajada}</p>}
        </div>
        <div className="gd-cumple-pie">
          <button ref={botonRef} type="button" className="ido-btn ido-btn-primary" style={{ height: 38, padding: "0 20px", fontSize: 13 }} onClick={cerrar}>
            ¡Feliz cumple! 🎉
          </button>
          <span className="gd-cumple-hint">Apretá <kbd>Enter</kbd> para continuar</span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
