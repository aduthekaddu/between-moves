import { Chess } from 'chess.js';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  initialBoardState,
  liveBoard,
  reviewing,
  shownPosition,
  transition,
  type BoardEffect,
  type BoardEvent,
  type BoardState,
} from './board-machine';
import { requireFen, type Fen } from './board-model';
import { replayPositions } from './game-review';
import type { MoveAnswer, MoveEntryPosition } from './move-entry-wire';

/**
 * Walks board-machine.ts through every order of events that architecture/models/board/BoardState.tla
 * allows at the bounds in board-conformance.json, and hashes the graph the way
 * tooling/board-conformance.mjs hashes TLC's. Equal hashes mean the reducer and the model take the
 * same steps from the same states. The server and the network below mirror the model's.
 */

const summary = JSON.parse(
  readFileSync(new URL('./board-conformance.json', import.meta.url), 'utf8'),
) as {
  readonly constants: Readonly<Record<string, string>>;
  readonly states: number;
  readonly edges: number;
  readonly sha256: string;
};
const bound = (name: string) => Number(summary.constants[name]);
const MaxVersion = bound('MaxVersion');
const MaxPly = bound('MaxPly');
const MaxCommands = bound('MaxCommands');
const MaxFailures = bound('MaxFailures');
const NotReviewing = MaxPly + 1;
const modes = [...summary.constants.Modes!.matchAll(/"(\w+)"/g)].map((match) => match[1]!);

const line = ['e2e4', 'e7e5', 'g1f3', 'b8c6'];
const game = new Chess();
const fens: Fen[] = [requireFen(game.fen())];
const sans: string[] = [];
for (const uci of line) {
  sans.push(game.move({ from: uci.slice(0, 2), to: uci.slice(2, 4) }).san);
  fens.push(requireFen(game.fen()));
}
const plyOf = new Map(fens.map((fen, ply) => [fen, ply]));
const side = (ply: number) => (ply % 2 === 0 ? 'white' : 'black');

interface Message {
  readonly type: 'get' | 'getr' | 'post' | 'postr';
  readonly cur: boolean;
  readonly ok: boolean;
  readonly v: number;
  readonly p: number;
  readonly id: number;
  readonly base: number;
  readonly kind: string;
}
interface Point {
  readonly v: number;
  readonly p: number;
}
interface World {
  readonly board: BoardState;
  readonly server: Point;
  readonly accepted: readonly { readonly has: boolean; readonly v: number; readonly p: number }[];
  readonly net: readonly Message[];
  readonly nextCmd: number;
  readonly fails: number;
  readonly heard: number;
}

const getRequest: Message = {
  type: 'get',
  cur: true,
  ok: true,
  v: 0,
  p: 0,
  id: 0,
  base: 0,
  kind: 'none',
};

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function asSet(messages: readonly Message[]): Message[] {
  const unique = new Map(messages.map((message) => [canonical(message), message]));
  return [...unique.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, message]) => message);
}

function snapshotAt(v: number, p: number, mode: string): MoveEntryPosition {
  return {
    mode: mode === 'live' ? 'live' : 'correspondence',
    currentFen: fens[p]!,
    currentPly: p,
    sideToMove: side(p),
    version: v,
    state: 'active',
    viewerColor: 'white',
    white: { name: 'Ada' },
    black: { name: 'Bea' },
    moveDueAt: null,
    result: null,
    inCheck: false,
    moves: line.slice(0, p).map((uci, index) => ({ ply: index + 1, uci, san: sans[index]! })),
    ...(mode === 'live'
      ? {
          serverNow: '2026-09-24T12:00:00.000Z',
          liveClock: { whiteMs: 60_000, blackMs: 60_000, turnStartedAt: '2026-09-24T12:00:00.000Z' },
        }
      : {}),
  };
}

const replays = new Map<string, readonly Fen[] | null>();
function positionsOf(board: BoardState) {
  const key = board.snapshot.currentFen;
  if (!replays.has(key)) replays.set(key, replayPositions(board.snapshot.moves, key));
  return replays.get(key)!;
}

/** The model's variables for a world. canon, captured and drawn belong to the old-code variants. */
function abstract(world: World) {
  const { board } = world;
  const positions = positionsOf(board);
  const shown = shownPosition(board, positions);
  const { sync, command } = board;
  const ahead =
    sync.kind === 'fresh' || sync.ahead === null
      ? { has: false, v: 0, p: 0 }
      : { has: true, v: sync.ahead.version, p: sync.ahead.ply };
  return {
    accepted: world.accepted,
    canon: { v: 0, p: 0 },
    captured: { v: 0, p: 0 },
    cmd:
      command.kind === 'none'
        ? { kind: 'none', id: 0, base: 0 }
        : {
            kind: command.kind,
            id: Number(command.command.clientCommandId.slice(1)),
            base: command.command.expectedPly,
          },
    drawn: { kind: 'live', p: 0 },
    fails: world.fails,
    heard: world.heard,
    mode: board.live ? 'live' : 'correspondence',
    net: world.net,
    nextCmd: world.nextCmd,
    rv: board.reviewPly ?? NotReviewing,
    screen: {
      kind: reviewing(board, positions)
        ? 'review'
        : shown.fen === liveBoard(board).fen
          ? 'live'
          : 'preview',
      p: plyOf.get(shown.fen) ?? -1,
    },
    server: world.server,
    snap: { v: board.snapshot.version, p: board.snapshot.currentPly },
    sync:
      sync.kind === 'stale'
        ? { kind: 'stale', reading: true, bg: sync.background, again: sync.readAgain, ahead }
        : {
            kind: sync.kind,
            reading: sync.kind === 'fresh' && sync.reading !== null,
            bg: true,
            again: false,
            ahead,
          },
  };
}

