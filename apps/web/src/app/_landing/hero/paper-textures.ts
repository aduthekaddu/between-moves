import * as THREE from 'three';

/** Small deterministic PRNG so every visit folds the same paper. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvas(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const element = document.createElement('canvas');
  element.width = size;
  element.height = size;
  const context = element.getContext('2d');
  if (context === null) throw new Error('2D canvas unavailable');
  return [element, context];
}

/** Draw fibres that wrap across tile edges so the texture repeats without seams. */
function fibres(
  context: CanvasRenderingContext2D,
  size: number,
  random: () => number,
  count: number,
  length: number,
  light: string,
  dark: string,
  width: number,
) {
  for (let i = 0; i < count; i += 1) {
    const x = random() * size;
    const y = random() * size;
    const angle = random() * Math.PI * 2;
    const reach = length * (0.4 + random());
    const bend = (random() - 0.5) * reach * 0.8;
    context.strokeStyle = random() > 0.5 ? light : dark;
    context.lineWidth = width * (0.5 + random());
    for (const [ox, oy] of [
      [0, 0],
      [size, 0],
      [-size, 0],
      [0, size],
      [0, -size],
    ] as const) {
      context.beginPath();
      context.moveTo(x + ox, y + oy);
      context.quadraticCurveTo(
        x + ox + Math.cos(angle) * reach * 0.5 - Math.sin(angle) * bend,
        y + oy + Math.sin(angle) * reach * 0.5 + Math.cos(angle) * bend,
        x + ox + Math.cos(angle) * reach,
        y + oy + Math.sin(angle) * reach,
      );
      context.stroke();
    }
  }
}

function grain(
  context: CanvasRenderingContext2D,
  size: number,
  random: () => number,
  amount: number,
) {
  const image = context.getImageData(0, 0, size, size);
  const data = image.data;
  for (let i = 0; i < data.length; i += 4) {
    const n = (random() - 0.5) * amount;
    data[i] = Math.max(0, Math.min(255, (data[i] ?? 0) + n));
    data[i + 1] = Math.max(0, Math.min(255, (data[i + 1] ?? 0) + n));
    data[i + 2] = Math.max(0, Math.min(255, (data[i + 2] ?? 0) + n));
  }
  context.putImageData(image, 0, 0);
}

function mottle(
  context: CanvasRenderingContext2D,
  size: number,
  random: () => number,
  count: number,
  colour: string,
) {
  for (let i = 0; i < count; i += 1) {
    const x = random() * size;
    const y = random() * size;
    const r = size * (0.05 + random() * 0.18);
    for (const [ox, oy] of [
      [0, 0],
      [size, 0],
      [-size, 0],
      [0, size],
      [0, -size],
    ] as const) {
      const gradient = context.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r);
      gradient.addColorStop(0, colour);
      gradient.addColorStop(1, 'rgba(0,0,0,0)');
      context.fillStyle = gradient;
      context.fillRect(x + ox - r, y + oy - r, r * 2, r * 2);
    }
  }
}

function toTexture(
  element: HTMLCanvasElement,
  colour: boolean,
  repeat: number,
): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(element);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeat, repeat);
  texture.anisotropy = 4;
  if (colour) texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** Deep indigo handmade card for the table: mottled, fibrous, never flat. */
export function indigoCard(repeat: number) {
  const size = 512;
  const random = mulberry32(7);
  const [colourCanvas, c] = canvas(size);
  c.fillStyle = '#1d2754';
  c.fillRect(0, 0, size, size);
  mottle(c, size, random, 38, 'rgba(40, 52, 98, 0.22)');
  mottle(c, size, random, 30, 'rgba(8, 10, 24, 0.25)');
  fibres(c, size, random, 900, 16, 'rgba(120, 136, 196, 0.10)', 'rgba(4, 6, 16, 0.18)', 0.8);
  grain(c, size, random, 14);

  const [bumpCanvas, b] = canvas(size);
  b.fillStyle = '#808080';
  b.fillRect(0, 0, size, size);
  mottle(b, size, random, 26, 'rgba(255,255,255,0.10)');
  fibres(b, size, random, 1400, 14, 'rgba(255,255,255,0.35)', 'rgba(0,0,0,0.25)', 0.9);
  grain(b, size, random, 26);
  return { map: toTexture(colourCanvas, true, repeat), bump: toTexture(bumpCanvas, false, repeat) };
}

