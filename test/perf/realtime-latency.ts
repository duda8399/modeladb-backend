/**
 * Item 6 — Desempenho do gateway de tempo real.
 *
 * Sobe o backend isolado (MongoDB em memória) num PROCESSO SEPARADO, cria
 * usuários reais, compartilha um diagrama com todos e conecta N clientes
 * socket.io reais. Para cada cenário mede:
 *
 *  1. Latência sem carga: operações enviadas uma de cada vez; mede o tempo
 *     entre o envio e a chegada em CADA um dos outros N-1 participantes.
 *  2. Latência sob carga: todos os clientes enviam operações ao mesmo tempo
 *     (taxa configurável, simula arrastar entidades) durante alguns segundos;
 *     mede latência, vazão de entregas e perdas.
 *  3. Tempo de entrada na sala (conexão + autenticação + join_diagram).
 *  4. Memória (RSS) do processo do servidor.
 *
 * Os clientes rodam todos neste processo, então o relógio é o mesmo para o
 * envio e o recebimento (performance.now), sem erro de sincronização.
 *
 * Uso:
 *   npm run perf:realtime
 *   PERF_CLIENTS=2,10,50 PERF_OPS=300 PERF_LOAD_RATE=20 npm run perf:realtime
 */
import { ChildProcess, spawn } from 'child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { cpus, totalmem } from 'os';
import { join, resolve } from 'path';
import { performance } from 'perf_hooks';
import { io, Socket } from 'socket.io-client';

const ROOT = resolve(__dirname, '..', '..');
const PORT = Number(process.env.PERF_PORT ?? 3111);
const BASE = `http://127.0.0.1:${PORT}`;
const SCENARIOS = (process.env.PERF_CLIENTS ?? '2,5,10,25,50,100')
  .split(',')
  .map(Number);
const OPS = Number(process.env.PERF_OPS ?? 200);
const LOAD_SECONDS = Number(process.env.PERF_LOAD_SECONDS ?? 5);
const LOAD_RATE = Number(process.env.PERF_LOAD_RATE ?? 10);
const OUT_DIR = join(ROOT, 'reports', 'perf');

type User = { id: string; email: string; token: string };

// ---------------------------------------------------------------------------
// Utilitários
// ---------------------------------------------------------------------------

function percentile(sorted: number[], p: number) {
  if (!sorted.length) return NaN;
  const idx = Math.min(
    sorted.length - 1,
    Math.ceil((p / 100) * sorted.length) - 1,
  );
  return sorted[Math.max(0, idx)];
}

function stats(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const mean = sorted.reduce((s, v) => s + v, 0) / (sorted.length || 1);
  return {
    count: sorted.length,
    mean: round(mean),
    p50: round(percentile(sorted, 50)),
    p95: round(percentile(sorted, 95)),
    p99: round(percentile(sorted, 99)),
    max: round(sorted[sorted.length - 1] ?? NaN),
  };
}

function histogram(values: number[], bucketMs = 1) {
  const buckets = new Map<number, number>();
  for (const v of values) {
    const b = Math.floor(v / bucketMs) * bucketMs;
    buckets.set(b, (buckets.get(b) ?? 0) + 1);
  }
  return [...buckets.entries()].sort((a, b) => a[0] - b[0]);
}

const round = (v: number) => Math.round(v * 100) / 100;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function serverRssMb(pid: number) {
  try {
    const status = readFileSync(`/proc/${pid}/status`, 'utf8');
    const kb = Number(/VmRSS:\s+(\d+)/.exec(status)?.[1]);
    return round(kb / 1024);
  } catch {
    return NaN;
  }
}

