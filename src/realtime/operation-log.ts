import { randomUUID } from 'crypto';

export type SyncCursor = { epoch?: unknown; seq?: unknown };

export type OperationMeta = { epoch: string; seq: number };

export type SyncPayload = OperationMeta & {
  ops: unknown[];
  complete: boolean;
  initial: boolean;
};

type DiagramLog = OperationMeta & {
  entries: { seq: number; op: unknown }[];
  touchedAt: number;
};

export class OperationLog {
  private readonly logs = new Map<string, DiagramLog>();

  constructor(
    private readonly maxEntries = 5000,
    private readonly now: () => number = Date.now,
  ) {}

  append(diagramId: string, op: unknown): OperationMeta {
    const log = this.get(diagramId);

    log.seq += 1;
    log.entries.push({ seq: log.seq, op });
    log.touchedAt = this.now();

    if (log.entries.length > this.maxEntries) {
      log.entries.splice(0, log.entries.length - this.maxEntries);
    }

    return { epoch: log.epoch, seq: log.seq };
  }

  since(diagramId: string, cursor?: SyncCursor | null): SyncPayload {
    const log = this.get(diagramId);
    const base = { epoch: log.epoch, seq: log.seq };

    if (!cursor || typeof cursor.seq !== 'number') {
      return { ...base, ops: [], complete: true, initial: true };
    }

    const seq = cursor.seq;
    const oldest = log.entries[0]?.seq ?? log.seq + 1;
    const sameEpoch = cursor.epoch === log.epoch;
    const covered = seq >= oldest - 1 && seq <= log.seq;

    if (!sameEpoch || !covered) {
      const wholeEpoch = !sameEpoch && log.entries[0]?.seq === 1;
      return {
        ...base,
        ops: wholeEpoch ? log.entries.map((e) => e.op) : [],
        complete: false,
        initial: false,
      };
    }

    return {
      ...base,
      ops: log.entries.filter((e) => e.seq > seq).map((e) => e.op),
      complete: true,
      initial: false,
    };
  }

  reset(diagramId: string) {
    this.logs.set(diagramId, this.create());
  }

  drop(diagramId: string) {
    this.logs.delete(diagramId);
  }

  prune(maxIdleMs: number, isActive: (diagramId: string) => boolean) {
    const limit = this.now() - maxIdleMs;

    for (const [diagramId, log] of this.logs) {
      if (log.touchedAt < limit && !isActive(diagramId)) {
        this.logs.delete(diagramId);
      }
    }
  }

  has(diagramId: string) {
    return this.logs.has(diagramId);
  }

  private get(diagramId: string): DiagramLog {
    let log = this.logs.get(diagramId);

    if (!log) {
      log = this.create();
      this.logs.set(diagramId, log);
    }

    return log;
  }

  private create(): DiagramLog {
    return { epoch: randomUUID(), seq: 0, entries: [], touchedAt: this.now() };
  }
}
