import {
  TestContext,
  TestUser,
  auth,
  createDiagram,
  createTestApp,
  registerAndLogin,
  share,
} from './support/test-app';

type Role = 'OWNER' | 'EDITOR' | 'VIEWER' | 'SEM_ACESSO';

type Action = {
  name: string;
  run: (
    ctx: TestContext,
    actor: TestUser,
    diagramId: string,
    users: Record<Role, TestUser>,
  ) => Promise<{ status: number }>;
  expected: Record<Role, number>;
};

const sampleNodes = [
  {
    id: 'n1',
    type: 'entityNode',
    position: { x: 10, y: 20 },
    data: { name: 'Cliente', fields: [] },
  },
];

/**
 * Item 3 — Integração da API: matriz de autorização.
 *
 * Cada linha da tabela é uma ação sobre um diagrama e cada coluna é o papel
 * de quem executa. O mesmo diagrama é recriado para cada célula, então as
 * ações destrutivas (ex.: excluir) não interferem umas nas outras.
 */
const ACTIONS: Action[] = [
  {
    name: 'ler o diagrama (GET /diagram/:id)',
    run: (ctx, actor, id) => ctx.http().get(`/diagram/${id}`).set(auth(actor)),
    expected: { OWNER: 200, EDITOR: 200, VIEWER: 200, SEM_ACESSO: 403 },
  },
  {
    name: 'salvar alterações (PUT /diagram/:id)',
    run: (ctx, actor, id) =>
      ctx
        .http()
        .put(`/diagram/${id}`)
        .set(auth(actor))
        .send({ nodes: sampleNodes, edges: [] }),
    expected: { OWNER: 200, EDITOR: 200, VIEWER: 403, SEM_ACESSO: 403 },
  },
  {
    name: 'listar colaboradores (GET /diagram/:id/collaborators)',
    run: (ctx, actor, id) =>
      ctx.http().get(`/diagram/${id}/collaborators`).set(auth(actor)),
    expected: { OWNER: 200, EDITOR: 200, VIEWER: 200, SEM_ACESSO: 403 },
  },
  {
    name: 'convidar colaborador (POST /diagram/:id/collaborators)',
    run: (ctx, actor, id, users) =>
      ctx
        .http()
        .post(`/diagram/${id}/collaborators`)
        .set(auth(actor))
        .send({ email: users.SEM_ACESSO.email, role: 'VIEWER' }),
    // O dono não pode convidar a si mesmo; por isso o convidado é sempre o
    // usuário sem acesso, inclusive quando é ele quem tenta (auto-convite).
    expected: { OWNER: 201, EDITOR: 403, VIEWER: 403, SEM_ACESSO: 403 },
  },
  {
    name: 'alterar papel de colaborador (PATCH /diagram/:id/collaborators/:userId)',
    run: (ctx, actor, id, users) =>
      ctx
        .http()
        .patch(`/diagram/${id}/collaborators/${users.VIEWER.id}`)
        .set(auth(actor))
        .send({ role: 'EDITOR' }),
    expected: { OWNER: 200, EDITOR: 403, VIEWER: 403, SEM_ACESSO: 403 },
  },
  {
    name: 'remover outro colaborador (DELETE /diagram/:id/collaborators/:userId)',
    run: (ctx, actor, id, users) =>
      ctx
        .http()
        .delete(`/diagram/${id}/collaborators/${users.VIEWER.id}`)
        .set(auth(actor)),
    // Para o VIEWER esta é uma auto-remoção ("sair do diagrama"), permitida.
    expected: { OWNER: 200, EDITOR: 403, VIEWER: 200, SEM_ACESSO: 403 },
  },
  {
    name: 'excluir o diagrama (DELETE /diagram/:id)',
    run: (ctx, actor, id) =>
      ctx.http().delete(`/diagram/${id}`).set(auth(actor)),
    // O controller converte qualquer erro desta rota em 400 (inclusive a
    // falta de permissão), por isso a recusa aparece como 400 e não 403.
    expected: { OWNER: 200, EDITOR: 400, VIEWER: 400, SEM_ACESSO: 400 },
  },
];

const ROLES: Role[] = ['OWNER', 'EDITOR', 'VIEWER', 'SEM_ACESSO'];

describe('Matriz de permissões por papel (integração)', () => {
  let ctx: TestContext;
  let users: Record<Role, TestUser>;

  beforeAll(async () => {
    ctx = await createTestApp();
    users = {
      OWNER: await registerAndLogin(ctx, 'dono'),
      EDITOR: await registerAndLogin(ctx, 'editor'),
      VIEWER: await registerAndLogin(ctx, 'leitor'),
      SEM_ACESSO: await registerAndLogin(ctx, 'estranho'),
    };
  });

  afterAll(async () => {
    await ctx.close();
  });

  async function freshDiagram() {
    const id = await createDiagram(ctx, users.OWNER, 'Diagrama da matriz');
    await share(ctx, users.OWNER, id, users.EDITOR, 'EDITOR');
    await share(ctx, users.OWNER, id, users.VIEWER, 'VIEWER');
    return id;
  }

  const cases = ACTIONS.flatMap((action) =>
    ROLES.map(
      (role) => [action.name, role, action.expected[role], action] as const,
    ),
  );

  it.each(cases)(
    '%s como %s → HTTP %i',
    async (_name, role, expected, action) => {
      const diagramId = await freshDiagram();

      const res = await action.run(ctx, users[role], diagramId, users);

      expect(res.status).toBe(expected);
    },
  );

  it('uma recusa de exclusão não apaga o diagrama', async () => {
    const diagramId = await freshDiagram();

    await ctx
      .http()
      .delete(`/diagram/${diagramId}`)
      .set(auth(users.EDITOR))
      .expect(400);

    await ctx
      .http()
      .get(`/diagram/${diagramId}`)
      .set(auth(users.OWNER))
      .expect(200);
  });

  it('uma recusa de escrita não altera o conteúdo salvo', async () => {
    const diagramId = await freshDiagram();

    await ctx
      .http()
      .put(`/diagram/${diagramId}`)
      .set(auth(users.VIEWER))
      .send({ name: 'Hackeado', nodes: sampleNodes })
      .expect(403);

    const res = await ctx
      .http()
      .get(`/diagram/${diagramId}`)
      .set(auth(users.OWNER))
      .expect(200);

    expect(res.body.name).toBe('Diagrama da matriz');
    expect(res.body.nodes).toEqual([]);
  });

  it('GET /diagram/:id informa o papel do usuário atual', async () => {
    const diagramId = await freshDiagram();

    for (const role of ['OWNER', 'EDITOR', 'VIEWER'] as const) {
      const res = await ctx
        .http()
        .get(`/diagram/${diagramId}`)
        .set(auth(users[role]))
        .expect(200);

      expect(res.body.currentUserRole).toBe(role);
    }
  });

  it('retorna 404 para diagrama inexistente', async () => {
    await ctx
      .http()
      .get('/diagram/000000000000000000000000')
      .set(auth(users.OWNER))
      .expect(404);
  });
});