async function http<T>(
  path: string,
  body: unknown,
  token?: string,
): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path} → ${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Servidor e usuários
// ---------------------------------------------------------------------------

function startServer(): Promise<ChildProcess> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(
      process.execPath,
      [
        require.resolve('ts-node/dist/bin.js', { paths: [ROOT] }),
        '--transpile-only',
        '-r',
        'tsconfig-paths/register',
        'test/support/test-server.ts',
      ],
      {
        cwd: ROOT,
        env: { ...process.env, PORT: String(PORT) },
        stdio: ['ignore', 'pipe', 'inherit'],
      },
    );

    const timer = setTimeout(
      () => reject(new Error('servidor não subiu em 60s')),
      60_000,
    );
    child.stdout.on('data', (chunk: Buffer) => {
      if (chunk.toString().includes('MODELADB_TEST_SERVER_READY')) {
        clearTimeout(timer);
        resolvePromise(child);
      }
    });
    child.on('exit', (code) =>
      reject(new Error(`servidor saiu com código ${code}`)),
    );
  });
}

async function createUsers(count: number): Promise<User[]> {
  const users: User[] = [];
  for (let i = 0; i < count; i += 10) {
    const batch = await Promise.all(
      Array.from({ length: Math.min(10, count - i) }, async (_, j) => {
        const email = `perf-${i + j}-${Date.now()}@perf.modeladb`;
        const password = 'senha-perf-123';
        await http('/auth/register', {
          name: `Perf ${i + j}`,
          email,
          password,
        });
        const login = await http<{ userId: string; accessToken: string }>(
          '/auth/login',
          { email, password },
        );
        return { id: login.userId, email, token: login.accessToken };
      }),
    );
    users.push(...batch);
  }
  return users;
}

async function prepareDiagram(users: User[]) {
  const [owner, ...others] = users;
  const diagram = await http<{ id: string }>(
    '/diagram/create',
    { name: 'Perf' },
    owner.token,
  );
  for (const user of others) {
    await http(
      `/diagram/${diagram.id}/collaborators`,
      { email: user.email, role: 'EDITOR' },
      owner.token,
    );
  }
  return diagram.id;
}

// ---------------------------------------------------------------------------
// Clientes
// ---------------------------------------------------------------------------

type Client = { user: User; socket: Socket };

async function connectAll(users: User[], diagramId: string) {
  const joinTimes: number[] = [];

  const clients = await Promise.all(
    users.map(
      (user) =>
        new Promise<Client>((resolvePromise, reject) => {
          const start = performance.now();
          const socket = io(BASE, {
            auth: { token: user.token },
            transports: ['websocket'],
            reconnection: false,
            forceNew: true,
          });
          const timer = setTimeout(
            () => reject(new Error('join timeout')),
            15_000,
          );
          socket.on('connect', () =>
            socket.emit('join_diagram', { diagramId }),
          );
          socket.on('presence', (p: { type: string }) => {
            if (p.type !== 'ONLINE_USERS') return;
            clearTimeout(timer);
            joinTimes.push(performance.now() - start);
            resolvePromise({ user, socket });
          });
          socket.on('error', (e) => reject(new Error(JSON.stringify(e))));
        }),
    ),
  );

  return { clients, joinTimes };
}

type Tracker = {
  latencies: number[];
  expected: number;
  received: number;
  pending: Map<
    string,
    { sentAt: number; remaining: number; done?: () => void }
  >;
};

function track(clients: Client[]): Tracker {
  const tracker: Tracker = {
    latencies: [],
    expected: 0,
    received: 0,
    pending: new Map(),
  };

  for (const { socket } of clients) {
    socket.on('operation', (op: { opId: string }) => {
      const now = performance.now();
      const entry = tracker.pending.get(op.opId);
      if (!entry) return;
      tracker.latencies.push(now - entry.sentAt);
      tracker.received++;
      if (--entry.remaining === 0) {
        tracker.pending.delete(op.opId);
        entry.done?.();
      }
    });
  }

  return tracker;
}

