import { DiagramVersionService } from 'src/diagrams/diagram-version.service';
import {
  TestContext,
  TestUser,
  auth,
  createDiagram,
  createTestApp,
  joinDiagram,
  nextEvent,
  registerAndLogin,
  share,
} from './support/test-app';

const entity = (id: string, name: string) => ({
  id,
  type: 'entityNode',
  position: { x: 0, y: 0 },
  data: {
    name,
    fields: [{ id: `${id}-f`, name: 'id', type: 'INT', pk: true }],
  },
});

const view = (id: string) => ({
  id,
  type: 'viewNode',
  position: { x: 0, y: 0 },
  data: { name: id, sql: 'SELECT 1' },
});

const junctionEdges = [
  {
    id: 'j1',
    source: 'a',
    target: 'ab',
    type: 'floating',
    data: { junctionId: 'ab' },
  },
  {
    id: 'j2',
    source: 'ab',
    target: 'b',
    type: 'floating',
    data: { junctionId: 'ab' },
  },
];

describe('Histórico de versões (integração)', () => {
  let ctx: TestContext;
  let owner: TestUser;
  let editor: TestUser;
  let viewer: TestUser;
  let outsider: TestUser;
  let versions: DiagramVersionService;

  beforeAll(async () => {
    ctx = await createTestApp();
    owner = await registerAndLogin(ctx, 'dono');
    editor = await registerAndLogin(ctx, 'editora');
    viewer = await registerAndLogin(ctx, 'leitora');
    outsider = await registerAndLogin(ctx, 'estranho');
    versions = ctx.app.get(DiagramVersionService);
  });

  afterAll(async () => {
    await ctx.close();
  });

  afterEach(() => {
    versions.autoIntervalMs = 10 * 60 * 1000;
  });

  const save = (user: TestUser, diagramId: string, body: object) =>
    ctx.http().put(`/diagram/${diagramId}`).set(auth(user)).send(body);

  const list = (user: TestUser, diagramId: string) =>
    ctx.http().get(`/diagram/${diagramId}/versions`).set(auth(user));

  async function sharedDiagram() {
    const id = await createDiagram(ctx, owner, 'Loja');
    await share(ctx, owner, id, editor, 'EDITOR');
    await share(ctx, owner, id, viewer, 'VIEWER');
    return id;
  }

  it('o primeiro salvamento cria uma versão automática com as contagens', async () => {
    const id = await sharedDiagram();
    await save(editor, id, {
      nodes: [
        entity('a', 'a'),
        entity('b', 'b'),
        entity('ab', 'a_b'),
        view('v'),
      ],
      edges: junctionEdges,
    }).expect(200);

    const res = await list(owner, id).expect(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toEqual(
      expect.objectContaining({
        kind: 'AUTO',
        label: null,
        name: 'Loja',
        tableCount: 3,
        viewCount: 1,
        relationCount: 1,
        createdById: editor.id,
        createdByName: editor.name,
      }),
    );
    expect(res.body[0]).not.toHaveProperty('nodes');
  });

  it('autosaves dentro do intervalo, ou sem mudança, não criam versões novas', async () => {
    const id = await sharedDiagram();
    await save(owner, id, { nodes: [entity('a', 'a')], edges: [] }).expect(200);
    await save(owner, id, { nodes: [entity('a', 'b')], edges: [] }).expect(200);
    expect((await list(owner, id)).body).toHaveLength(1);

    versions.autoIntervalMs = 0;
    await save(owner, id, { nodes: [entity('a', 'b')], edges: [] }).expect(200);
    expect((await list(owner, id)).body).toHaveLength(2);
    await save(owner, id, { nodes: [entity('a', 'b')], edges: [] }).expect(200);
    expect((await list(owner, id)).body).toHaveLength(2);
  });

  it('mantém no máximo 50 versões automáticas, sem apagar as manuais', async () => {
    const id = await createDiagram(ctx, owner);
    await ctx
      .http()
      .post(`/diagram/${id}/versions`)
      .set(auth(owner))
      .send({ label: 'marco' })
      .expect(201);

    versions.autoIntervalMs = 0;
    for (let i = 0; i < 53; i++) {
      await save(owner, id, {
        nodes: [entity('a', `t${i}`)],
        edges: [],
      }).expect(200);
    }

    const all = (await list(owner, id)).body as {
      kind: string;
      label: string | null;
    }[];
    expect(all.filter((v) => v.kind === 'AUTO')).toHaveLength(50);
    expect(all.filter((v) => v.kind === 'MANUAL').map((v) => v.label)).toEqual([
      'marco',
    ]);
  });

  it('versão manual com nome; lista mais recente primeiro; leitura completa por id', async () => {
    const id = await sharedDiagram();
    await save(owner, id, { nodes: [entity('a', 'a')], edges: [] }).expect(200);
    const created = await ctx
      .http()
      .post(`/diagram/${id}/versions`)
      .set(auth(editor))
      .send({ label: '  Entrega 1  ' })
      .expect(201);

    expect(created.body).toEqual(
      expect.objectContaining({ kind: 'MANUAL', label: 'Entrega 1' }),
    );

    const all = (await list(viewer, id).expect(200)).body;
    expect(all.map((v: { kind: string }) => v.kind)).toEqual([
      'MANUAL',
      'AUTO',
    ]);

    const full = await ctx
      .http()
      .get(`/diagram/${id}/versions/${created.body.id}`)
      .set(auth(viewer))
      .expect(200);
    expect(full.body.nodes).toEqual([
      expect.objectContaining({ id: 'a', data: entity('a', 'a').data }),
    ]);
  });

  it('permissões: leitor só lê; estranho não vê; só o dono exclui', async () => {
    const id = await sharedDiagram();
    await save(owner, id, { nodes: [entity('a', 'a')], edges: [] }).expect(200);
    const [version] = (await list(owner, id)).body;
    const base = `/diagram/${id}/versions`;

    await ctx.http().get(base).set(auth(outsider)).expect(403);
    await ctx.http().post(base).set(auth(viewer)).send({}).expect(403);
    await ctx
      .http()
      .patch(`${base}/${version.id}`)
      .set(auth(viewer))
      .send({ label: 'x' })
      .expect(403);
    await ctx
      .http()
      .post(`${base}/${version.id}/restore`)
      .set(auth(viewer))
      .expect(403);
    await ctx
      .http()
      .delete(`${base}/${version.id}`)
      .set(auth(editor))
      .expect(403);

    await ctx
      .http()
      .patch(`${base}/${version.id}`)
      .set(auth(editor))
      .send({ label: 'Revisada' })
      .expect(200);
    expect((await list(owner, id)).body[0].label).toBe('Revisada');

    await ctx
      .http()
      .delete(`${base}/${version.id}`)
      .set(auth(owner))
      .expect(200);
    expect((await list(owner, id)).body).toHaveLength(0);
  });

  it('versão de outro diagrama ou id inválido retornam 404', async () => {
    const a = await createDiagram(ctx, owner);
    const b = await createDiagram(ctx, owner);
    await save(owner, a, { nodes: [entity('x', 'x')], edges: [] }).expect(200);
    const [version] = (await list(owner, a)).body;

    await ctx
      .http()
      .get(`/diagram/${b}/versions/${version.id}`)
      .set(auth(owner))
      .expect(404);
    await ctx
      .http()
      .get(`/diagram/${a}/versions/nao-existe`)
      .set(auth(owner))
      .expect(404);
    await ctx
      .http()
      .get(`/diagram/nao-existe/versions`)
      .set(auth(owner))
      .expect(404);
  });

  it('restaurar troca o conteúdo, guarda um backup e avisa quem está na sala', async () => {
    const id = await sharedDiagram();
    await save(owner, id, {
      name: 'Loja v1',
      nodes: [entity('a', 'cliente')],
      edges: [],
    }).expect(200);
    const [v1] = (await list(owner, id)).body;

    await save(owner, id, {
      name: 'Loja v2',
      nodes: [entity('a', 'cliente'), entity('b', 'pedido')],
      edges: [],
    }).expect(200);

    const { socket } = await joinDiagram(ctx, viewer, id);
    const event = nextEvent(socket, 'document_restored');

    const restored = await ctx
      .http()
      .post(`/diagram/${id}/versions/${v1.id}/restore`)
      .set(auth(editor))
      .expect(201);
    expect(restored.body).toEqual(
      expect.objectContaining({ name: 'Loja v1', currentUserRole: 'EDITOR' }),
    );
    expect(restored.body.nodes.map((n: { id: string }) => n.id)).toEqual(['a']);

    expect(await event).toEqual({
      diagramId: id,
      versionId: v1.id,
      userId: editor.id,
      userName: editor.name,
    });
    socket.disconnect();

    const current = await ctx
      .http()
      .get(`/diagram/${id}`)
      .set(auth(owner))
      .expect(200);
    expect(current.body.nodes.map((n: { id: string }) => n.id)).toEqual(['a']);

    const [backup] = (await list(owner, id)).body;
    expect(backup).toEqual(
      expect.objectContaining({
        kind: 'RESTORE',
        name: 'Loja v2',
        tableCount: 2,
      }),
    );
    expect(backup).toEqual(
      expect.objectContaining({ label: null, restoredFromId: v1.id }),
    );
  });

  it('excluir o diagrama remove o histórico', async () => {
    const id = await createDiagram(ctx, owner);
    await save(owner, id, { nodes: [entity('a', 'a')], edges: [] }).expect(200);
    await ctx.http().delete(`/diagram/${id}`).set(auth(owner)).expect(200);

    const prisma = ctx.app.get(DiagramVersionService)['prisma'];
    expect(
      await prisma.diagramVersion.count({ where: { diagramId: id } }),
    ).toBe(0);
  });
});
