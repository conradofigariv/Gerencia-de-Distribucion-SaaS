"use client";

import { useEffect, useRef } from "react";
import { createNoise2D, createNoise3D } from "simplex-noise";

export type BgEffect = "pipeline" | "aurora" | "swirl" | "coalesce" | "shift" | "none";

// ── Shared utils ──────────────────────────────────────────────────────────────
const TAU      = Math.PI * 2;
const HALF_PI  = Math.PI * 0.5;
const TO_RAD   = Math.PI / 180;
const rand     = (n: number) => Math.random() * n;
const randRange= (n: number) => n - rand(2 * n);
const lerp     = (a: number, b: number, t: number) => (1 - t) * a + t * b;
const fadeInOut= (t: number, m: number) => { const hm = 0.5 * m; return Math.abs((t + hm) % m - hm) / hm; };
const angle    = (x1: number, y1: number, x2: number, y2: number) => Math.atan2(y2 - y1, x2 - x1);

// ── PIPELINE ──────────────────────────────────────────────────────────────────
function runPipeline(b: HTMLCanvasElement) {
  const a = document.createElement("canvas");
  const ca = a.getContext("2d")!;
  const cb = b.getContext("2d")!;
  const N = 30, P = 8;
  const turnAmt = (360 / 8) * TO_RAD;
  let tick = 0, w = 0, h = 0, cx = 0, cy = 0;
  let props = new Float32Array(N * P);

  function resize() {
    w = b.width = a.width = window.innerWidth;
    h = b.height = a.height = window.innerHeight;
    cx = w / 2; cy = h / 2;
  }
  function initPipe(i: number) {
    props.set([rand(w), cy, Math.round(rand(1)) ? HALF_PI : TAU - HALF_PI,
      0.5 + rand(1), 0, 100 + rand(300), 2 + rand(4), 180 + rand(60)], i);
  }
  resize();
  for (let i = 0; i < N * P; i += P) initPipe(i);

  let raf: number;
  function draw() {
    tick++;
    for (let i = 0; i < N * P; i += P) {
      let [x, y, dir, speed, life, ttl, width, hue] = Array.from(props.slice(i, i + P));
      ca.save();
      ca.strokeStyle = `hsla(${hue},75%,50%,${fadeInOut(life, ttl) * 0.125})`;
      ca.beginPath(); ca.arc(x, y, width, 0, TAU); ca.stroke(); ca.closePath();
      ca.restore();
      life++; x += Math.cos(dir) * speed; y += Math.sin(dir) * speed;
      const tc = !(tick % Math.round(rand(58))) && (!(Math.round(x) % 6) || !(Math.round(y) % 6));
      dir += tc ? turnAmt * (Math.round(rand(1)) ? -1 : 1) : 0;
      if (x > w) x = 0; if (x < 0) x = w; if (y > h) y = 0; if (y < 0) y = h;
      props.set([x, y, dir, speed, life, ttl, width, hue], i);
      if (life > ttl) initPipe(i);
    }
    cb.save(); cb.fillStyle = "hsla(150,80%,1%,1)"; cb.fillRect(0, 0, w, h); cb.restore();
    cb.save(); cb.filter = "blur(12px)"; cb.drawImage(a, 0, 0); cb.restore();
    cb.save(); cb.drawImage(a, 0, 0); cb.restore();
    raf = requestAnimationFrame(draw);
  }
  draw();
  const onR = () => { resize(); props = new Float32Array(N * P); for (let i = 0; i < N * P; i += P) initPipe(i); };
  window.addEventListener("resize", onR);
  return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", onR); cb.clearRect(0,0,w,h); };
}

// ── AURORA ────────────────────────────────────────────────────────────────────
function runAurora(b: HTMLCanvasElement) {
  const noise2D = createNoise2D();
  const a = document.createElement("canvas");
  const ca = a.getContext("2d")!;
  const cb = b.getContext("2d")!;
  const N = 500, P = 8;
  let tick = 0, w = 0, h = 0, cx = 0, cy = 0;
  let props = new Float32Array(N * P);

  function resize() {
    w = b.width = a.width = window.innerWidth;
    h = b.height = a.height = window.innerHeight;
    cx = w / 2; cy = h / 2;
  }
  function initRay(i: number) {
    props.set([rand(w), cy, 200 + rand(200), 0.05 + rand(0.1), 10 + rand(20), 120 + rand(60), 50 + rand(100), 0], i);
  }
  resize();
  for (let i = 0; i < N * P; i += P) initRay(i);

  let raf: number;
  function draw() {
    tick++;
    for (let i = 0; i < N * P; i += P) {
      let [x, y, length, speed, width, hue, ttl, life] = Array.from(props.slice(i, i + P));
      ca.save();
      ca.strokeStyle = `hsla(${hue},100%,50%,${fadeInOut(life, ttl)})`;
      ca.lineWidth = width; ca.lineCap = "round";
      ca.beginPath(); ca.moveTo(x, y); ca.lineTo(x, y - length); ca.stroke(); ca.closePath();
      ca.restore();
      x = (noise2D(x * 0.001, tick * 0.0005) + 1) * 0.5 * w;
      life++;
      props.set([x, y, length, speed, width, hue, ttl, life], i);
      if (life > ttl) initRay(i);
    }
    cb.save(); cb.fillStyle = "hsla(0,0%,0%,1)"; cb.fillRect(0, 0, w, h); cb.restore();
    cb.save(); cb.filter = "blur(8px)"; cb.drawImage(a, 0, 0); cb.restore();
    cb.save(); cb.drawImage(a, 0, 0); cb.restore();
    raf = requestAnimationFrame(draw);
  }
  draw();
  const onR = () => { resize(); props = new Float32Array(N * P); for (let i = 0; i < N * P; i += P) initRay(i); };
  window.addEventListener("resize", onR);
  return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", onR); cb.clearRect(0,0,w,h); };
}

