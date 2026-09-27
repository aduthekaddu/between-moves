import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import {
  DEMO_GAME,
  START_POSITION,
  squareToXZ,
  type PieceColor,
  type PieceKind,
} from './demo-game';
import { boardMargin, contactShadow, cottonPaper, indigoCard, mulberry32 } from './paper-textures';
import { createPost } from './post';
import { loadSilhouettes, puppetMesh, type PuppetKind } from './puppets';

export interface HeroSceneCallbacks {
  readonly onReady?: () => void;
  readonly onMove?: (index: number) => void;
  readonly onStamp?: (kind: 'check' | 'mate', x: number, y: number) => void;
  readonly onReset?: () => void;
  readonly onLampMoved?: () => void;
  /** Every frame: the lamp's position over the table, in board units. */
  readonly onLamp?: (x: number, z: number) => void;
}

export interface HeroSceneOptions extends HeroSceneCallbacks {
  readonly modelUrl: string;
  readonly silhouetteBase: string;
  readonly reducedMotion: boolean;
  /** The resolved IBM Plex Mono family from next/font, for the printed board margin. */
  readonly monoFamily?: string;
  /** Development only: pin the timeline to one instant for frame-by-frame review. */
  readonly freezeAt?: number;
  readonly freezeLamp?: readonly [number, number];
}

export interface HeroScene {
  setPointer(ndcX: number, ndcY: number): void;
  /** A knuckle-rap on the table: nearby pieces hop, rippling outward. */
  tap(ndcX: number, ndcY: number): void;
  clearPointer(): void;
  setActive(active: boolean): void;
  resize(): void;
  dispose(): void;
  /** Development review: pin the timeline to one instant (null resumes). */
  scrub(t: number | null): void;
}

/** Stop-motion runs on twos: transforms advance at 12 frames per second. */
const STEP = 1 / 12;
const BOARD = 8;
const FRAME = 8.9;
const LAMP_HEIGHT = 9.5;