let opSeq = 0;
function send(
  tracker: Tracker,
  client: Client,
  receivers: number,
  done?: () => void,
) {
  const opId = `perf-${++opSeq}`;
  tracker.pending.set(opId, {
    sentAt: performance.now(),
    remaining: receivers,
    done,
  });
  tracker.expected += receivers;
  client.socket.emit('operation', {
    opId,
    type: 'MOVE_NODE',
    targetId: 'n1',
    userId: client.user.id,
    lamport: opSeq,
    payload: { x: Math.random() * 1000, y: Math.random() * 1000 },
  });
}

async function unloadedLatency(clients: Client[]) {
  const tracker = track(clients);
  const receivers = clients.length - 1;

  for (let i = 0; i < OPS; i++) {
    await new Promise<void>((resolvePromise, reject) => {
      const timer = setTimeout(
        () => reject(new Error('operação não entregue em 5s')),
        5000,
      );
      send(tracker, clients[i % clients.length], receivers, () => {
        clearTimeout(timer);
        resolvePromise();
      });
    });
  }

  clients.forEach((c) => c.socket.off('operation'));
  return tracker;
}

async function loadedLatency(clients: Client[]) {
  const tracker = track(clients);
  const receivers = clients.length - 1;
  const intervalMs = 1000 / LOAD_RATE;

  const start = performance.now();
  const timers = clients.map((client, i) => {
    let timer: NodeJS.Timeout;
    // Desencontra os clientes para não enviarem todos no mesmo milissegundo.
    const startDelay = setTimeout(
      () => {
        timer = setInterval(() => send(tracker, client, receivers), intervalMs);
      },
      (i * intervalMs) / clients.length,
    );
    return () => {
      clearTimeout(startDelay);
      clearInterval(timer);
    };
  });

  await sleep(LOAD_SECONDS * 1000);
  timers.forEach((stop) => stop());
  const sendWindow = (performance.now() - start) / 1000;

  // Espera as últimas mensagens chegarem.
  const drainDeadline = performance.now() + 5000;
  while (
    tracker.received < tracker.expected &&
    performance.now() < drainDeadline
  ) {
    await sleep(50);
  }

  clients.forEach((c) => c.socket.off('operation'));
  return { tracker, sendWindow };
}

// ---------------------------------------------------------------------------
// Execução
// ---------------------------------------------------------------------------

async function main() {
  const server = await startServer();
  const results: Record<string, unknown>[] = [];

  try {
    const maxClients = Math.max(...SCENARIOS);
    console.log(`Criando ${maxClients} usuários...`);
    const users = await createUsers(maxClients);
    const baselineRss = serverRssMb(server.pid!);

    for (const n of SCENARIOS) {
      const diagramId = await prepareDiagram(users.slice(0, n));
      const { clients, joinTimes } = await connectAll(
        users.slice(0, n),
        diagramId,
      );
      await sleep(300);

      const unloaded = await unloadedLatency(clients);
      const { tracker: loaded, sendWindow } = await loadedLatency(clients);
      const rss = serverRssMb(server.pid!);

      const row = {
        clients: n,
        join: stats(joinTimes),
        unloaded: stats(unloaded.latencies),
        loaded: {
          ...stats(loaded.latencies),
          opsPerSecondSent: round(loaded.expected / (n - 1) / sendWindow),
          deliveriesPerSecond: round(loaded.received / sendWindow),
          lossRate: round(1 - loaded.received / loaded.expected),
        },
        serverRssMb: rss,
      };
      results.push(row);

      mkdirSync(OUT_DIR, { recursive: true });
      writeFileSync(
        join(OUT_DIR, `histogram-unloaded-${n}.csv`),
        [
          'latencia_ms,quantidade',
          ...histogram(unloaded.latencies).map(([b, c]) => `${b},${c}`),
        ].join('\n'),
      );

      console.log(
        `N=${String(n).padStart(3)} | sem carga p50=${row.unloaded.p50}ms p95=${row.unloaded.p95}ms ` +
          `| com carga p50=${row.loaded.p50}ms p95=${row.loaded.p95}ms ` +
          `entregas/s=${row.loaded.deliveriesPerSecond} perdas=${row.loaded.lossRate} | RSS=${rss}MB`,
      );

      clients.forEach((c) => c.socket.disconnect());
      await sleep(300);
    }

    const environment = {
      date: new Date().toISOString(),
      node: process.version,
      cpu: cpus()[0]?.model,
      cores: cpus().length,
      memoryGb: round(totalmem() / 1024 ** 3),
      opsPerScenario: OPS,
      loadSeconds: LOAD_SECONDS,
      loadRatePerClient: LOAD_RATE,
      serverBaselineRssMb: baselineRss,
    };

    writeFileSync(
      join(OUT_DIR, 'realtime-latency.json'),
      JSON.stringify({ environment, results }, null, 2),
    );
    writeFileSync(join(OUT_DIR, 'realtime-latency.csv'), toCsv(results));
    writeFileSync(
      join(OUT_DIR, 'realtime-latency.md'),
      toMarkdown(environment, results),
    );
    console.log(`\nRelatórios salvos em ${OUT_DIR}`);
  } finally {
    server.kill('SIGTERM');
  }
}