// ── SWIRL ─────────────────────────────────────────────────────────────────────
function runSwirl(b: HTMLCanvasElement) {
  const noise3D = createNoise3D();
  const a = document.createElement("canvas");
  const ca = a.getContext("2d")!;
  const cb = b.getContext("2d")!;
  const N = 700, P = 9;
  let tick = 0, w = 0, h = 0, cx = 0, cy = 0;
  let props = new Float32Array(N * P);

  function resize() {
    w = b.width = a.width = window.innerWidth;
    h = b.height = a.height = window.innerHeight;
    cx = w / 2; cy = h / 2;
  }
  function initParticle(i: number) {
    props.set([rand(w), cy + randRange(100), 0, 0, 0, 50 + rand(150), 0.1 + rand(2), 1 + rand(4), 220 + rand(100)], i);
  }
  resize();
  for (let i = 0; i < N * P; i += P) initParticle(i);

  let raf: number;
  function draw() {
    tick++;
    ca.clearRect(0, 0, w, h);
    cb.fillStyle = "hsla(260,40%,5%,1)"; cb.fillRect(0, 0, w, h);
    for (let i = 0; i < N * P; i += P) {
      let x = props[i], y = props[i+1], vx = props[i+2], vy = props[i+3];
      let life = props[i+4], ttl = props[i+5], speed = props[i+6];
      let radius = props[i+7], hue = props[i+8];
      const n = noise3D(x * 0.00125, y * 0.00125, tick * 0.0005) * 8 * TAU;
      vx = lerp(vx, Math.cos(n), 0.5); vy = lerp(vy, Math.sin(n), 0.5);
      const x2 = x + vx * speed, y2 = y + vy * speed;
      ca.save(); ca.lineCap = "round"; ca.lineWidth = radius;
      ca.strokeStyle = `hsla(${hue},100%,60%,${fadeInOut(life, ttl)})`;
      ca.beginPath(); ca.moveTo(x, y); ca.lineTo(x2, y2); ca.stroke(); ca.closePath(); ca.restore();
      const oob = x2 > w || x2 < 0 || y2 > h || y2 < 0;
      if (oob || life > ttl) { initParticle(i); }
      else { props.set([x2, y2, vx, vy, life + 1, ttl, speed, radius, hue], i); }
    }
    cb.save(); cb.filter = "blur(8px) brightness(200%)"; cb.globalCompositeOperation = "lighter"; cb.drawImage(a, 0, 0); cb.restore();
    cb.save(); cb.filter = "blur(4px) brightness(200%)"; cb.globalCompositeOperation = "lighter"; cb.drawImage(a, 0, 0); cb.restore();
    cb.save(); cb.globalCompositeOperation = "lighter"; cb.drawImage(a, 0, 0); cb.restore();
    raf = requestAnimationFrame(draw);
  }
  draw();
  const onR = () => { resize(); props = new Float32Array(N * P); for (let i = 0; i < N * P; i += P) initParticle(i); };
  window.addEventListener("resize", onR);
  return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", onR); cb.clearRect(0,0,w,h); };
}

