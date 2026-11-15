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
 *   PERF_CLIENTS=2,10,50 PERF_OPS=300 PERF_LOAD_RATE=20 PERF_REPEATS=10 npm run perf:realtime
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
const REPEATS = Math.max(1, Number(process.env.PERF_REPEATS ?? 10));
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

const T_975 = [
  12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228,
  2.201, 2.179, 2.16, 2.145, 2.131, 2.12, 2.11, 2.101, 2.093, 2.086, 2.08,
  2.074, 2.069, 2.064, 2.06, 2.056, 2.052, 2.048, 2.045, 2.042,
];

type Dispersion = {
  n: number;
  mean: number;
  sd: number;
  cvPercent: number;
  min: number;
  max: number;
  ci95Low: number;
  ci95High: number;
};

function dispersion(raw: number[]): Dispersion {
  const values = raw.filter((v) => Number.isFinite(v));
  const n = values.length;
  const mean = values.reduce((s, v) => s + v, 0) / (n || 1);
  const variance =
    n > 1 ? values.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1) : 0;
  const sd = Math.sqrt(variance);
  const t = n > 1 ? (T_975[n - 2] ?? 1.96) : 0;
  const half = n > 1 ? (t * sd) / Math.sqrt(n) : 0;
  return {
    n,
    mean: round(mean),
    sd: round(sd),
    cvPercent: mean !== 0 ? round((sd / mean) * 100) : 0,
    min: round(n ? Math.min(...values) : NaN),
    max: round(n ? Math.max(...values) : NaN),
    ci95Low: round(mean - half),
    ci95High: round(mean + half),
  };
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

type RunRow = {
  clients: number;
  repetition: number;
  join: ReturnType<typeof stats>;
  unloaded: ReturnType<typeof stats>;
  loaded: ReturnType<typeof stats> & {
    opsPerSecondSent: number;
    deliveriesPerSecond: number;
    lossRate: number;
  };
  serverRssMb: number;
};

const METRICS: [string, (r: RunRow) => number][] = [
  ['join.p50', (r) => r.join.p50],
  ['join.p95', (r) => r.join.p95],
  ['unloaded.mean', (r) => r.unloaded.mean],
  ['unloaded.p50', (r) => r.unloaded.p50],
  ['unloaded.p95', (r) => r.unloaded.p95],
  ['unloaded.p99', (r) => r.unloaded.p99],
  ['unloaded.max', (r) => r.unloaded.max],
  ['loaded.mean', (r) => r.loaded.mean],
  ['loaded.p50', (r) => r.loaded.p50],
  ['loaded.p95', (r) => r.loaded.p95],
  ['loaded.p99', (r) => r.loaded.p99],
  ['loaded.max', (r) => r.loaded.max],
  ['loaded.opsPerSecondSent', (r) => r.loaded.opsPerSecondSent],
  ['loaded.deliveriesPerSecond', (r) => r.loaded.deliveriesPerSecond],
  ['loaded.lossRate', (r) => r.loaded.lossRate],
  ['serverRssMb', (r) => r.serverRssMb],
];

