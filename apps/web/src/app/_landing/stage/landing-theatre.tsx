'use client';

import { useEffect, useRef } from 'react';
import { Theatre, type Lamp, type SpriteDraw } from '../../_theatre/engine';
import { ACTS, TINT, type ActId, type View } from './choreography';

const TWOS = 12;
const ACT_IDS = new Set<string>(Object.keys(ACTS));

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** A lamp flame: slow breathing, quick flutter, the odd gust. */
function flicker(t: number): number {
  const gust = Math.max(0, Math.sin(t * 0.37) * Math.sin(t * 1.9)) ** 6;
  return 1 + 0.028 * Math.sin(t * 8.7) + 0.018 * Math.sin(t * 23.1 + 1.7) - 0.09 * gust;
}

/** The match catches, sputters once, then the lamp comes up. */
function lighting(t: number): number {
  if (t < 0.25) return 0;
  const k = clamp01((t - 0.25) / 1.3);
  const sputter = t < 0.9 ? 0.25 * Math.sin(t * 38) * (1 - k) : 0;
  return clamp01(k * k * (3 - 2 * k) + sputter);
}

interface Pinned {
  readonly time: number | null;
  readonly lamp: readonly [number, number] | null;
}

/** Development-only review pins: `?t=<seconds>&lamp=<x>,<y>` (fractions of the viewport). */
function reviewPins(): Pinned {
  if (process.env.NODE_ENV === 'production') return { time: null, lamp: null };
  const params = new URLSearchParams(window.location.search);
  const time = params.has('t') ? Number(params.get('t')) : null;
  const lamp = params.get('lamp')?.split(',').map(Number);
  return {
    time: time !== null && Number.isFinite(time) ? time : null,
    lamp:
      lamp !== undefined && lamp.length === 2 && lamp.every(Number.isFinite)
        ? [lamp[0] ?? 0.5, lamp[1] ?? 0.3]
        : null,
  };
}

/**
 * The landing's lit screen. One fixed canvas behind the words: the lamp follows the pointer,
 * each act's puppets are cued by how far the reader has scrolled into it, and the lamp goes out
 * when the curtain (the footer) comes down. Without WebGL2, or with reduced motion, the static
 * posters in the markup stay on the screen instead.
 */