// ── COALESCE ──────────────────────────────────────────────────────────────────
function runCoalesce(b: HTMLCanvasElement) {
  const a = document.createElement("canvas");
  const ca = a.getContext("2d")!;
  const cb = b.getContext("2d")!;
  const N = 700, P = 9;
  let tick = 0, w = 0, h = 0, cx = 0, cy = 0;
  let props = new Float32Array(N * P);

  function resize() {
    w = b.width = a.width = window.innerWidth;
    h = b.height = a.height = window.innerHeight;
    cx = w / 2; cy = h / 2;
  }
  function initParticle(i: number) {
    const x = rand(w), y = rand(h);
    const theta = angle(x, y, cx, cy);
    props.set([x, y, Math.cos(theta) * 6, Math.sin(theta) * 6, 0, 100 + rand(500), 0.1 + rand(1), 2 + rand(10), 10 + rand(100)], i);
  }
  resize();
  for (let i = 0; i < N * P; i += P) initParticle(i);

  let raf: number;
  function draw() {
    tick++;
    ca.clearRect(0, 0, w, h);
    cb.fillStyle = "hsla(60,50%,3%,1)"; cb.fillRect(0, 0, w, h);
    for (let i = 0; i < N * P; i += P) {
      let x = props[i], y = props[i+1], vx = props[i+2], vy = props[i+3];
      let life = props[i+4], ttl = props[i+5], speed = props[i+6], size = props[i+7], hue = props[i+8];
      const theta = angle(x, y, cx, cy) + 0.75 * HALF_PI;
      vx = lerp(vx, 2 * Math.cos(theta), 0.05);
      vy = lerp(vy, 2 * Math.sin(theta), 0.05);
      const x2 = x + vx * speed, y2 = y + vy * speed;
      const xRel = x - size * 0.5, yRel = y - size * 0.5;
      ca.save(); ca.lineWidth = 1;
      ca.strokeStyle = `hsla(${hue},100%,60%,${fadeInOut(life, ttl)})`;
      ca.beginPath(); ca.translate(xRel, yRel); ca.rotate(theta); ca.translate(-xRel, -yRel);
      ca.strokeRect(xRel, yRel, size, size); ca.closePath(); ca.restore();
      life++;
      props.set([x2, y2, vx, vy, life, ttl, speed, size, hue], i);
      if (life > ttl) initParticle(i);
    }
    cb.save(); cb.filter = "blur(8px) brightness(200%)"; cb.globalCompositeOperation = "lighter"; cb.drawImage(a, 0, 0); cb.restore();
    cb.save(); cb.filter = "blur(4px) brightness(200%)"; cb.globalCompositeOperation = "lighter"; cb.drawImage(a, 0, 0); cb.restore();
    cb.save(); cb.globalCompositeOperation = "lighter"; cb.drawImage(a, 0, 0); cb.restore();
    raf = requestAnimationFrame(draw);
  }
  draw();
  const onR = () => { resize(); props = new Float32Array(N * P); for (let i = 0; i < N * P; i += P) initParticle(i); };
  window.addEventListener("resize", onR);
  return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", onR); cb.clearRect(0,0,w,h); };
}

// ── SHIFT ─────────────────────────────────────────────────────────────────────
function runShift(b: HTMLCanvasElement) {
  const cb = b.getContext("2d")!;
  let w = 0, h = 0, t = 0;

  function resize() {
    w = b.width = window.innerWidth;
    h = b.height = window.innerHeight;
  }
  resize();

  let raf: number;
  function draw() {
    t += 0.003;
    const g = cb.createLinearGradient(0, 0, w, h);
    g.addColorStop(0,   `hsla(${200 + Math.sin(t)          * 40},80%,4%,1)`);
    g.addColorStop(0.3, `hsla(${240 + Math.sin(t + 1)      * 30},70%,6%,1)`);
    g.addColorStop(0.6, `hsla(${180 + Math.sin(t + 2)      * 50},80%,5%,1)`);
    g.addColorStop(1,   `hsla(${260 + Math.sin(t + 3)      * 40},70%,4%,1)`);
    cb.fillStyle = g;
    cb.fillRect(0, 0, w, h);

    // Floating glowing orbs
    for (let i = 0; i < 5; i++) {
      const ox = w * (0.2 + 0.6 * ((i / 5) + Math.sin(t + i) * 0.15));
      const oy = h * (0.3 + 0.4 * Math.sin(t * 0.7 + i * 1.3));
      const radius = Math.min(w, h) * (0.15 + 0.05 * Math.sin(t + i));
      const rg = cb.createRadialGradient(ox, oy, 0, ox, oy, radius);
      const hue = (200 + i * 30 + t * 20) % 360;
      rg.addColorStop(0,   `hsla(${hue},80%,30%,0.06)`);
      rg.addColorStop(0.5, `hsla(${hue},80%,20%,0.03)`);
      rg.addColorStop(1,   `hsla(${hue},80%,10%,0)`);
      cb.fillStyle = rg;
      cb.fillRect(0, 0, w, h);
    }
    raf = requestAnimationFrame(draw);
  }
  draw();
  const onR = () => resize();
  window.addEventListener("resize", onR);
  return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", onR); cb.clearRect(0,0,w,h); };
}

// ── Component ─────────────────────────────────────────────────────────────────

const RUNNERS: Record<string, (c: HTMLCanvasElement) => () => void> = {
  pipeline: runPipeline,
  aurora:   runAurora,
  swirl:    runSwirl,
  coalesce: runCoalesce,
  shift:    runShift,
};

export function CanvasBackground({ effect }: { effect: BgEffect }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (effect === "none") return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const runner = RUNNERS[effect];
    if (!runner) return;
    const cleanup = runner(canvas);
    return cleanup;
  }, [effect]);

  if (effect === "none") return null;

  return (
    <canvas
      ref={canvasRef}
      style={{ position: "fixed", inset: 0, width: "100%", height: "100%", zIndex: 0, pointerEvents: "none" }}
    />
  );
}