const env = { online: true, visible: true, wideEnough: true };

/** Runs client events and turns the reducer's effects into messages, as board-store.ts sends them. */
function dispatch(world: World, events: readonly BoardEvent[], extra: Partial<World> = {}): World {
  let board = world.board;
  const effects: BoardEffect[] = [];
  for (const event of events) {
    const [next, emitted] = transition(board, event, env);
    board = next;
    effects.push(...emitted);
  }
  const sent: Message[] = effects.flatMap((effect): Message[] =>
    effect.kind === 'readGame'
      ? [getRequest]
      : effect.kind === 'sendMove'
        ? [
            {
              ...getRequest,
              type: 'post',
              id: Number(effect.command.clientCommandId.slice(1)),
              base: effect.command.expectedPly,
            },
          ]
        : [],
  );
  return { ...world, ...extra, board, net: asSet([...(extra.net ?? world.net), ...sent]) };
}

function answerOf(message: Message): MoveAnswer {
  switch (message.kind) {
    case 'accepted':
      return {
        kind: 'accepted',
        move: {
          ply: message.p,
          uci: line[message.p - 1]!,
          san: sans[message.p - 1]!,
          fenAfter: fens[message.p]!,
          sideToMove: side(message.p),
          version: message.v,
        },
      };
    case 'conflict':
      return {
        kind: 'conflict',
        position: {
          version: message.v,
          currentPly: message.p,
          currentFen: fens[message.p]!,
          sideToMove: side(message.p),
        },
      };
    case 'flag':
      return { kind: 'flagFall' };
    case 'rejected':
      return { kind: 'rejected', illegal: false };
    default:
      return { kind: 'unreachable' };
  }
}

function clientSteps(world: World): [string, World][] {
  const { board } = world;
  const steps: [string, World][] = [];
  const base = liveBoard(board).ply;
  const move = line[base];
  if (world.nextCmd <= MaxCommands && move !== undefined) {
    const commandId = `c${world.nextCmd}`;
    const played = dispatch(
      world,
      [
        { type: 'squareTapped', square: move.slice(0, 2) as never, commandId },
        { type: 'squareTapped', square: move.slice(2, 4) as never, commandId },
      ],
      { nextCmd: world.nextCmd + 1 },
    );
    const { command } = played.board;
    if (command.kind !== 'none' && command.kind !== 'retryable' && command.command.clientCommandId === commandId) {
      steps.push(['Commit', played]);
    }
  }
  steps.push([
    'DismissRetry',
    dispatch(world, [{ type: 'squareTapped', square: 'a5', commandId: 'unused' }]),
  ]);
  steps.push(['Undo', dispatch(world, [{ type: 'undoPressed' }])]);
  if (board.command.kind === 'staged') {
    steps.push([
      'UndoTimerFires',
      dispatch(world, [
        { type: 'undoWindowEnded', clientCommandId: board.command.command.clientCommandId },
      ]),
    ]);
  }
  steps.push(['PageHides', dispatch(world, [{ type: 'pageHidden' }])]);
  steps.push(['Retry', dispatch(world, [{ type: 'retryPressed' }])]);
  steps.push(['Reconcile', dispatch(world, [{ type: 'reconcileWanted', background: true }])]);
  if (board.live) {
    steps.push(['Reconcile', dispatch(world, [{ type: 'reconcileWanted', background: false }])]);
  }
  steps.push(['RefreshPressed', dispatch(world, [{ type: 'refreshRequested' }])]);
  if (board.snapshot.moves.length > 0 && board.reviewPly !== 0) {
    steps.push(['StepBack', dispatch(world, [{ type: 'reviewStepped', step: 'previous' }])]);
  }
  if (board.reviewPly !== null) {
    steps.push(['BackToGame', dispatch(world, [{ type: 'reviewShown', ply: null }])]);
  }
  for (const message of world.net) {
    const net = world.net.filter((other) => other !== message);
    if (message.type === 'getr') {
      const { sync } = board;
      const reading = sync.kind === 'failed' ? null : sync.reading;
      steps.push([
        'Delivery',
        dispatch(
          world,
          [
            {
              type: 'readAnswered',
              requestId: message.cur && reading !== null ? reading : -1,
              snapshot: message.ok
                ? snapshotAt(message.v, message.p, board.live ? 'live' : 'correspondence')
                : null,
            },
          ],
          { net, heard: message.ok ? Math.max(world.heard, message.v) : world.heard },
        ),
      ]);
    }
    if (message.type === 'postr') {
      const { command } = board;
      const matches =
        command.kind === 'sending' &&
        Number(command.command.clientCommandId.slice(1)) === message.id;
      steps.push([
        'Delivery',
        dispatch(
          world,
          [
            {
              type: 'moveAnswered',
              requestId: matches ? command.requestId : -1,
              answer: answerOf(message),
            },
          ],
          {
            net,
            heard:
              message.kind === 'accepted' || message.kind === 'conflict'
                ? Math.max(world.heard, message.v)
                : world.heard,
          },
        ),
      ]);
    }
  }
  return steps;
}