function toCsv(results: any[]) {
  const header =
    'clientes,entrada_p50_ms,entrada_p95_ms,sem_carga_media_ms,sem_carga_p50_ms,sem_carga_p95_ms,sem_carga_p99_ms,sem_carga_max_ms,' +
    'carga_ops_por_s,carga_entregas_por_s,carga_p50_ms,carga_p95_ms,carga_p99_ms,carga_max_ms,carga_perdas,servidor_rss_mb';
  const rows = results.map((r) =>
    [
      r.clients,
      r.join.p50,
      r.join.p95,
      r.unloaded.mean,
      r.unloaded.p50,
      r.unloaded.p95,
      r.unloaded.p99,
      r.unloaded.max,
      r.loaded.opsPerSecondSent,
      r.loaded.deliveriesPerSecond,
      r.loaded.p50,
      r.loaded.p95,
      r.loaded.p99,
      r.loaded.max,
      r.loaded.lossRate,
      r.serverRssMb,
    ].join(','),
  );
  return [header, ...rows].join('\n');
}

function toMarkdown(env: any, results: any[]) {
  return [
    '# Desempenho do gateway de tempo real',
    '',
    `Gerado por \`npm run perf:realtime\` em ${env.date}.`,
    '',
    `Ambiente: ${env.cpu} (${env.cores} núcleos), ${env.memoryGb} GB de RAM, Node ${env.node}. ` +
      `Servidor e clientes na mesma máquina (rede local, sem latência de internet).`,
    '',
    `Sem carga: ${env.opsPerScenario} operações enviadas uma de cada vez. ` +
      `Com carga: cada cliente envia ${env.loadRatePerClient} operações/s durante ${env.loadSeconds} s.`,
    '',
    '| Clientes | Entrada na sala p95 (ms) | Sem carga p50 (ms) | Sem carga p95 (ms) | Sem carga p99 (ms) | Com carga: entregas/s | Com carga p50 (ms) | Com carga p95 (ms) | Perdas | RSS servidor (MB) |',
    '|---|---|---|---|---|---|---|---|---|---|',
    ...results.map(
      (r) =>
        `| ${r.clients} | ${r.join.p95} | ${r.unloaded.p50} | ${r.unloaded.p95} | ${r.unloaded.p99} | ` +
        `${r.loaded.deliveriesPerSecond} | ${r.loaded.p50} | ${r.loaded.p95} | ${(r.loaded.lossRate * 100).toFixed(1)}% | ${r.serverRssMb} |`,
    ),
    '',
    'A latência é medida do envio pelo cliente até a chegada em cada um dos demais participantes da sala.',
    '',
  ].join('\n');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
