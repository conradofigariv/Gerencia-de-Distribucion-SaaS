"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Check, ZoomIn } from "lucide-react";

// ─── Recorte de avatar (encuadrar antes de subir) ───────────────────────────
// Sin esto, la foto se sube tal cual y `AvatarImage` la recorta con
// object-cover centrado en el círculo — si lo importante de la foto no está
// centrado (una cara arriba, una foto apaisada), queda mal encuadrada en
// TODOS lados donde se muestra el avatar, y no hay forma de corregirlo salvo
// resubiendo un archivo ya recortado a mano en otro programa.
//
// Este diálogo deja panear (arrastrar) y hacer zoom sobre un círculo guía, y
// exporta exactamente lo que se ve ahí — como recorte del perfil de
// WhatsApp/Instagram al subir una foto.
//
// ── Geometría ────────────────────────────────────────────────────────────
// `BOX` es el tamaño en pantalla del área de recorte (círculo inscripto en un
// cuadrado). `baseScale` es el zoom mínimo que hace que la imagen CUBRA el
// cuadrado sin dejar bordes vacíos (equivalente a object-fit: cover). El
// slider multiplica esa base entre 1× y `ZOOM_MAX`×. El offset de paneo se
// clampea en cada cambio de escala para que la imagen nunca deje de cubrir el
// cuadrado (si no, aparecerían bordes transparentes en el recorte final).
//
// La exportación recalcula la MISMA geometría a resolución `OUTPUT` en vez de
// hacer un canvas.toBlob() del elemento en pantalla: así el archivo final
// sale a resolución fija sin importar el tamaño real de la ventana, y no
// pierde calidad por el muestreo de una captura de pantalla.

const BOX = 280;
const OUTPUT = 480;
const ZOOM_MAX = 3;

interface Props {
  file: File | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Recibe el recorte ya listo para subir (PNG, cuadrado, `OUTPUT`px). */
  onCropped: (file: File) => void;
}

export function AvatarCropDialog({ file, open, onOpenChange, onCropped }: Props) {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [baseScale, setBaseScale] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const objectUrlRef = useRef<string | null>(null);

  // Carga la imagen y arranca centrada, con el zoom mínimo que la hace cubrir
  // el círculo — el mismo punto de partida que object-fit: cover.
  useEffect(() => {
    if (!file || !open) return;
    const url = URL.createObjectURL(file);
    objectUrlRef.current = url;
    const image = new Image();
    image.onload = () => {
      setImg(image);
      setBaseScale(BOX / Math.min(image.naturalWidth, image.naturalHeight));
      setZoom(1);
      setOffset({ x: 0, y: 0 });
    };
    image.src = url;
    return () => { URL.revokeObjectURL(url); objectUrlRef.current = null; };
  }, [file, open]);

  const scale = baseScale * zoom;

  const clamp = useCallback((o: { x: number; y: number }, s: number) => {
    if (!img) return o;
    const dispW = img.naturalWidth * s;
    const dispH = img.naturalHeight * s;
    const maxX = Math.max(0, (dispW - BOX) / 2);
    const maxY = Math.max(0, (dispH - BOX) / 2);
    return { x: Math.min(maxX, Math.max(-maxX, o.x)), y: Math.min(maxY, Math.max(-maxY, o.y)) };
  }, [img]);

  const handleZoom = (v: number[]) => {
    const nz = v[0];
    setZoom(nz);
    setOffset((o) => clamp(o, baseScale * nz));
  };

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.x;
    const dy = e.clientY - dragRef.current.y;
    setOffset(clamp({ x: dragRef.current.ox + dx, y: dragRef.current.oy + dy }, scale));
  };
  const onPointerUp = () => { dragRef.current = null; };

  const confirmar = () => {
    if (!img) return;
    const canvas = document.createElement("canvas");
    canvas.width = OUTPUT; canvas.height = OUTPUT;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const out = OUTPUT / BOX;   // misma geometría que en pantalla, a resolución fija
    const dispW = img.naturalWidth * scale;
    const dispH = img.naturalHeight * scale;
    const destX = (BOX - dispW) / 2 + offset.x;
    const destY = (BOX - dispH) / 2 + offset.y;

    // Clip circular: así el archivo mismo queda como círculo (con esquinas
    // transparentes), no solo "recortado en cuadrado y redondeado por CSS" —
    // se ve bien también si algún día se usa fuera de un <Avatar>.
    ctx.beginPath();
    ctx.arc(OUTPUT / 2, OUTPUT / 2, OUTPUT / 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(img, destX * out, destY * out, dispW * out, dispH * out);

    canvas.toBlob((blob) => {
      if (!blob) return;
      onCropped(new File([blob], "avatar.png", { type: "image/png" }));
      onOpenChange(false);
    }, "image/png");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Encuadrar foto</DialogTitle>
          <DialogDescription>Arrastrá para mover y usá el control para acercar.</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col items-center gap-4 py-2">
          <div
            className="relative overflow-hidden rounded-full bg-secondary cursor-grab active:cursor-grabbing select-none touch-none"
            style={{ width: BOX, height: BOX, boxShadow: "0 0 0 9999px rgba(0,0,0,0.55)" }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerLeave={onPointerUp}
          >
            {img && (
              <img
                src={img.src}
                alt=""
                draggable={false}
                className="absolute pointer-events-none"
                style={{
                  width: img.naturalWidth * scale,
                  height: img.naturalHeight * scale,
                  left: (BOX - img.naturalWidth * scale) / 2 + offset.x,
                  top: (BOX - img.naturalHeight * scale) / 2 + offset.y,
                }}
              />
            )}
          </div>

          <div className="flex items-center gap-3 w-full px-1">
            <ZoomIn className="w-4 h-4 text-muted-foreground shrink-0" />
            <Slider min={1} max={ZOOM_MAX} step={0.01} value={[zoom]} onValueChange={handleZoom} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button variant="accent" onClick={confirmar} disabled={!img}>
            <Check className="w-4 h-4 mr-2" />Usar esta foto
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