function environmentSteps(world: World): [string, World][] {
  const { server, net } = world;
  const mode = world.board.live ? 'live' : 'correspondence';
  const steps: [string, World][] = [];
  if (server.v < MaxVersion) steps.push(['ServerBumps', { ...world, server: { ...server, v: server.v + 1 } }]);
  if (server.v < MaxVersion && server.p < MaxPly) {
    steps.push(['ServerMoves', { ...world, server: { v: server.v + 1, p: server.p + 1 } }]);
  }
  for (const message of net) {
    const rest = net.filter((other) => other !== message);
    const withNet = (added: Message, extra: Partial<World> = {}): World => ({
      ...world,
      ...extra,
      net: asSet([...rest, added]),
    });
    if (message.type === 'get') {
      steps.push(['ServerAnswers', withNet({ ...message, type: 'getr', v: server.v, p: server.p })]);
    }
    if (message.type === 'post') {
      const known = world.accepted[message.id - 1]!;
      const answer = (kind: string, v: number, p: number): Message => ({
        ...getRequest,
        type: 'postr',
        v,
        p,
        id: message.id,
        base: message.base,
        kind,
      });
      if (known.has) {
        steps.push(['ServerAnswers', withNet(answer('accepted', known.v, known.p))]);
      } else {
        if (message.base === server.p && server.v < MaxVersion && server.p < MaxPly) {
          const after = { v: server.v + 1, p: server.p + 1 };
          steps.push([
            'ServerAnswers',
            withNet(answer('accepted', after.v, after.p), {
              server: after,
              accepted: world.accepted.map((entry, index) =>
                index === message.id - 1 ? { has: true, ...after } : entry,
              ),
            }),
          ]);
        }
        if (message.base !== server.p) {
          steps.push(['ServerAnswers', withNet(answer('conflict', server.v, server.p))]);
        }
        steps.push(['ServerAnswers', withNet(answer('rejected', 0, 0))]);
        if (mode === 'live' && server.v < MaxVersion) {
          steps.push([
            'ServerAnswers',
            withNet(answer('flag', 0, 0), { server: { ...server, v: server.v + 1 } }),
          ]);
        }
      }
    }
    if (world.fails < MaxFailures) {
      const failed = { fails: world.fails + 1 };
      if ((message.type === 'get' || message.type === 'getr') && message.ok) {
        steps.push(['Next', withNet({ ...message, type: 'getr', ok: false, v: 0, p: 0 }, failed)]);
      }
      if (message.type === 'post') {
        steps.push(['Next', withNet({ ...message, type: 'postr', kind: 'unreachable' }, failed)]);
      }
      if (message.type === 'postr' && message.kind !== 'unreachable') {
        steps.push(['Next', withNet({ ...message, kind: 'unreachable', v: 0, p: 0 }, failed)]);
      }
    }
  }
  return steps;
}

function explore() {
  const id = (key: string) => createHash('sha256').update(key).digest('hex').slice(0, 16);
  const lines = new Set<string>();
  const seen = new Set<string>();
  const queue: [World, string][] = [];
  for (const mode of modes) {
    const world: World = {
      board: initialBoardState(snapshotAt(0, 0, mode)),
      server: { v: 0, p: 0 },
      accepted: Array.from({ length: MaxCommands }, () => ({ has: false, v: 0, p: 0 })),
      net: [],
      nextCmd: 1,
      fails: 0,
      heard: 0,
    };
    const key = id(canonical(abstract(world)));
    lines.add(`init ${key}`);
    seen.add(key);
    queue.push([world, key]);
  }
  for (let next = 0; next < queue.length; next += 1) {
    const [world, from] = queue[next]!;
    for (const [label, successor] of [...clientSteps(world), ...environmentSteps(world)]) {
      const to = id(canonical(abstract(successor)));
      if (to !== from) lines.add(`${from} ${label} ${to}`);
      if (!seen.has(to)) {
        seen.add(to);
        queue.push([successor, to]);
      }
    }
  }
  const sorted = [...lines].sort();
  if (process.env.BOARD_GRAPH_OUT) writeFileSync(process.env.BOARD_GRAPH_OUT, sorted.join('\n'));
  return {
    states: seen.size,
    edges: sorted.length - modes.length,
    sha256: createHash('sha256').update(sorted.join('\n')).digest('hex'),
  };
}

describe('board machine conformance', () => {
  it('takes the same steps as the TLA+ model, from every state the model reaches', () => {
    expect(explore()).toEqual({
      states: summary.states,
      edges: summary.edges,
      sha256: summary.sha256,
    });
  }, 120_000);
});