const quantize = (t: number) => Math.floor(t / STEP) * STEP;
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
const easeOutBack = (t: number) => {
  const c1 = 1.9;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

interface Piece {
  readonly kind: PieceKind;
  readonly color: PieceColor;
  readonly group: THREE.Group;
  readonly body: THREE.Group;
  readonly contact: THREE.Mesh;
  square: string | null;
  captured: boolean;
  /** Rest pose of the body, animated by the timeline. */
  x: number;
  z: number;
  lift: number;
  tilt: number;
  yaw: number;
  /** 0 = folded flat on the board, 1 = standing. */
  unfold: number;
}

interface Puppet {
  readonly mesh: THREE.Mesh;
  readonly base: THREE.Vector3;
  readonly lean: THREE.Vector3;
  readonly phase: number;
}

type Beat =
  | { kind: 'intro'; start: number; end: number }
  | { kind: 'move'; index: number; start: number; end: number }
  | { kind: 'hold'; start: number; end: number }
  | { kind: 'reset'; start: number; end: number };

const MOVE_DURATION = 3.5;
const INTRO = 2.4;
const FINAL_HOLD = 5.5;
const RESET = 1.6;

function buildTimeline(): { beats: Beat[]; length: number } {
  const beats: Beat[] = [{ kind: 'intro', start: 0, end: INTRO }];
  let t = INTRO;
  DEMO_GAME.forEach((_, index) => {
    beats.push({ kind: 'move', index, start: t, end: t + MOVE_DURATION });
    t += MOVE_DURATION;
  });
  beats.push({ kind: 'hold', start: t, end: t + FINAL_HOLD });
  t += FINAL_HOLD;
  beats.push({ kind: 'reset', start: t, end: t + RESET });
  t += RESET;
  return { beats, length: t };
}

export async function createHeroScene(
  canvas: HTMLCanvasElement,
  options: HeroSceneOptions,
): Promise<HeroScene> {
  const monoFamily = options.monoFamily ?? '"IBM Plex Mono"';
  // the margin is rasterised once, so the face has to be there before it is drawn
  await document.fonts.load(`500 22px ${monoFamily}`).catch(() => undefined);
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
    powerPreference: 'high-performance',
  });
  const small = Math.min(window.innerWidth, window.innerHeight) < 700;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, small ? 1.5 : 1.75));
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.VSMShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#070913');
  const fog = new THREE.Fog('#070913', 26, 46);
  scene.fog = fog;

  const camera = new THREE.PerspectiveCamera(24, 1, 0.5, 120);

  // ————— materials —————
  const table = indigoCard(9);
  const paper = cottonPaper(2.4, 11);
  const paperFine = cottonPaper(3, 23);
  const tableMaterial = new THREE.MeshStandardMaterial({
    map: table.map,
    bumpMap: table.bump,
    bumpScale: 1.4,
    roughness: 0.97,
    metalness: 0,
  });
  const squareMaterial = new THREE.MeshStandardMaterial({
    map: paper.map,
    bumpMap: paper.bump,
    bumpScale: 0.9,
    roughness: 0.92,
  });
  const frameMaterial = new THREE.MeshStandardMaterial({
    map: boardMargin(FRAME, BOARD, monoFamily),
    bumpMap: paper.bump,
    bumpScale: 0.6,
    roughness: 0.92,
  });
  const edgeMaterial = new THREE.MeshStandardMaterial({ color: '#d9ccb4', roughness: 0.95 });
  const whiteMaterial = new THREE.MeshPhysicalMaterial({
    color: '#f4ead8',
    roughness: 0.86,
    sheen: 0.5,
    sheenColor: new THREE.Color('#fff1d6'),
    sheenRoughness: 0.75,
    flatShading: true,
  });
  const blackMaterial = new THREE.MeshPhysicalMaterial({
    color: '#1a1e30',
    roughness: 0.55,
    sheen: 0.45,
    sheenColor: new THREE.Color('#5d6db2'),
    sheenRoughness: 0.6,
    flatShading: true,
  });
  void paperFine;
  const creaseWhite = new THREE.LineBasicMaterial({
    color: '#bba98c',
    transparent: true,
    opacity: 0.55,
  });
  const creaseBlack = new THREE.LineBasicMaterial({
    color: '#4a5374',
    transparent: true,
    opacity: 0.6,
  });
  const contactTexture = contactShadow();

  // ————— table —————
  const tableMesh = new THREE.Mesh(new THREE.PlaneGeometry(90, 90), tableMaterial);
  tableMesh.rotation.x = -Math.PI / 2;
  tableMesh.receiveShadow = true;
  scene.add(tableMesh);

  // ————— the board: a paper stencil, dark squares cut away —————
  const boardGroup = new THREE.Group();
  boardGroup.position.y = 0.012;
  scene.add(boardGroup);
  const frameShape = new THREE.Shape();
  frameShape.moveTo(-FRAME / 2, -FRAME / 2);
  frameShape.lineTo(FRAME / 2, -FRAME / 2);
  frameShape.lineTo(FRAME / 2, FRAME / 2);
  frameShape.lineTo(-FRAME / 2, FRAME / 2);
  frameShape.closePath();
  const hole = new THREE.Path();
  hole.moveTo(-BOARD / 2, -BOARD / 2);
  hole.lineTo(-BOARD / 2, BOARD / 2);
  hole.lineTo(BOARD / 2, BOARD / 2);
  hole.lineTo(BOARD / 2, -BOARD / 2);
  hole.closePath();
  frameShape.holes.push(hole);
  const frameGeometry = new THREE.ExtrudeGeometry(frameShape, {
    depth: 0.035,
    bevelEnabled: false,
  });
  const frameMesh = new THREE.Mesh(frameGeometry, [frameMaterial, edgeMaterial]);
  frameMesh.rotation.x = -Math.PI / 2;
  frameMesh.receiveShadow = true;
  frameMesh.castShadow = true;
  const frameTexture = frameMaterial.map;
  if (frameTexture !== null) {
    frameTexture.repeat.set(1 / FRAME, 1 / FRAME);
    frameTexture.offset.set(0.5, 0.5);
  }
  boardGroup.add(frameMesh);

  const squareGeometry = new THREE.BoxGeometry(0.992, 0.035, 0.992);
  squareGeometry.translate(0, 0.0175, 0);
  const squares = new THREE.InstancedMesh(
    squareGeometry,
    // box faces: +x, -x, +y (the printed top), -y, +z, -z
    [edgeMaterial, edgeMaterial, squareMaterial, edgeMaterial, edgeMaterial, edgeMaterial],
    32,
  );
  squares.receiveShadow = true;
  squares.castShadow = true;
  const squareColour = new THREE.Color();
  const squareRandom = mulberry32(19);
  const lightSquares: { x: number; z: number }[] = [];
  for (let file = 0; file < 8; file += 1) {
    for (let rank = 0; rank < 8; rank += 1) {
      if ((file + rank) % 2 === 1) lightSquares.push({ x: file - 3.5, z: 3.5 - rank });
    }
  }
  const dummy = new THREE.Object3D();
  lightSquares.forEach((square, i) => {
    dummy.position.set(square.x, 0, square.z);
    dummy.rotation.set(0, (squareRandom() - 0.5) * 0.01, 0);
    dummy.updateMatrix();
    squares.setMatrixAt(i, dummy.matrix);
    const shade = 0.95 + squareRandom() * 0.05;
    squares.setColorAt(i, squareColour.setRGB(shade, shade * 0.995, shade * 0.985));
  });
  boardGroup.add(squares);

  // ————— lights —————
  const hemisphere = new THREE.HemisphereLight('#3b4a8a', '#05060c', 0.5);
  scene.add(hemisphere);
  const lamp = new THREE.SpotLight('#ffdcae', 0, 0, Math.PI / 5.2, 0.92, 1.35);
  lamp.position.set(-4.4, LAMP_HEIGHT, 2.2);
  lamp.castShadow = true;
  lamp.shadow.mapSize.set(small ? 1024 : 2048, small ? 1024 : 2048);
  lamp.shadow.camera.near = 2;
  lamp.shadow.camera.far = 30;
  lamp.shadow.bias = -0.0006;
  lamp.shadow.radius = 9;
  lamp.shadow.blurSamples = 16;
  lamp.shadow.intensity = 0.86;
  lamp.target.position.set(0, 0, 0);
  scene.add(lamp, lamp.target);
  const rim = new THREE.DirectionalLight('#7f8fd6', 0.45);
  rim.position.set(6, 5, -9);
  // paper bounces: a cool, low fill from the camera's side keeps shadow faces legible
  const fill = new THREE.DirectionalLight('#8d9ee6', 0.55);
  fill.position.set(9, 6, 7);
  scene.add(rim, fill);
  const LAMP_POWER = 640;

  // ————— pieces —————
  let loaded: [GLTF, Awaited<ReturnType<typeof loadSilhouettes>>];
  try {
    loaded = await Promise.all([
      new GLTFLoader().loadAsync(options.modelUrl),
      loadSilhouettes(options.silhouetteBase),
    ]);
  } catch (error) {
    // the renderer already holds the canvas's WebGL context; release it before giving up
    renderer.dispose();
    throw error;
  }
  const [gltf, silhouettes] = loaded;
  const geometries = new Map<string, THREE.BufferGeometry>();
  gltf.scene.traverse((node) => {
    if ((node as THREE.Mesh).isMesh) {
      const mesh = node as THREE.Mesh;
      const geometry = mesh.geometry.clone();
      geometry.applyMatrix4(mesh.matrixWorld);
      geometry.computeVertexNormals();
      geometries.set(mesh.name.replace(/\..*$/, ''), geometry);
    }
  });
  const creases = new Map<string, THREE.EdgesGeometry>();
  geometries.forEach((geometry, name) => creases.set(name, new THREE.EdgesGeometry(geometry, 24)));

  const pieces: Piece[] = [];
  const random = mulberry32(42);
  for (const setup of START_POSITION) {
    const geometry = geometries.get(setup.kind);
    const crease = creases.get(setup.kind);
    if (geometry === undefined || crease === undefined) continue;
    const group = new THREE.Group();
    const body = new THREE.Group();
    const mesh = new THREE.Mesh(geometry, setup.color === 'white' ? whiteMaterial : blackMaterial);
    mesh.castShadow = true;
    mesh.receiveShadow = false;
    const lines = new THREE.LineSegments(
      crease,
      setup.color === 'white' ? creaseWhite : creaseBlack,
    );
    body.add(mesh, lines);
    const contact = new THREE.Mesh(
      new THREE.PlaneGeometry(0.9, 0.9),
      new THREE.MeshBasicMaterial({
        map: contactTexture,
        transparent: true,
        depthWrite: false,
        opacity: setup.color === 'white' ? 0.55 : 0.7,
      }),
    );
    contact.rotation.x = -Math.PI / 2;
    contact.position.y = 0.05;
    group.add(body, contact);
    const { x, z } = squareToXZ(setup.square);
    const yaw =
      setup.kind === 'knight'
        ? setup.color === 'white'
          ? Math.PI / 2
          : -Math.PI / 2
        : (random() - 0.5) * 0.5;
    pieces.push({
      kind: setup.kind,
      color: setup.color,
      group,
      body,
      contact,
      square: setup.square,
      captured: false,
      x,
      z,
      lift: 0,
      tilt: 0,
      yaw,
      unfold: 1,
    });
    scene.add(group);
  }

  const pieceOn = (square: string) => pieces.find((p) => !p.captured && p.square === square);

  // ————— shadow puppets —————
  // Each friend is placed by where their shadow should fall (s) at a given height (h);
  // the lamp is back-projected every frame so the shadow stays put while the lamp swings.
  const puppetSpecs: { kind: PuppetKind; s: [number, number]; h: number; size: number }[] = [
    { kind: 'headphones', s: [0.9, -5.2], h: 4.3, size: 2.9 },
    { kind: 'braid', s: [-4.5, -4.5], h: 4.0, size: 2.8 },
    { kind: 'chai', s: [4.7, -4.1], h: 4.1, size: 2.8 },
    { kind: 'dupatta', s: [5.4, 1.5], h: 3.8, size: 2.9 },
    { kind: 'cap', s: [-5.4, 0.7], h: 3.9, size: 2.7 },
  ];
  const puppets: Puppet[] = puppetSpecs.map((spec, i) => {
    const mesh = puppetMesh(silhouettes[spec.kind], spec.size);
    const base = new THREE.Vector3(spec.s[0], spec.h, spec.s[1]);
    scene.add(mesh);
    const lean = new THREE.Vector3(-spec.s[0], 0, -spec.s[1]).normalize().multiplyScalar(0.8);
    return { mesh, base, lean, phase: i * 1.7 };
  });

  /** Where to hold something at height h so the lamp throws its shadow onto (x, z). */
  function throwTo(x: number, z: number, h: number, out: THREE.Vector3) {
    const k = (LAMP_HEIGHT - h) / LAMP_HEIGHT;
    return out.set(
      lamp.position.x + (x - lamp.position.x) * k,
      h,
      lamp.position.z + (z - lamp.position.z) * k,
    );
  }

  const hands: Record<PieceColor, { mesh: THREE.Mesh; rest: THREE.Vector3 }> = {
    white: { mesh: puppetMesh(silhouettes.hand, 3.4), rest: new THREE.Vector3(-3.5, 2.3, 9.5) },
    black: { mesh: puppetMesh(silhouettes.hand, 3.4), rest: new THREE.Vector3(3.2, 2.3, -10) },
  };
  for (const hand of Object.values(hands)) {
    hand.mesh.rotation.order = 'YXZ';
    hand.mesh.rotation.x = -Math.PI / 2;
    hand.mesh.position.copy(hand.rest);
    scene.add(hand.mesh);
  }

  const post = createPost(renderer, scene, camera);

  // ————— camera framing —————
  let width = 1;
  let height = 1;
  let portrait = false;
  function frame() {
    width = canvas.clientWidth || 1;
    height = canvas.clientHeight || 1;
    renderer.setSize(width, height, false);
    portrait = width / height < 0.9;
    camera.aspect = width / height;
    const squarish = !portrait && width / height < 1.45;
    const distance = portrait ? 50 : squarish ? 34 : 29.5;
    const polar = portrait ? 0.66 : 0.86;
    const azimuth = portrait ? 0.32 : 0.58;
    camera.position.set(
      Math.sin(azimuth) * Math.sin(polar) * distance,
      Math.cos(polar) * distance,
      Math.cos(azimuth) * Math.sin(polar) * distance,
    );
    camera.lookAt(0, 0.3, 0);
    // fog falls off behind the board, wherever the camera stands
    fog.near = distance - 2;
    fog.far = distance + 18;
    camera.fov = portrait ? 30 : 24;
    // Shift the lens rather than the camera: the board sits right of the headline
    // on wide screens and below it on tall ones, without perspective distortion.
    const shiftX = portrait ? 0 : -width * (squarish ? 0.25 : 0.21);
    const shiftY = portrait ? -height * 0.2 : height * 0.035;
    camera.setViewOffset(width, height, shiftX, shiftY, width, height);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    post.setSize(width, height, renderer.getPixelRatio());
    const centre = new THREE.Vector3(0, 0.4, 0.3).project(camera);
    post.setFocus((centre.y + 1) / 2, new THREE.Vector2((centre.x + 1) / 2, (centre.y + 1) / 2));
  }
  frame();

  // ————— lamp physics: a pendulum that follows the pointer —————
  const lampPos = new THREE.Vector2(-4.4, 2.2);
  const lampVel = new THREE.Vector2();
  const lampTarget = new THREE.Vector2(-4.4, 2.2);
  let pointerActive = false;
  let pointerMovedOnce = false;
  const raycaster = new THREE.Raycaster();
  const tablePlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const hit = new THREE.Vector3();

  // ————— timeline —————
  const { beats, length } = buildTimeline();
  let clock = 0;
  let lastFrame = performance.now();
  let lastMoveAnnounced = -1;
  let running = true;
  let raf = 0;
  let ready = false;
  let frozenAt: number | null = options.freezeAt ?? null;
  const stampAnnounced = new Set<number>();
  let tapAt = -10;
  const tapOrigin = new THREE.Vector2();

  function resetPieces() {
    const used = new Set<Piece>();
    for (const setup of START_POSITION) {
      const piece = pieces.find(
        (p) => !used.has(p) && p.kind === setup.kind && p.color === setup.color,
      );
      if (piece === undefined) continue;
      used.add(piece);
      const { x, z } = squareToXZ(setup.square);
      piece.square = setup.square;
      piece.captured = false;
      piece.x = x;
      piece.z = z;
      piece.lift = 0;
      piece.tilt = 0;
    }
  }

  /** Recompute the whole position up to (but not including) the given ply. */
  function positionBefore(ply: number) {
    resetPieces();
    const graveyard = { white: 0, black: 0 };
    for (let i = 0; i < ply; i += 1) {
      const move = DEMO_GAME[i];
      if (move === undefined) continue;
      const from = move.uci.slice(0, 2);
      const to = move.uci.slice(2, 4);
      const mover = pieceOn(from);
      const victim = pieceOn(to);
      if (victim !== undefined) {
        victim.captured = true;
        victim.square = null;
        const slot = graveyard[victim.color]++;
        const g = graveyardSpot(victim.color, slot);
        victim.x = g.x;
        victim.z = g.z;
        victim.tilt = Math.PI / 2;
      }
      if (mover !== undefined) {
        const { x, z } = squareToXZ(to);
        mover.square = to;
        mover.x = x;
        mover.z = z;
      }
    }
  }

  function graveyardSpot(color: PieceColor, slot: number) {
    return color === 'white'
      ? { x: 5.7 + (slot % 2) * 0.9, z: 2.6 - Math.floor(slot / 2) * 1.3 }
      : { x: -5.8 - (slot % 2) * 0.9, z: -2.4 + Math.floor(slot / 2) * 1.3 };
  }

  function capturedCount(color: PieceColor) {
    return pieces.filter((p) => p.captured && p.color === color).length;
  }

  function applyPose(piece: Piece, jitterSeed: number) {
    const j = mulberry32(jitterSeed);
    const shake = piece.lift > 0.01 ? 0.012 : 0.004;
    piece.group.position.set(piece.x + (j() - 0.5) * shake, 0, piece.z + (j() - 0.5) * shake);
    piece.body.position.y = 0.047 + piece.lift;
    piece.body.rotation.set(0, piece.yaw, 0);
    if (piece.tilt !== 0) piece.body.rotation.z = piece.tilt;
    const contactScale = Math.max(0.35, 1 - piece.lift * 0.9);
    piece.contact.scale.setScalar(
      contactScale * (piece.kind === 'king' || piece.kind === 'queen' ? 1.15 : 1),
    );
    (piece.contact.material as THREE.MeshBasicMaterial).opacity =
      (piece.color === 'white' ? 0.55 : 0.7) *
      (piece.tilt !== 0 ? 0.5 : Math.max(0.25, 1 - piece.lift));
  }

  function project(x: number, y: number, z: number) {
    const v = new THREE.Vector3(x, y, z).project(camera);
    return { x: ((v.x + 1) / 2) * width, y: ((1 - v.y) / 2) * height };
  }

  function animateMove(index: number, local: number) {
    const move = DEMO_GAME[index];
    if (move === undefined) return;
    positionBefore(index);
    const from = move.uci.slice(0, 2);
    const to = move.uci.slice(2, 4);
    const mover = pieceOn(from);
    const victim = pieceOn(to);
    if (mover === undefined) return;
    const a = squareToXZ(from);
    const b = squareToXZ(to);
    const hand = hands[mover.color];
    const t = options.reducedMotion ? MOVE_DURATION : quantize(local);

    // hand approach 0–0.55, lift 0.55–0.8, carry 0.8–1.45, land 1.45–1.6, leave 1.6–2.2
    const approach = easeInOut(clamp01(t / 0.55));
    const leave = easeInOut(clamp01((t - 1.6) / 0.6));
    const carry = easeInOut(clamp01((t - 0.8) / 0.65));
    const liftUp = clamp01((t - 0.55) / 0.25);
    const setDown = clamp01((t - 1.45) / 0.15);
    const hop = mover.kind === 'knight' ? 1.1 : 0.55;
    const arc = Math.sin(carry * Math.PI) * hop;
    const px = a.x + (b.x - a.x) * carry;
    const pz = a.z + (b.z - a.z) * carry;
    const lifted = t < 0.8 ? liftUp * 0.32 : t < 1.45 ? 0.32 + arc : (1 - setDown) * 0.32;
    mover.x = px;
    mover.z = pz;
    mover.lift = Math.max(0, lifted);
    if (t >= 1.6) {
      mover.square = to;
      mover.lift = 0;
      mover.x = b.x;
      mover.z = b.z;
    }

    if (victim !== undefined) {
      const knocked = easeOutBack(clamp01((t - 1.3) / 0.45));
      const slot = capturedCount(victim.color);
      const g = graveyardSpot(victim.color, slot);
      if (t >= 1.3) {
        victim.x = b.x + (g.x - b.x) * knocked;
        victim.z = b.z + (g.z - b.z) * knocked;
        victim.lift = Math.sin(clamp01((t - 1.3) / 0.45) * Math.PI) * 0.6;
        victim.tilt = (Math.PI / 2) * clamp01((t - 1.3) / 0.35);
      }
      if (t >= 1.75) {
        victim.captured = true;
        victim.square = null;
        victim.x = g.x;
        victim.z = g.z;
        victim.lift = 0;
        victim.tilt = Math.PI / 2;
      }
    }

    // The hand's shadow, not the hand, has to land on the piece: back-project from the lamp.
    const reach = new THREE.Vector3(px, 0, pz).sub(hand.rest).setY(0).normalize();
    const handHeight = 2.2 + mover.lift * 0.8;
    // the pinch sits 1.4 units from the plane's centre, toward the fingers (local -x)
    const hover = throwTo(px - reach.x * 1.4, pz - reach.z * 1.4, handHeight, new THREE.Vector3());
    const pos = hand.rest.clone().lerp(hover, t < 1.6 ? approach : 1 - leave);
    hand.mesh.position.copy(pos);
    hand.mesh.rotation.y = Math.atan2(-reach.z, reach.x) + Math.PI;

    if (t >= 1.6 && lastMoveAnnounced !== index) {
      lastMoveAnnounced = index;
      options.onMove?.(index);
      if ((move.check || move.mate) && !stampAnnounced.has(index)) {
        stampAnnounced.add(index);
        const king = pieces.find((p) => p.kind === 'king' && p.color === 'black');
        if (king !== undefined) {
          const s = project(king.x, 1.9, king.z);
          options.onStamp?.(move.mate ? 'mate' : 'check', s.x, s.y);
        }
      }
    }
  }

  function tick(now: number) {
    raf = requestAnimationFrame(tick);
    const dt = Math.min(0.05, Math.max(0, (now - lastFrame) / 1000));
    lastFrame = now;
    if (!running) return;
    clock = frozenAt ?? clock + dt;

    // lamp pendulum
    const idle = !pointerActive;
    if (options.freezeLamp !== undefined) {
      lampTarget.set(options.freezeLamp[0], options.freezeLamp[1]);
      lampPos.copy(lampTarget);
      lampVel.set(0, 0);
    } else if (idle) {
      const w = clock * 0.18;
      lampTarget.set(-4.2 + Math.sin(w) * 1.8, 1.6 + Math.sin(w * 1.7) * 1.4);
    }
    const k = 16;
    const c = 4.2;
    lampVel.x += (k * (lampTarget.x - lampPos.x) - c * lampVel.x) * dt;
    lampVel.y += (k * (lampTarget.y - lampPos.y) - c * lampVel.y) * dt;
    lampPos.addScaledVector(lampVel, dt);
    lamp.position.set(lampPos.x, LAMP_HEIGHT, lampPos.y);
    lamp.target.position.set(lampPos.x * 0.35, 0, lampPos.y * 0.35);
    options.onLamp?.(lampPos.x, lampPos.y);

    // timeline
    const loopT = options.reducedMotion ? length - RESET - 0.01 : clock % length;
    // reduced motion pins the final position, so the caption has to be told about it directly
    if (options.reducedMotion && lastMoveAnnounced !== DEMO_GAME.length - 1) {
      lastMoveAnnounced = DEMO_GAME.length - 1;
      options.onMove?.(lastMoveAnnounced);
    }
    if (!options.reducedMotion && clock > length && loopT < dt * 2) {
      lastMoveAnnounced = -1;
      stampAnnounced.clear();
      options.onReset?.();
    }
    const beat = beats.find((b) => loopT >= b.start && loopT < b.end) ?? beats[beats.length - 1];
    const intensityScale = introLight(clock);
    lamp.intensity = LAMP_POWER * intensityScale;

    if (beat !== undefined) {
      if (beat.kind === 'intro') {
        resetPieces();
        const local = options.reducedMotion ? INTRO : quantize(loopT - beat.start);
        pieces.forEach((piece) => {
          const rank = Number(piece.square?.[1] ?? '1');
          const file = 'abcdefgh'.indexOf(piece.square?.[0] ?? 'a');
          const order = piece.color === 'white' ? rank - 1 : 8 - rank + 0.5;
          const delay = 0.55 + order * 0.16 + file * 0.035;
          const p = clamp01((local - delay) / 0.42);
          piece.tilt = 0;
          piece.lift = 0;
          piece.body.visible = p > 0;
          piece.unfold = p === 0 ? 0 : easeOutBack(p);
        });
      } else if (beat.kind === 'move') {
        pieces.forEach((piece) => {
          piece.body.visible = true;
          piece.unfold = 1;
        });
        animateMove(beat.index, loopT - beat.start);
      } else if (beat.kind === 'hold') {
        positionBefore(DEMO_GAME.length);
        for (const hand of Object.values(hands)) hand.mesh.position.copy(hand.rest);
      } else {
        positionBefore(DEMO_GAME.length);
        const p = options.reducedMotion ? 0 : clamp01(quantize(loopT - beat.start) / (RESET * 0.8));
        pieces.forEach((piece) => {
          piece.unfold = 1 - easeInOut(p);
        });
      }
    }

    const stepIndex = Math.floor(clock / STEP);
    const sinceTap = quantize(clock - tapAt);
    pieces.forEach((piece, i) => {
      applyPose(piece, stepIndex * 131 + i);
      if (sinceTap < 1.4 && !options.reducedMotion) {
        const distance = Math.hypot(piece.x - tapOrigin.x, piece.z - tapOrigin.y);
        const local = sinceTap - distance * 0.055;
        if (local > 0 && local < 0.36) {
          const strength = Math.max(0, 1 - distance / 9.5);
          const hop = Math.sin((local / 0.36) * Math.PI) * 0.34 * strength;
          piece.body.position.y += hop;
          piece.body.rotation.z += Math.sin(local * 40 + i) * 0.06 * strength;
        }
      }
      const unfold = piece.unfold;
      // folded flat toward the camera, then stood up like a pop-up
      piece.body.rotation.x = (1 - unfold) * (piece.color === 'white' ? 1 : -1) * (Math.PI / 2);
      piece.body.visible = unfold > 0.001;
    });

    // puppets breathe on twos and lean in at the sharp moments
    const moveBeat = beat?.kind === 'move' ? beat.index : -1;
    const drama =
      moveBeat === 8 || moveBeat === 9 || moveBeat === 12 || beat?.kind === 'hold' ? 1 : 0;
    const qt = quantize(clock);
    puppets.forEach((puppet, i) => {
      const breathe = Math.sin(qt * 1.3 + puppet.phase) * 0.08;
      const leanAmount = drama * (0.5 + (i % 3) * 0.25);
      const shift = leanAmount + breathe;
      throwTo(
        puppet.base.x + puppet.lean.x * shift,
        puppet.base.z + puppet.lean.z * shift,
        puppet.base.y,
        puppet.mesh.position,
      );
      // face the lamp so it throws the profile; the head leans toward the board
      puppet.mesh.up.set(-puppet.base.x, 0, -puppet.base.z).normalize();
      puppet.mesh.lookAt(lamp.position);
    });

    post.render(Math.floor(clock / STEP));
    if (!ready) {
      ready = true;
      options.onReady?.();
    }
  }

  function introLight(total: number) {
    if (options.reducedMotion) return 1;
    // first load only: a filament finding its feet
    if (total < INTRO) {
      const f = quantize(total);
      const flicker = [0, 0.05, 0.55, 0.1, 0, 0.7, 0.3, 0.95, 0.85, 1];
      const idx = Math.min(flicker.length - 1, Math.floor(f / STEP));
      return flicker[idx] ?? 1;
    }
    return 1;
  }

  raf = requestAnimationFrame(tick);

  const resizeObserver = new ResizeObserver(() => frame());
  resizeObserver.observe(canvas);

  return {
    setPointer(ndcX, ndcY) {
      raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);
      if (raycaster.ray.intersectPlane(tablePlane, hit) !== null) {
        const r = Math.hypot(hit.x, hit.z);
        const scale = r > 8 ? 8 / r : 1;
        lampTarget.set(hit.x * scale, hit.z * scale);
        pointerActive = true;
        if (!pointerMovedOnce) {
          pointerMovedOnce = true;
          options.onLampMoved?.();
        }
      }
    },
    tap(ndcX, ndcY) {
      raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);
      if (raycaster.ray.intersectPlane(tablePlane, hit) === null) return;
      tapOrigin.set(hit.x, hit.z);
      tapAt = clock;
    },
    clearPointer() {
      pointerActive = false;
    },
    setActive(active) {
      running = active;
      if (active) lastFrame = performance.now();
    },
    resize: frame,
    scrub(t) {
      // scrubbing forward plays announcements once; jumping back replays them
      if (t !== null && (frozenAt === null || t < frozenAt)) {
        lastMoveAnnounced = -1;
        stampAnnounced.clear();
      }
      frozenAt = t;
    },
    dispose() {
      cancelAnimationFrame(raf);
      resizeObserver.disconnect();
      post.dispose();
      renderer.dispose();
      scene.traverse((node) => {
        const mesh = node as THREE.Mesh;
        if (mesh.geometry !== undefined) mesh.geometry.dispose();
      });
    },
  };
}