async function runOnce(
  users: User[],
  diagramId: string,
  repetition: number,
  serverPid: number,
) {
  const n = users.length;
  const { clients, joinTimes } = await connectAll(users, diagramId);
  await sleep(300);

  const unloaded = await unloadedLatency(clients);
  const { tracker: loaded, sendWindow } = await loadedLatency(clients);
  const rss = serverRssMb(serverPid);

  clients.forEach((c) => c.socket.disconnect());
  await sleep(300);

  const row: RunRow = {
    clients: n,
    repetition,
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

  return {
    row,
    unloadedLatencies: unloaded.latencies,
    loadedLatencies: loaded.latencies,
  };
}

function summarize(runs: RunRow[]) {
  return Object.fromEntries(
    METRICS.map(([key, get]) => [key, dispersion(runs.map(get))]),
  ) as Record<string, Dispersion>;
}

const fmt = (d: Dispersion) => `${d.mean} ± ${d.sd}`;

async function main() {
  const server = await startServer();
  const runs: RunRow[] = [];
  const results: Record<string, any>[] = [];

  try {
    const maxClients = Math.max(...SCENARIOS);
    console.log(`Criando ${maxClients} usuários...`);
    const users = await createUsers(maxClients);
    const baselineRss = serverRssMb(server.pid!);
    mkdirSync(OUT_DIR, { recursive: true });

    for (const n of SCENARIOS) {
      const scenarioUsers = users.slice(0, n);
      const diagramId = await prepareDiagram(scenarioUsers);
      const scenarioRuns: RunRow[] = [];
      const pooledUnloaded: number[] = [];
      const pooledLoaded: number[] = [];

      for (let rep = 1; rep <= REPEATS; rep++) {
        const { row, unloadedLatencies, loadedLatencies } = await runOnce(
          scenarioUsers,
          diagramId,
          rep,
          server.pid!,
        );
        scenarioRuns.push(row);
        pooledUnloaded.push(...unloadedLatencies);
        pooledLoaded.push(...loadedLatencies);

        console.log(
          `N=${String(n).padStart(3)} #${String(rep).padStart(2)}/${REPEATS} | ` +
            `sem carga p50=${row.unloaded.p50}ms p95=${row.unloaded.p95}ms ` +
            `| com carga p50=${row.loaded.p50}ms p95=${row.loaded.p95}ms ` +
            `entregas/s=${row.loaded.deliveriesPerSecond} perdas=${row.loaded.lossRate} | RSS=${row.serverRssMb}MB`,
        );
      }

      runs.push(...scenarioRuns);
      const metrics = summarize(scenarioRuns);
      results.push({
        clients: n,
        repetitions: REPEATS,
        metrics,
        pooled: {
          unloaded: stats(pooledUnloaded),
          loaded: stats(pooledLoaded),
        },
      });

      writeFileSync(
        join(OUT_DIR, `histogram-unloaded-${n}.csv`),
        [
          'latencia_ms,quantidade',
          ...histogram(pooledUnloaded).map(([b, c]) => `${b},${c}`),
        ].join('\n'),
      );

      console.log(
        `N=${String(n).padStart(3)} resumo (média ± dp, CV) | ` +
          `sem carga p95=${fmt(metrics['unloaded.p95'])}ms (${metrics['unloaded.p95'].cvPercent}%) ` +
          `| com carga p95=${fmt(metrics['loaded.p95'])}ms (${metrics['loaded.p95'].cvPercent}%) ` +
          `| entregas/s=${fmt(metrics['loaded.deliveriesPerSecond'])}\n`,
      );
    }

    const environment = {
      date: new Date().toISOString(),
      node: process.version,
      cpu: cpus()[0]?.model,
      cores: cpus().length,
      memoryGb: round(totalmem() / 1024 ** 3),
      repetitions: REPEATS,
      opsPerScenario: OPS,
      loadSeconds: LOAD_SECONDS,
      loadRatePerClient: LOAD_RATE,
      serverBaselineRssMb: baselineRss,
    };

    writeFileSync(
      join(OUT_DIR, 'realtime-latency.json'),
      JSON.stringify({ environment, results, runs }, null, 2),
    );
    writeFileSync(join(OUT_DIR, 'realtime-latency.csv'), toSummaryCsv(results));
    writeFileSync(
      join(OUT_DIR, 'realtime-latency-repeticoes.csv'),
      toRunsCsv(runs),
    );
    writeFileSync(
      join(OUT_DIR, 'realtime-latency.md'),
      toMarkdown(environment, results),
    );
    console.log(`Relatórios salvos em ${OUT_DIR}`);
  } finally {
    server.kill('SIGTERM');
  }
}

function toSummaryCsv(results: any[]) {
  const header =
    'clientes,metrica,repeticoes,media,desvio_padrao,cv_percent,min,max,ic95_inf,ic95_sup';
  const rows = results.flatMap((r) =>
    METRICS.map(([key]) => {
      const d: Dispersion = r.metrics[key];
      return [
        r.clients,
        key,
        d.n,
        d.mean,
        d.sd,
        d.cvPercent,
        d.min,
        d.max,
        d.ci95Low,
        d.ci95High,
      ].join(',');
    }),
  );
  return [header, ...rows].join('\n');
}

function toRunsCsv(runs: RunRow[]) {
  const header =
    'clientes,repeticao,entrada_p50_ms,entrada_p95_ms,sem_carga_media_ms,sem_carga_p50_ms,sem_carga_p95_ms,sem_carga_p99_ms,sem_carga_max_ms,' +
    'carga_media_ms,carga_ops_por_s,carga_entregas_por_s,carga_p50_ms,carga_p95_ms,carga_p99_ms,carga_max_ms,carga_perdas,servidor_rss_mb';
  const rows = runs.map((r) =>
    [
      r.clients,
      r.repetition,
      r.join.p50,
      r.join.p95,
      r.unloaded.mean,
      r.unloaded.p50,
      r.unloaded.p95,
      r.unloaded.p99,
      r.unloaded.max,
      r.loaded.mean,
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
  const m = (r: any, key: string) => r.metrics[key] as Dispersion;
  const pct = (d: Dispersion) =>
    `${(d.mean * 100).toFixed(1)}% ± ${(d.sd * 100).toFixed(1)}`;
  const ci = (d: Dispersion) => `[${d.ci95Low}; ${d.ci95High}]`;

  return [
    '# Desempenho do gateway de tempo real',
    '',
    `Gerado por \`npm run perf:realtime\` em ${env.date}.`,
    '',
    `Ambiente: ${env.cpu} (${env.cores} núcleos), ${env.memoryGb} GB de RAM, Node ${env.node}. ` +
      `Servidor e clientes na mesma máquina (rede local, sem latência de internet).`,
    '',
    `Cada cenário foi executado ${env.repetitions} vezes. Sem carga: ${env.opsPerScenario} operações enviadas uma de cada vez. ` +
      `Com carga: cada cliente envia ${env.loadRatePerClient} operações/s durante ${env.loadSeconds} s.`,
    '',
    `Os valores são média ± desvio padrão amostral das ${env.repetitions} repetições; ` +
      'cada repetição contribui com um valor de cada métrica (por exemplo, o p95 daquela execução).',
    '',
    '| Clientes | Entrada na sala p95 (ms) | Sem carga p50 (ms) | Sem carga p95 (ms) | Sem carga p99 (ms) | Com carga: entregas/s | Com carga p50 (ms) | Com carga p95 (ms) | Perdas | RSS servidor (MB) |',
    '|---|---|---|---|---|---|---|---|---|---|',
    ...results.map(
      (r) =>
        `| ${r.clients} | ${fmt(m(r, 'join.p95'))} | ${fmt(m(r, 'unloaded.p50'))} | ${fmt(m(r, 'unloaded.p95'))} | ${fmt(m(r, 'unloaded.p99'))} | ` +
        `${fmt(m(r, 'loaded.deliveriesPerSecond'))} | ${fmt(m(r, 'loaded.p50'))} | ${fmt(m(r, 'loaded.p95'))} | ${pct(m(r, 'loaded.lossRate'))} | ${fmt(m(r, 'serverRssMb'))} |`,
    ),
    '',
    '## Dispersão do p95 entre repetições',
    '',
    'CV = coeficiente de variação (desvio padrão / média). IC 95% = intervalo de confiança da média pela distribuição t de Student.',
    '',
    '| Clientes | Sem carga p95: CV | Sem carga p95: mín–máx (ms) | Sem carga p95: IC 95% (ms) | Com carga p95: CV | Com carga p95: mín–máx (ms) | Com carga p95: IC 95% (ms) |',
    '|---|---|---|---|---|---|---|',
    ...results.map((r) => {
      const u = m(r, 'unloaded.p95');
      const l = m(r, 'loaded.p95');
      return (
        `| ${r.clients} | ${u.cvPercent}% | ${u.min}–${u.max} | ${ci(u)} | ` +
        `${l.cvPercent}% | ${l.min}–${l.max} | ${ci(l)} |`
      );
    }),
    '',
    'A latência é medida do envio pelo cliente até a chegada em cada um dos demais participantes da sala. ' +
      'O resumo por repetição está em `realtime-latency-repeticoes.csv` e as estatísticas de todas as métricas em `realtime-latency.csv`.',
    '',
  ].join('\n');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