/** Warm cotton paper for the board and the white army. */
export function cottonPaper(repeat: number, seed = 11) {
  const size = 512;
  const random = mulberry32(seed);
  const [bumpCanvas, b] = canvas(size);
  b.fillStyle = '#808080';
  b.fillRect(0, 0, size, size);
  mottle(b, size, random, 20, 'rgba(255,255,255,0.08)');
  fibres(b, size, random, 1100, 10, 'rgba(255,255,255,0.28)', 'rgba(0,0,0,0.2)', 0.7);
  grain(b, size, random, 22);

  const [colourCanvas, c] = canvas(size);
  c.fillStyle = '#f1e8d6';
  c.fillRect(0, 0, size, size);
  mottle(c, size, random, 24, 'rgba(214, 196, 164, 0.18)');
  fibres(c, size, random, 500, 9, 'rgba(255,255,255,0.35)', 'rgba(150,128,96,0.12)', 0.6);
  grain(c, size, random, 8);
  return { map: toTexture(colourCanvas, true, repeat), bump: toTexture(bumpCanvas, false, repeat) };
}

/** Soft radial pool used as a contact shadow beneath each piece. */
export function contactShadow(): THREE.CanvasTexture {
  const size = 128;
  const [element, c] = canvas(size);
  const gradient = c.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(6, 7, 14, 0.9)');
  gradient.addColorStop(0.45, 'rgba(6, 7, 14, 0.45)');
  gradient.addColorStop(1, 'rgba(6, 7, 14, 0)');
  c.fillStyle = gradient;
  c.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(element);
}

/**
 * Printed board margin: coordinates in graphite and a small imprint, drawn once onto the
 * top face of the paper frame.
 */
export function boardMargin(frameSize: number, innerSize: number): THREE.CanvasTexture {
  const size = 1024;
  const [element, c] = canvas(size);
  const random = mulberry32(3);
  c.fillStyle = '#f1e8d6';
  c.fillRect(0, 0, size, size);
  mottle(c, size, random, 20, 'rgba(214, 196, 164, 0.16)');
  grain(c, size, random, 7);
  const scale = size / frameSize;
  const inner = innerSize * scale;
  const margin = (size - inner) / 2;
  c.strokeStyle = 'rgba(40, 36, 30, 0.55)';
  c.lineWidth = 1.5;
  c.strokeRect(margin - 6, margin - 6, inner + 12, inner + 12);
  c.fillStyle = 'rgba(38, 34, 30, 0.78)';
  c.font = '500 22px "IBM Plex Mono", ui-monospace, monospace';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  const square = inner / 8;
  'abcdefgh'.split('').forEach((file, i) => {
    const x = margin + square * (i + 0.5);
    c.fillText(file, x, size - margin / 2);
    c.save();
    c.translate(x, margin / 2);
    c.rotate(Math.PI);
    c.fillText(file, 0, 0);
    c.restore();
  });
  for (let rank = 1; rank <= 8; rank += 1) {
    const y = margin + square * (8 - rank + 0.5);
    c.fillText(String(rank), margin / 2, y);
    c.save();
    c.translate(size - margin / 2, y);
    c.rotate(Math.PI);
    c.fillText(String(rank), 0, 0);
    c.restore();
  }
  c.font = '500 13px "IBM Plex Mono", ui-monospace, monospace';
  c.textAlign = 'left';
  c.fillStyle = 'rgba(38, 34, 30, 0.5)';
  c.fillText('BETWEEN MOVES · HOUSE SET · Nº 07', margin, size - margin / 2 + 30);
  c.fillStyle = 'rgba(216, 67, 44, 0.85)';
  c.beginPath();
  c.arc(size - margin - 8, size - margin / 2 + 30, 5, 0, Math.PI * 2);
  c.fill();
  const texture = new THREE.CanvasTexture(element);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}
