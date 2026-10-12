import { Socket } from 'socket.io-client';
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

const sampleNodes = [
  {
    id: 'n1',
    type: 'entityNode',
    position: { x: 10, y: 20 },
    data: { name: 'Cliente', fields: [] },
  },
];

async function connected(ctx: TestContext, user: TestUser): Promise<Socket> {
  const socket = connectSocket(ctx, user.token);
  await nextEvent(socket, 'connect');
  await new Promise((resolve) => setTimeout(resolve, 150));
  return socket;
}

describe('Ações do painel: renomear, duplicar e convites', () => {
  let ctx: TestContext;
  let owner: TestUser;
  let editor: TestUser;
  let viewer: TestUser;
  let stranger: TestUser;
  const sockets: Socket[] = [];

  beforeAll(async () => {
    ctx = await createTestApp();
    owner = await registerAndLogin(ctx, 'dono');
    editor = await registerAndLogin(ctx, 'editor');
    viewer = await registerAndLogin(ctx, 'leitor');
    stranger = await registerAndLogin(ctx, 'estranho');
  });

  afterEach(() => {
    sockets.splice(0).forEach((socket) => socket.disconnect());
  });

  afterAll(async () => {
    await ctx.close();
  });

  describe('renomear (PATCH /diagram/:id)', () => {
    let diagramId: string;

    beforeAll(async () => {
      diagramId = await createDiagram(ctx, owner, 'Original');
      await share(ctx, owner, diagramId, editor, 'EDITOR');
      await share(ctx, owner, diagramId, viewer, 'VIEWER');
    });

    it.each([
      ['dono', () => owner, 200],
      ['editor', () => editor, 200],
      ['leitor', () => viewer, 403],
      ['sem acesso', () => stranger, 403],
    ] as const)('%s recebe %s', async (_label, actor, status) => {
      const res = await ctx
        .http()
        .patch(`/diagram/${diagramId}`)
        .set(auth(actor()))
        .send({ name: '  Novo nome  ' });

      expect(res.status).toBe(status);
      if (status === 200) expect(res.body.name).toBe('Novo nome');
    });

    it('rejeita nome vazio', async () => {
      const res = await ctx
        .http()
        .patch(`/diagram/${diagramId}`)
        .set(auth(owner))
        .send({ name: '' });

      expect(res.status).toBe(400);
    });

    it('avisa quem está com o diagrama aberto', async () => {
      const { socket } = await joinDiagram(ctx, editor, diagramId);
      sockets.push(socket);
      const renamed = nextEvent(socket, 'document_renamed');

      await ctx
        .http()
        .patch(`/diagram/${diagramId}`)
        .set(auth(owner))
        .send({ name: 'Renomeado ao vivo' })
        .expect(200);

      await expect(renamed).resolves.toMatchObject({
        diagramId,
        name: 'Renomeado ao vivo',
        byUserId: owner.id,
      });
    });
  });

  describe('duplicar (POST /diagram/:id/duplicate)', () => {
    let diagramId: string;

    beforeAll(async () => {
      diagramId = await createDiagram(ctx, owner, 'Loja');
      await ctx
        .http()
        .put(`/diagram/${diagramId}`)
        .set(auth(owner))
        .send({ nodes: sampleNodes, edges: [] })
        .expect(200);
      await share(ctx, owner, diagramId, viewer, 'VIEWER');
    });

    it('o dono recebe uma cópia com o mesmo conteúdo', async () => {
      const res = await ctx
        .http()
        .post(`/diagram/${diagramId}/duplicate`)
        .set(auth(owner))
        .send({})
        .expect(201);

      expect(res.body.id).not.toBe(diagramId);
      expect(res.body.name).toBe('Cópia de Loja');
      expect(res.body.userId).toBe(owner.id);
      expect(res.body.nodes).toEqual([{ ...sampleNodes[0], style: null }]);
    });

    it('um leitor duplica para os próprios documentos', async () => {
      const res = await ctx
        .http()
        .post(`/diagram/${diagramId}/duplicate`)
        .set(auth(viewer))
        .send({ name: 'Minha loja' })
        .expect(201);

      expect(res.body.userId).toBe(viewer.id);
      expect(res.body.name).toBe('Minha loja');

      const mine = await ctx
        .http()
        .get('/diagram/my-documents')
        .set(auth(viewer))
        .expect(200);
      expect(mine.body.map((d: { id: string }) => d.id)).toContain(res.body.id);
    });

    it('quem não tem acesso recebe 403', async () => {
      await ctx
        .http()
        .post(`/diagram/${diagramId}/duplicate`)
        .set(auth(stranger))
        .send({})
        .expect(403);
    });
  });

  describe('convites', () => {
    it('o convidado recebe o aviso ao vivo e o convite fica pendente até ser lido', async () => {
      const invitee = await registerAndLogin(ctx, 'convidado');
      const diagramId = await createDiagram(ctx, owner, 'Biblioteca');
      const socket = await connected(ctx, invitee);
      sockets.push(socket);
      const received = nextEvent(socket, 'invitation_received');

      await share(ctx, owner, diagramId, invitee, 'VIEWER');

      await expect(received).resolves.toMatchObject({
        diagramId,
        diagramName: 'Biblioteca',
        role: 'VIEWER',
        owner: { id: owner.id, email: owner.email },
      });

      const pending = await ctx
        .http()
        .get('/diagram/invitations')
        .set(auth(invitee))
        .expect(200);
      expect(pending.body).toHaveLength(1);
      expect(pending.body[0]).toMatchObject({ diagramId, role: 'VIEWER' });

      await ctx
        .http()
        .post('/diagram/invitations/seen')
        .set(auth(invitee))
        .send({ diagramIds: [diagramId] })
        .expect(201);

      const after = await ctx
        .http()
        .get('/diagram/invitations')
        .set(auth(invitee))
        .expect(200);
      expect(after.body).toEqual([]);
    });

    it('trocar o papel de quem já foi convidado não gera novo convite', async () => {
      const invitee = await registerAndLogin(ctx, 'convidado2');
      const diagramId = await createDiagram(ctx, owner, 'Escola');
      await share(ctx, owner, diagramId, invitee, 'VIEWER');
      await ctx
        .http()
        .post('/diagram/invitations/seen')
        .set(auth(invitee))
        .send({})
        .expect(201);

      const socket = await connected(ctx, invitee);
      sockets.push(socket);
      const silence = expectNoEvent(socket, 'invitation_received');

      await share(ctx, owner, diagramId, invitee, 'EDITOR');
      await silence;

      const pending = await ctx
        .http()
        .get('/diagram/invitations')
        .set(auth(invitee))
        .expect(200);
      expect(pending.body).toEqual([]);
    });

    it('o convite de um usuário não aparece para outro', async () => {
      const invitee = await registerAndLogin(ctx, 'convidado3');
      const diagramId = await createDiagram(ctx, owner, 'Hospital');
      const otherSocket = await connected(ctx, stranger);
      sockets.push(otherSocket);
      const silence = expectNoEvent(otherSocket, 'invitation_received');

      await share(ctx, owner, diagramId, invitee, 'EDITOR');
      await silence;

      const res = await ctx
        .http()
        .get('/diagram/invitations')
        .set(auth(stranger))
        .expect(200);
      expect(
        res.body.map((i: { diagramId: string }) => i.diagramId),
      ).not.toContain(diagramId);
    });

    it('rejeita ids inválidos ao marcar como lido', async () => {
      await ctx
        .http()
        .post('/diagram/invitations/seen')
        .set(auth(owner))
        .send({ diagramIds: ['nao-e-id'] })
        .expect(400);
    });
  });
});