export function LandingTheatre() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const root = canvas?.closest<HTMLElement>('.lp');
    if (canvas === null || canvas === undefined || root === null || root === undefined) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const pins = reviewPins();
    const width = () => canvas.clientWidth || window.innerWidth;
    const height = () => canvas.clientHeight || window.innerHeight;
    const pixelRatio = () => Math.min(window.devicePixelRatio || 1, width() > 1600 ? 1.25 : 1.5);
    let theatre: Theatre;
    try {
      theatre = new Theatre(canvas, Math.max(width(), height()) * pixelRatio() < 1400);
    } catch {
      return;
    }

    const acts = Array.from(root.querySelectorAll<HTMLElement>('[data-act]')).flatMap((element) =>
      ACT_IDS.has(element.dataset.act ?? '') ? [{ element, id: element.dataset.act as ActId }] : [],
    );
    const curtain = root.querySelector<HTMLElement>('[data-curtain]');

    const view: { current: View } = { current: { w: 1, h: 1, portrait: false } };
    const resize = () => {
      const w = width();
      const h = height();
      view.current = { w, h, portrait: h > w * 1.05 };
      theatre.resize(w, h, pixelRatio());
    };
    resize();

    const rest = () => ({
      x: view.current.w * (view.current.portrait ? 0.5 : 0.6),
      y: view.current.h * (view.current.portrait ? 0.3 : 0.32),
    });
    const lamp: Lamp = {
      ...{ x: rest().x, y: rest().y },
      restX: rest().x,
      restY: rest().y,
      power: 0,
      size: 70,
    };
    const target = { x: lamp.x, y: lamp.y, active: false, last: 0 };

    const onPointer = (event: PointerEvent) => {
      if (event.pointerType === 'touch') return;
      const w = view.current.w;
      const h = view.current.h;
      target.x = Math.min(w * 0.94, Math.max(w * 0.06, event.clientX));
      target.y = Math.min(h * 0.8, Math.max(h * 0.06, event.clientY));
      target.active = true;
      target.last = performance.now();
    };
    const onLeave = () => {
      target.active = false;
    };
    window.addEventListener('pointermove', onPointer, { passive: true });
    document.documentElement.addEventListener('pointerleave', onLeave);
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    // the prelude's company first; everything else as its act comes within reach
    void theatre.load(ACTS.prelude.sprites);

    const start = performance.now();
    let frame = -1;
    let draws: SpriteDraw[] = [];
    let tint: readonly [number, number, number] = TINT.lamp;
    let open = 1;
    let dim = 1;
    let lit = false;
    let raf = 0;
    let previous = start;

    const cue = (t: number) => {
      const vh = window.innerHeight;
      const next: SpriteDraw[] = [];
      let weight = 0;
      const mixed = [0, 0, 0];
      for (const act of acts) {
        const rect = act.element.getBoundingClientRect();
        const s = (vh - rect.top) / vh;
        const length = rect.height / vh;
        if (s > -1.5 && s < length + 1.5) void theatre.load(ACTS[act.id].sprites);
        if (s <= 0 || s >= length + 1) continue;
        const cover = clamp01((Math.min(rect.bottom, vh) - Math.max(rect.top, 0)) / vh);
        const shade = ACTS[act.id].tint(s);
        mixed[0] = (mixed[0] ?? 0) + shade[0] * cover;
        mixed[1] = (mixed[1] ?? 0) + shade[1] * cover;
        mixed[2] = (mixed[2] ?? 0) + shade[2] * cover;
        weight += cover;
        next.push(...ACTS[act.id].cues(s, t, view.current, clamp01(t / 2.2)));
      }
      if (weight > 0.01) {
        tint = [(mixed[0] ?? 0) / weight, (mixed[1] ?? 0) / weight, (mixed[2] ?? 0) / weight];
      }
      const down =
        curtain === null ? 0 : clamp01((vh - curtain.getBoundingClientRect().top) / (vh * 0.8));
      open = 1 - down * 0.92;
      dim = 1 - down * 0.8;
      draws = next;
    };

    const tick = (now: number) => {
      raf = window.requestAnimationFrame(tick);
      const t = pins.time ?? (now - start) / 1000;
      const dt = Math.min(0.1, (now - previous) / 1000);
      previous = now;
      const f = Math.floor(t * TWOS);
      if (f !== frame) {
        frame = f;
        cue(f / TWOS);
      }

      const r = rest();
      lamp.restX = r.x;
      lamp.restY = r.y;
      const idle = !target.active || now - target.last > 6000;
      const goalX = pins.lamp
        ? pins.lamp[0] * view.current.w
        : idle
          ? r.x + Math.sin(t * 0.23) * view.current.w * 0.1
          : target.x;
      const goalY = pins.lamp
        ? pins.lamp[1] * view.current.h
        : idle
          ? r.y + Math.sin(t * 0.31 + 1) * view.current.h * 0.05
          : target.y;
      const ease = 1 - Math.exp(-dt * (idle ? 1.2 : 5));
      lamp.x += (goalX - lamp.x) * ease;
      lamp.y += (goalY - lamp.y) * ease;
      lamp.size = view.current.portrait ? 46 : 70;
      lamp.power = lighting(t) * flicker(t) * dim;
      const flameX = lamp.x + Math.sin(t * 7.3) * 1.3 + Math.sin(t * 12.9) * 0.6;
      const flameY = lamp.y + Math.sin(t * 5.1) * 0.9;
      theatre.render(
        draws,
        { ...lamp, x: flameX, y: flameY },
        { tint, open: open * clamp01(t / 0.35) },
        t,
      );
      if (!lit && theatre.has('table')) {
        lit = true;
        root.dataset.theatre = 'on';
      }
    };
    raf = window.requestAnimationFrame(tick);

    const onVisibility = () => {
      if (document.hidden) {
        window.cancelAnimationFrame(raf);
      } else {
        previous = performance.now();
        raf = window.requestAnimationFrame(tick);
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener('pointermove', onPointer);
      document.documentElement.removeEventListener('pointerleave', onLeave);
      document.removeEventListener('visibilitychange', onVisibility);
      observer.disconnect();
      theatre.destroy();
      delete root.dataset.theatre;
    };
  }, []);

  return <canvas ref={canvasRef} className="lp-theatre" aria-hidden="true" />;
}
