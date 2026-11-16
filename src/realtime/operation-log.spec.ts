import { OperationLog } from './operation-log';

describe('OperationLog', () => {
  it('numera as operações em sequência por diagrama', () => {
    const log = new OperationLog();

    expect(log.append('d1', 'a').seq).toBe(1);
    expect(log.append('d1', 'b').seq).toBe(2);
    expect(log.append('d2', 'x').seq).toBe(1);
  });

  it('a primeira entrada recebe só a posição atual, sem operações', () => {
    const log = new OperationLog();
    const { epoch } = log.append('d1', 'a');

    expect(log.since('d1')).toEqual({
      epoch,
      seq: 1,
      ops: [],
      complete: true,
      initial: true,
    });
  });

  it('devolve as operações perdidas depois da última vista', () => {
    const log = new OperationLog();
    const { epoch } = log.append('d1', 'a');
    log.append('d1', 'b');
    log.append('d1', 'c');

    expect(log.since('d1', { epoch, seq: 1 })).toEqual(
      expect.objectContaining({ ops: ['b', 'c'], complete: true, seq: 3 }),
    );
    expect(log.since('d1', { epoch, seq: 3 }).ops).toEqual([]);
  });

  it('marca como incompleto quando a época mudou', () => {
    const log = new OperationLog();
    const { epoch } = log.append('d1', 'a');
    log.reset('d1');
    log.append('d1', 'b');

    const sync = log.since('d1', { epoch, seq: 1 });

    expect(sync.complete).toBe(false);
    expect(sync.epoch).not.toBe(epoch);
  });

  it('com época nova, devolve todas as operações dela se o log ainda está inteiro', () => {
    const log = new OperationLog();
    const { epoch } = log.append('d1', 'a');
    log.reset('d1');
    log.append('d1', 'b');
    log.append('d1', 'c');

    expect(log.since('d1', { epoch, seq: 1 })).toEqual(
      expect.objectContaining({ ops: ['b', 'c'], complete: false, seq: 2 }),
    );
  });

  it('com época nova e log já truncado, não devolve operações', () => {
    const log = new OperationLog(2);
    const { epoch } = log.append('d1', 'a');
    log.reset('d1');
    log.append('d1', 'b');
    log.append('d1', 'c');
    log.append('d1', 'd');

    expect(log.since('d1', { epoch, seq: 1 })).toEqual(
      expect.objectContaining({ ops: [], complete: false }),
    );
  });

  it('marca como incompleto quando as operações perdidas já saíram do log', () => {
    const log = new OperationLog(2);
    const { epoch } = log.append('d1', 'a');
    log.append('d1', 'b');
    log.append('d1', 'c');
    log.append('d1', 'd');

    expect(log.since('d1', { epoch, seq: 1 }).complete).toBe(false);
    expect(log.since('d1', { epoch, seq: 2 })).toEqual(
      expect.objectContaining({ ops: ['c', 'd'], complete: true }),
    );
  });

  it('marca como incompleto um cursor à frente do servidor', () => {
    const log = new OperationLog();
    const { epoch } = log.append('d1', 'a');

    expect(log.since('d1', { epoch, seq: 9 }).complete).toBe(false);
  });

  it('descarta logs ociosos de salas vazias', () => {
    let now = 0;
    const log = new OperationLog(10, () => now);
    log.append('ocioso', 'a');
    log.append('ativo', 'b');
    now = 60_000;

    log.prune(30_000, (id) => id === 'ativo');

    expect(log.has('ocioso')).toBe(false);
    expect(log.has('ativo')).toBe(true);
  });
});
