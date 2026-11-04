'use client';

import { useEffect, useRef, useState } from 'react';
import { DEMO_GAME, DEMO_PLAYERS } from './demo-game';
import { PaperSound } from '../../_components/paper-sound';
import type { HeroScene } from './scene';

interface Stamp {
  readonly kind: 'check' | 'mate';
  readonly x: number;
  readonly y: number;
  readonly key: number;
  readonly tilt: number;
}

function webglAvailable(): boolean {
  try {
    const probe = document.createElement('canvas');
    return probe.getContext('webgl2') !== null;
  } catch {
    return false;
  }
}

/**
 * The lamp-lit table. Three.js loads after first paint; until then (and forever, without
 * WebGL) the stage shows its still.
 */
export function HeroStage() {
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);
  const [moveIndex, setMoveIndex] = useState(-1);
  const [stamp, setStamp] = useState<Stamp | null>(null);
  const [lampMoved, setLampMoved] = useState(false);
  const [fallback, setFallback] = useState(false);
  const [soundOn, setSoundOn] = useState(false);
  const sound = useRef<PaperSound | null>(null);

  useEffect(() => {
    const stage = stageRef.current;
    const canvas = canvasRef.current;
    const hero = stage?.parentElement ?? null;
    if (stage === null || canvas === null || hero === null) return;
    if (!webglAvailable()) {
      // no WebGL: the still of the lit table stands in for the live one
      const timer = window.setTimeout(() => setFallback(true), 0);
      return () => window.clearTimeout(timer);
    }
    let disposed = false;
    let scene: HeroScene | null = null;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    // Development only: ?t=12.5&lamp=-4,2 pins a frame for review.
    const review =
      process.env.NODE_ENV === 'production' ? null : new URLSearchParams(window.location.search);
    const freezeAt = review?.get('t') ? Number(review.get('t')) : undefined;
    const lampParam = review?.get('lamp')?.split(',').map(Number);
    const freezeLamp =
      lampParam !== undefined && lampParam.length === 2
        ? ([lampParam[0] ?? 0, lampParam[1] ?? 0] as const)
        : undefined;
    let stampKey = 0;
    const lastLamp = { x: 0, z: 0 };
    // next/font publishes a generated family name; the canvas margin must use that, not the literal
    const monoFamily = getComputedStyle(document.documentElement)
      .getPropertyValue('--font-plex')
      .trim();
    let intersecting = true;
    const syncActive = () => scene?.setActive(intersecting && !document.hidden);

    void import('./scene')
      .then(async ({ createHeroScene }) => {
        if (disposed) return;
        const created = await createHeroScene(canvas, {
          modelUrl: '/models/house-set.glb',
          silhouetteBase: '/landing/silhouettes',
          reducedMotion,
          ...(monoFamily === '' ? {} : { monoFamily }),
          ...(freezeAt === undefined ? {} : { freezeAt }),
          ...(freezeLamp === undefined ? {} : { freezeLamp }),
          onReady: () => setReady(true),
          onMove: (index) => {
            setMoveIndex(index);
            sound.current?.tock();
          },
          onStamp: (kind, x, y) => {
            sound.current?.stamp();
            stampKey += 1;
            setStamp({ kind, x, y, key: stampKey, tilt: (Math.random() - 0.5) * 16 });
          },
          onReset: () => {
            setMoveIndex(-1);
            setStamp(null);
          },
          onLampMoved: () => setLampMoved(true),
          // the headline is lit by the same lamp as the board: its shadow falls away from it
          onLamp: (x, z) => {
            const nx = x / 8;
            const nz = z / 8;
            if (Math.abs(nx - lastLamp.x) + Math.abs(nz - lastLamp.z) < 0.006) return;
            lastLamp.x = nx;
            lastLamp.z = nz;
            hero.style.setProperty('--lamp-x', nx.toFixed(3));
            hero.style.setProperty('--lamp-z', nz.toFixed(3));
          },
        });
        if (disposed) {
          created.dispose();
          return;
        }
        scene = created;
        // an observer callback that fired before the scene existed would otherwise be lost
        syncActive();
        if (review !== null) (window as unknown as { __hero?: HeroScene }).__hero = created;
      })
      .catch(() => {
        // the model or silhouettes failed to load: show the still instead of a blank stage
        if (!disposed) setFallback(true);
      });

    const onPointer = (event: PointerEvent) => {
      if (scene === null) return;
      const rect = canvas.getBoundingClientRect();
      const x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      const y = -(((event.clientY - rect.top) / rect.height) * 2 - 1);
      scene.setPointer(x, y);
    };
    const onTap = (event: PointerEvent) => {
      if (scene === null) return;
      if (event.target instanceof Element && event.target.closest('a, button, input')) return;
      sound.current?.tap();
      const rect = canvas.getBoundingClientRect();
      scene.tap(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -(((event.clientY - rect.top) / rect.height) * 2 - 1),
      );
    };
    const onLeave = () => scene?.clearPointer();
    hero.addEventListener('pointermove', onPointer);
    hero.addEventListener('pointerdown', onPointer);
    hero.addEventListener('pointerdown', onTap);
    hero.addEventListener('pointerleave', onLeave);

    const visibility = new IntersectionObserver(
      ([entry]) => {
        intersecting = Boolean(entry?.isIntersecting);
        syncActive();
      },
      { threshold: 0 },
    );
    visibility.observe(stage);
    document.addEventListener('visibilitychange', syncActive);

    return () => {
      disposed = true;
      hero.removeEventListener('pointermove', onPointer);
      hero.removeEventListener('pointerdown', onPointer);
      hero.removeEventListener('pointerdown', onTap);
      hero.removeEventListener('pointerleave', onLeave);
      visibility.disconnect();
      document.removeEventListener('visibilitychange', syncActive);
      scene?.dispose();
      sound.current?.dispose();
      sound.current = null;
    };
  }, []);

  useEffect(() => {
    if (stamp === null || stamp.kind === 'mate') return;
    const timer = window.setTimeout(() => setStamp(null), 2600);
    return () => window.clearTimeout(timer);
  }, [stamp]);

  const move = moveIndex >= 0 ? DEMO_GAME[moveIndex] : undefined;

  return (
    <div className="lp-stage" ref={stageRef} data-ready={ready} data-fallback={fallback}>
      <canvas className="lp-stage__canvas" ref={canvasRef} aria-hidden="true" />
      <div className="lp-stage__vignette" aria-hidden="true" />
      {stamp === null ? null : (
        <span
          key={stamp.key}
          className={`lp-stamp lp-stamp--${stamp.kind}`}
          ref={(element) => {
            if (element !== null) {
              element.style.left = `${stamp.x}px`;
              element.style.top = `${stamp.y}px`;
              element.style.rotate = `${stamp.tilt}deg`;
            }
          }}
          aria-hidden="true"
        >
          {stamp.kind === 'mate' ? 'Mate' : 'Check'}
        </span>
      )}
      <figure className="lp-caption" aria-hidden="true">
        <p className="lp-caption__slate">
          <span>Fig. 1</span>
          <span>Thursday, 9:42 pm</span>
          <span>
            {DEMO_PLAYERS.white} v {DEMO_PLAYERS.black}
          </span>
        </p>
        <figcaption key={moveIndex} className="lp-caption__line">
          <span className="lp-caption__san">{move?.san ?? '—'}</span>
          <span className="lp-caption__text">
            {move?.caption ?? 'The lamp comes on. The House sets the table.'}
          </span>
        </figcaption>
      </figure>
      <div className="lp-stage__tools">
        <p className="lp-lamp-hint" data-hidden={lampMoved} aria-hidden="true">
          <span className="lp-lamp-hint__bulb" />
          Move the lamp · tap the table
        </p>
        <button
          type="button"
          className="lp-sound"
          aria-pressed={soundOn}
          onClick={() => {
            sound.current ??= new PaperSound();
            if (sound.current.on) sound.current.disable();
            else sound.current.enable();
            setSoundOn(sound.current.on);
          }}
        >
          <span className="lp-sound__bars" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
          Sound {soundOn ? 'on' : 'off'}
        </button>
      </div>
    </div>
  );
}
