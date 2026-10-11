import { io, Socket } from 'socket.io-client';
import {
  TestContext,
  TestUser,
  auth,
  connectSocket,
  createDiagram,
  createTestApp,
  expectNoEvent,
  joinDiagram,
  nextEvent,
  registerAndLogin,
  share,
} from './support/test-app';

function sampleOperation(userId: string, n = 1) {
  return {
    opId: `op-${userId}-${n}-${Date.now()}`,
    type: 'MOVE_NODE',
    targetId: 'n1',
    userId,
    lamport: n,
    payload: { x: n * 10, y: n * 20 },
  };
}

/**
 * Item 4 — Gateway de tempo real (Socket.IO).
 * Usa clientes socket.io-client reais conectados à aplicação completa.
 */
describe('Gateway de tempo real (integração)', () => {
  let ctx: TestContext;
  let owner: TestUser;
  let editor: TestUser;
  let viewer: TestUser;
  let stranger: TestUser;
  let diagramId: string;
  const openSockets: Socket[] = [];

  const track = (socket: Socket) => {
    openSockets.push(socket);
    return socket;
  };

  async function join(user: TestUser, id = diagramId) {
    const result = await joinDiagram(ctx, user, id);
    track(result.socket);
    return result;
  }

  beforeAll(async () => {
    ctx = await createTestApp();
    owner = await registerAndLogin(ctx, 'dono');
    editor = await registerAndLogin(ctx, 'editor');
    viewer = await registerAndLogin(ctx, 'leitor');
    stranger = await registerAndLogin(ctx, 'estranho');

    diagramId = await createDiagram(ctx, owner, 'Diagrama em tempo real');
    await share(ctx, owner, diagramId, editor, 'EDITOR');
    await share(ctx, owner, diagramId, viewer, 'VIEWER');
  });

  afterEach(() => {
    openSockets.splice(0).forEach((s) => s.disconnect());
  });

  afterAll(async () => {
    await ctx.close();
  });

  describe('autenticação do handshake', () => {
    it('recusa conexão sem token', async () => {
      const socket = track(connectSocket(ctx));
      const error = nextEvent(socket, 'error');
      const disconnected = nextEvent(socket, 'disconnect');

      expect(await error).toEqual({ message: 'Não autorizado' });
      await disconnected;
    });

    it('recusa conexão com token inválido', async () => {
      const socket = track(connectSocket(ctx, 'token-invalido'));
      const error = nextEvent(socket, 'error');
      const disconnected = nextEvent(socket, 'disconnect');

      expect(await error).toEqual({ message: 'Não autorizado' });
      await disconnected;
    });

    it('aceita token também pelo cabeçalho Authorization', async () => {
      const socket = track(
        io(ctx.baseUrl, {
          transports: ['websocket'],
          reconnection: false,
          forceNew: true,
          extraHeaders: { Authorization: `Bearer ${owner.token}` },
        }),
      );
      await nextEvent(socket, 'connect');

      const presence = nextEvent(socket, 'presence');
      socket.emit('join_diagram', { diagramId });
      expect(await presence).toEqual(
        expect.objectContaining({ type: 'ONLINE_USERS' }),
      );
    });
  });

  describe('entrada na sala do diagrama', () => {
    it('recusa quem não tem acesso ao diagrama', async () => {
      const socket = track(connectSocket(ctx, stranger.token));
      await nextEvent(socket, 'connect');

      socket.emit('join_diagram', { diagramId });

      expect(await nextEvent(socket, 'error')).toEqual({
        message: 'Sem acesso a este diagrama',
      });
    });

    it('recusa diagrama inexistente', async () => {
      const socket = track(connectSocket(ctx, owner.token));
      await nextEvent(socket, 'connect');

      socket.emit('join_diagram', { diagramId: '000000000000000000000000' });

      expect(await nextEvent(socket, 'error')).toEqual({
        message: 'Sem acesso a este diagrama',
      });
    });

    it('quem entra recebe a lista de usuários online (sem incluir a si mesmo)', async () => {
      const a = await join(owner);
      expect(a.onlineUsers).toEqual([]);

      const b = await join(editor);
      expect(b.onlineUsers).toEqual([{ userId: owner.id, email: owner.email }]);
    });

    it('os demais recebem USER_JOINED com id e e-mail', async () => {
      const a = await join(owner);

      const joined = nextEvent(
        a.socket,
        'presence',
        2000,
        (p) => p.type === 'USER_JOINED',
      );
      await join(editor);

      expect(await joined).toEqual({
        type: 'USER_JOINED',
        userId: editor.id,
        email: editor.email,
      });
    });

    it('ao desconectar, os demais recebem USER_LEFT', async () => {
      const a = await join(owner);
      const b = await join(editor);

      const left = nextEvent(
        a.socket,
        'presence',
        2000,
        (p) => p.type === 'USER_LEFT',
      );
      b.socket.disconnect();

      expect(await left).toEqual({ type: 'USER_LEFT', userId: editor.id });
    });
  });

  describe('difusão de operações', () => {
    it('a operação de um EDITOR chega intacta aos outros participantes', async () => {
      const a = await join(owner);
      const b = await join(editor);
      const c = await join(viewer);

      const op = sampleOperation(editor.id);
      const toOwner = nextEvent(a.socket, 'operation');
      const toViewer = nextEvent(c.socket, 'operation');
      const echo = expectNoEvent(b.socket, 'operation');

      b.socket.emit('operation', op);

      expect(await toOwner).toEqual(op);
      expect(await toViewer).toEqual(op);
      await echo; // o remetente não recebe a própria operação de volta
    });

    it('preserva a ordem de envio de um mesmo remetente (FIFO)', async () => {
      const a = await join(owner);
      const b = await join(editor);

      const received: number[] = [];
      const done = new Promise<void>((resolve) => {
        a.socket.on('operation', (op) => {
          received.push(op.lamport);
          if (received.length === 50) resolve();
        });
      });

      for (let i = 1; i <= 50; i++)
        b.socket.emit('operation', sampleOperation(editor.id, i));
      await done;

      expect(received).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
    });

    it('a operação de um VIEWER é recusada e não é difundida', async () => {
      const a = await join(owner);
      const c = await join(viewer);

      const silence = expectNoEvent(a.socket, 'operation');
      const error = nextEvent(c.socket, 'error');

      c.socket.emit('operation', sampleOperation(viewer.id));

      expect(await error).toEqual({ message: 'Sem permissão para editar' });
      await silence;
    });

    it('operações não vazam para a sala de outro diagrama', async () => {
      const otherDiagram = await createDiagram(ctx, owner, 'Outro diagrama');
      await share(ctx, owner, otherDiagram, editor, 'EDITOR');

      const inRoom = await join(owner);
      const elsewhere = await join(editor, otherDiagram);
      const sender = await join(editor);

      const delivered = nextEvent(inRoom.socket, 'operation');
      const silence = expectNoEvent(elsewhere.socket, 'operation');

      sender.socket.emit('operation', sampleOperation(editor.id));

      await delivered;
      await silence;
    });

    it('operações enviadas antes de entrar numa sala são ignoradas', async () => {
      const a = await join(owner);
      const outsider = track(connectSocket(ctx, editor.token));
      await nextEvent(outsider, 'connect');

      const silence = expectNoEvent(a.socket, 'operation');
      outsider.emit('operation', sampleOperation(editor.id));
      await silence;
    });
  });

  describe('cursores', () => {
    it('repassa a posição do cursor identificando o autor', async () => {
      const a = await join(owner);
      const b = await join(viewer);

      const cursor = nextEvent(a.socket, 'cursor');
      b.socket.emit('cursor', { x: 12.5, y: -3 });

      expect(await cursor).toEqual({ userId: viewer.id, x: 12.5, y: -3 });
    });
  });

  describe('controle de acesso em conexões abertas', () => {
    it('um cliente não consegue se passar por outro no evento de cursor', async () => {
      const a = await join(owner);
      const b = await join(viewer);

      const cursor = nextEvent(a.socket, 'cursor');
      b.socket.emit('cursor', { x: 1, y: 1, userId: owner.id });

      expect(await cursor).toEqual({ userId: viewer.id, x: 1, y: 1 });
    });

    it('descarta cursores com coordenadas inválidas', async () => {
      const a = await join(owner);
      const b = await join(viewer);

      const silence = expectNoEvent(a.socket, 'cursor');
      b.socket.emit('cursor', { x: 'abc', y: null });
      await silence;
    });

    it('rebaixar um EDITOR para VIEWER bloqueia as operações já na conexão aberta', async () => {
      const target = await registerAndLogin(ctx, 'rebaixado');
      await share(ctx, owner, diagramId, target, 'EDITOR');

      const a = await join(owner);
      const b = await join(target);

      const roleChanged = nextEvent(b.socket, 'role_changed');

      await ctx
        .http()
        .patch(`/diagram/${diagramId}/collaborators/${target.id}`)
        .set(auth(owner))
        .send({ role: 'VIEWER' })
        .expect(200);

      expect(await roleChanged).toEqual({ diagramId, role: 'VIEWER' });

      const silence = expectNoEvent(a.socket, 'operation');
      b.socket.emit('operation', sampleOperation(target.id));
      await silence;
    });

    it('promover um VIEWER para EDITOR libera as operações sem reconectar', async () => {
      const target = await registerAndLogin(ctx, 'promovido');
      await share(ctx, owner, diagramId, target, 'VIEWER');

      const a = await join(owner);
      const b = await join(target);

      const roleChanged = nextEvent(b.socket, 'role_changed');

      await ctx
        .http()
        .patch(`/diagram/${diagramId}/collaborators/${target.id}`)
        .set(auth(owner))
        .send({ role: 'EDITOR' })
        .expect(200);

      await roleChanged;

      const received = nextEvent(a.socket, 'operation');
      b.socket.emit('operation', sampleOperation(target.id));
      await received;
    });

    it('um colaborador removido deixa de receber as operações do diagrama', async () => {
      const target = await registerAndLogin(ctx, 'removido');
      await share(ctx, owner, diagramId, target, 'VIEWER');

      const a = await join(owner);
      const b = await join(target);

      const revoked = nextEvent(b.socket, 'access_revoked');
      const left = nextEvent(
        a.socket,
        'presence',
        2000,
        (p: { type: string; userId?: string }) =>
          p.type === 'USER_LEFT' && p.userId === target.id,
      );

      await ctx
        .http()
        .delete(`/diagram/${diagramId}/collaborators/${target.id}`)
        .set(auth(owner))
        .expect(200);

      expect(await revoked).toEqual({ diagramId, reason: 'removed' });
      await left;

      const silence = expectNoEvent(b.socket, 'operation');
      a.socket.emit('operation', sampleOperation(owner.id));
      await silence;
    });

    it('um colaborador removido não consegue mais enviar operações', async () => {
      const target = await registerAndLogin(ctx, 'removido-editor');
      await share(ctx, owner, diagramId, target, 'EDITOR');

      const a = await join(owner);
      const b = await join(target);

      const revoked = nextEvent(b.socket, 'access_revoked');

      await ctx
        .http()
        .delete(`/diagram/${diagramId}/collaborators/${target.id}`)
        .set(auth(owner))
        .expect(200);

      await revoked;

      const silence = expectNoEvent(a.socket, 'operation');
      b.socket.emit('operation', sampleOperation(target.id));
      await silence;
    });

    it('quem sai do diagrama recebe o motivo "left"', async () => {
      const target = await registerAndLogin(ctx, 'saiu');
      await share(ctx, owner, diagramId, target, 'EDITOR');

      const b = await join(target);
      const revoked = nextEvent(b.socket, 'access_revoked');

      await ctx
        .http()
        .delete(`/diagram/${diagramId}/collaborators/${target.id}`)
        .set(auth(target))
        .expect(200);

      expect(await revoked).toEqual({ diagramId, reason: 'left' });
    });

    it('excluir o diagrama desconecta todos da sala', async () => {
      const temp = await createDiagram(ctx, owner, 'Diagrama descartável');
      await share(ctx, owner, temp, editor, 'EDITOR');

      const b = await join(editor, temp);
      const revoked = nextEvent(b.socket, 'access_revoked');

      await ctx.http().delete(`/diagram/${temp}`).set(auth(owner)).expect(200);

      expect(await revoked).toEqual({ diagramId: temp, reason: 'deleted' });
    });

    it('recusa a conexão com um token que não é de acesso', async () => {
      const socket = track(connectSocket(ctx, stranger.refreshToken));
      const disconnected = nextEvent(socket, 'disconnect');
      await disconnected;
    });
  });
});
