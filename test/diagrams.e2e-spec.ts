import {
  TestContext,
  TestUser,
  auth,
  createDiagram,
  createTestApp,
  registerAndLogin,
  share,
} from './support/test-app';

/**
 * Item 3 — Integração da API: ciclo de vida do diagrama e compartilhamento.
 */
describe('Diagramas e compartilhamento (integração)', () => {
  let ctx: TestContext;
  let owner: TestUser;
  let alice: TestUser;
  let bob: TestUser;

  beforeAll(async () => {
    ctx = await createTestApp();
    owner = await registerAndLogin(ctx, 'dono');
    alice = await registerAndLogin(ctx, 'alice');
    bob = await registerAndLogin(ctx, 'bob');
  });

  afterAll(async () => {
    await ctx.close();
  });

  describe('persistência', () => {
    it('salva views (viewNode) e índices das entidades', async () => {
      const diagramId = await createDiagram(ctx, owner);

      const nodes = [
        {
          id: 'cliente',
          type: 'entityNode',
          position: { x: 0, y: 0 },
          data: {
            name: 'cliente',
            fields: [{ id: 'f1', name: 'email', type: 'VARCHAR' }],
            indexes: [{ id: 'i1', name: 'idx_email', columns: ['f1'], unique: false }],
          },
        },
        {
          id: 'v1',
          type: 'viewNode',
          position: { x: 400, y: 0 },
          data: { name: 'clientes_ativos', sql: 'SELECT email FROM cliente' },
        },
      ];

      await ctx
        .http()
        .put(`/diagram/${diagramId}`)
        .set(auth(owner))
        .send({ nodes, edges: [] })
        .expect(200);

      const res = await ctx
        .http()
        .get(`/diagram/${diagramId}`)
        .set(auth(owner))
        .expect(200);

      expect(res.body.nodes).toEqual([
        expect.objectContaining({ id: 'cliente', data: nodes[0].data }),
        expect.objectContaining({ id: 'v1', type: 'viewNode', data: nodes[1].data }),
      ]);
    });

    it('salva e recupera nós e arestas sem perder os metadados de CRDT', async () => {
      const diagramId = await createDiagram(ctx, owner);

      const nodes = [
        {
          id: 'cliente',
          type: 'entityNode',
          position: { x: 120.5, y: -40 },
          style: { width: 220 },
          data: {
            name: 'Cliente',
            fields: [
              {
                id: 'f1',
                name: 'id',
                type: 'INT',
                pk: true,
                fk: false,
                notNull: true,
                unique: false,
                ai: true,
                order: 0,
                _crdt: { name: { lamport: 3, userId: owner.id } },
              },
            ],
            _crdt: { positionX: { lamport: 7, userId: owner.id } },
          },
        },
        {
          id: 'pedido',
          type: 'entityNode',
          position: { x: 400, y: 0 },
          data: { name: 'Pedido', fields: [] },
        },
      ];
      const edges = [
        {
          id: 'e1',
          source: 'cliente',
          target: 'pedido',
          type: 'floating',
          data: { relationType: '1:N', fkFieldName: 'fk_cliente_id' },
        },
      ];

      await ctx
        .http()
        .put(`/diagram/${diagramId}`)
        .set(auth(owner))
        .send({ name: '  Loja  ', nodes, edges })
        .expect(200);

      const res = await ctx
        .http()
        .get(`/diagram/${diagramId}`)
        .set(auth(owner))
        .expect(200);

      expect(res.body.name).toBe('Loja');
      expect(res.body.nodes).toHaveLength(2);
      expect(res.body.nodes[0]).toEqual(
        expect.objectContaining({
          id: 'cliente',
          type: 'entityNode',
          position: { x: 120.5, y: -40 },
          style: { width: 220 },
          data: nodes[0].data,
        }),
      );
      expect(res.body.edges[0]).toEqual(
        expect.objectContaining({
          id: 'e1',
          source: 'cliente',
          target: 'pedido',
          data: edges[0].data,
        }),
      );
    });

    it('ignora nome vazio ao salvar', async () => {
      const diagramId = await createDiagram(ctx, owner, 'Nome original');

      await ctx
        .http()
        .put(`/diagram/${diagramId}`)
        .set(auth(owner))
        .send({ name: '   ' })
        .expect(200);

      const res = await ctx
        .http()
        .get(`/diagram/${diagramId}`)
        .set(auth(owner));
      expect(res.body.name).toBe('Nome original');
    });

    it('um EDITOR consegue salvar alterações no diagrama do dono', async () => {
      const diagramId = await createDiagram(ctx, owner);
      await share(ctx, owner, diagramId, alice, 'EDITOR');

      await ctx
        .http()
        .put(`/diagram/${diagramId}`)
        .set(auth(alice))
        .send({ name: 'Editado pela Alice' })
        .expect(200);

      const res = await ctx
        .http()
        .get(`/diagram/${diagramId}`)
        .set(auth(owner));
      expect(res.body.name).toBe('Editado pela Alice');
    });
  });

  describe('listagens', () => {
    it('"meus documentos" lista apenas diagramas do próprio usuário', async () => {
      const mine = await createDiagram(ctx, bob, 'Do Bob');
      const other = await createDiagram(ctx, owner, 'Do dono');

      const res = await ctx
        .http()
        .get('/diagram/my-documents')
        .set(auth(bob))
        .expect(200);

      const ids = res.body.map((d: { id: string }) => d.id);
      expect(ids).toContain(mine);
      expect(ids).not.toContain(other);
    });

    it('"recentes" retorna no máximo 8 diagramas, do mais recente ao mais antigo', async () => {
      const user = await registerAndLogin(ctx, 'recentes');
      const created: string[] = [];
      for (let i = 0; i < 10; i++) {
        created.push(await createDiagram(ctx, user, `Diagrama ${i}`));
      }

      const res = await ctx
        .http()
        .get('/diagram/recent')
        .set(auth(user))
        .expect(200);

      expect(res.body).toHaveLength(8);
      expect(res.body[0].id).toBe(created[9]);
    });

    it('"compartilhados comigo" traz o papel e o dono de cada diagrama', async () => {
      const user = await registerAndLogin(ctx, 'compartilhado');
      const d1 = await createDiagram(ctx, owner, 'Compartilhado como editor');
      const d2 = await createDiagram(ctx, alice, 'Compartilhado como leitor');
      await share(ctx, owner, d1, user, 'EDITOR');
      await share(ctx, alice, d2, user, 'VIEWER');

      const res = await ctx
        .http()
        .get('/diagram/shared-with-me')
        .set(auth(user))
        .expect(200);

      expect(res.body).toHaveLength(2);
      const byId = Object.fromEntries(
        res.body.map((d: { id: string }) => [d.id, d]),
      );
      expect(byId[d1]).toEqual(
        expect.objectContaining({
          role: 'EDITOR',
          owner: { id: owner.id, name: owner.name, email: owner.email },
        }),
      );
      expect(byId[d2]).toEqual(
        expect.objectContaining({
          role: 'VIEWER',
          owner: { id: alice.id, name: alice.name, email: alice.email },
        }),
      );
      expect(byId[d1].owner).not.toHaveProperty('password');
    });
  });

  describe('convites e papéis', () => {
    it('o papel padrão de um convite é EDITOR', async () => {
      const diagramId = await createDiagram(ctx, owner);

      const res = await ctx
        .http()
        .post(`/diagram/${diagramId}/collaborators`)
        .set(auth(owner))
        .send({ email: alice.email })
        .expect(201);

      expect(res.body).toEqual(
        expect.objectContaining({
          diagramId,
          userId: alice.id,
          role: 'EDITOR',
        }),
      );
    });

    it('convidar a mesma pessoa de novo atualiza o papel sem duplicar', async () => {
      const diagramId = await createDiagram(ctx, owner);
      await share(ctx, owner, diagramId, alice, 'EDITOR');
      await share(ctx, owner, diagramId, alice, 'VIEWER');

      const res = await ctx
        .http()
        .get(`/diagram/${diagramId}/collaborators`)
        .set(auth(owner))
        .expect(200);

      expect(res.body).toHaveLength(1);
      expect(res.body[0].role).toBe('VIEWER');
    });

    it('a listagem de colaboradores não expõe senhas', async () => {
      const diagramId = await createDiagram(ctx, owner);
      await share(ctx, owner, diagramId, alice, 'EDITOR');

      const res = await ctx
        .http()
        .get(`/diagram/${diagramId}/collaborators`)
        .set(auth(owner));

      expect(res.body[0].user).toEqual({
        id: alice.id,
        name: alice.name,
        email: alice.email,
        avatarUrl: null,
      });
    });

    it('recusa convite para e-mail não cadastrado', async () => {
      const diagramId = await createDiagram(ctx, owner);

      const res = await ctx
        .http()
        .post(`/diagram/${diagramId}/collaborators`)
        .set(auth(owner))
        .send({ email: 'ninguem@teste.modeladb', role: 'EDITOR' })
        .expect(400);

      expect(res.body.message).toBe('Usuário não encontrado.');
    });

    it('recusa que o dono convide a si mesmo', async () => {
      const diagramId = await createDiagram(ctx, owner);

      await ctx
        .http()
        .post(`/diagram/${diagramId}/collaborators`)
        .set(auth(owner))
        .send({ email: owner.email, role: 'VIEWER' })
        .expect(403);
    });

    it('rebaixar EDITOR para VIEWER retira imediatamente a permissão de salvar', async () => {
      const diagramId = await createDiagram(ctx, owner);
      await share(ctx, owner, diagramId, alice, 'EDITOR');

      await ctx
        .http()
        .put(`/diagram/${diagramId}`)
        .set(auth(alice))
        .send({ name: 'Antes' })
        .expect(200);

      await ctx
        .http()
        .patch(`/diagram/${diagramId}/collaborators/${alice.id}`)
        .set(auth(owner))
        .send({ role: 'VIEWER' })
        .expect(200);

      await ctx
        .http()
        .put(`/diagram/${diagramId}`)
        .set(auth(alice))
        .send({ name: 'Depois' })
        .expect(403);
    });

    it('alterar o papel de quem não é colaborador retorna erro', async () => {
      const diagramId = await createDiagram(ctx, owner);

      await ctx
        .http()
        .patch(`/diagram/${diagramId}/collaborators/${bob.id}`)
        .set(auth(owner))
        .send({ role: 'VIEWER' })
        .expect(400);
    });
  });

  describe('remoção de acesso', () => {
    it('o colaborador removido pelo dono perde o acesso', async () => {
      const diagramId = await createDiagram(ctx, owner);
      await share(ctx, owner, diagramId, alice, 'EDITOR');

      await ctx
        .http()
        .delete(`/diagram/${diagramId}/collaborators/${alice.id}`)
        .set(auth(owner))
        .expect(200);

      await ctx
        .http()
        .get(`/diagram/${diagramId}`)
        .set(auth(alice))
        .expect(403);
    });

    it('o colaborador pode sair do diagrama por conta própria', async () => {
      const diagramId = await createDiagram(ctx, owner);
      await share(ctx, owner, diagramId, alice, 'VIEWER');

      await ctx
        .http()
        .delete(`/diagram/${diagramId}/collaborators/${alice.id}`)
        .set(auth(alice))
        .expect(200);

      const shared = await ctx
        .http()
        .get('/diagram/shared-with-me')
        .set(auth(alice));
      expect(shared.body.map((d: { id: string }) => d.id)).not.toContain(
        diagramId,
      );
    });

    it('remover quem não é colaborador retorna erro', async () => {
      const diagramId = await createDiagram(ctx, owner);

      await ctx
        .http()
        .delete(`/diagram/${diagramId}/collaborators/${bob.id}`)
        .set(auth(owner))
        .expect(400);
    });

    it('excluir o diagrama remove os vínculos de colaboração (cascata)', async () => {
      const user = await registerAndLogin(ctx, 'cascata');
      const diagramId = await createDiagram(ctx, owner);
      await share(ctx, owner, diagramId, user, 'EDITOR');

      await ctx
        .http()
        .delete(`/diagram/${diagramId}`)
        .set(auth(owner))
        .expect(200);

      const shared = await ctx
        .http()
        .get('/diagram/shared-with-me')
        .set(auth(user))
        .expect(200);
      expect(shared.body).toEqual([]);

      await ctx
        .http()
        .get(`/diagram/${diagramId}`)
        .set(auth(owner))
        .expect(404);
    });
    describe('miniatura', () => {
    it('salva a miniatura enviada pelo editor e nega quem é só VIEWER', async () => {
      const viewer = await registerAndLogin(ctx, 'thumbviewer');
      const diagramId = await createDiagram(ctx, owner);
      await share(ctx, owner, diagramId, viewer, 'VIEWER');
      const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);

      const res = await ctx
        .http()
        .put(`/diagram/${diagramId}/thumbnail`)
        .set(auth(owner))
        .attach('thumbnail', jpg, 'print.jpg')
        .expect(200);
      expect(typeof res.body.thumbnail).toBe('string');
      expect(res.body.thumbnail.length).toBeGreaterThan(0);

      const saved = await ctx
        .http()
        .get(`/diagram/${diagramId}`)
        .set(auth(owner))
        .expect(200);
      expect(saved.body.thumbnail).toBe(res.body.thumbnail);

      await ctx
        .http()
        .put(`/diagram/${diagramId}/thumbnail`)
        .set(auth(viewer))
        .attach('thumbnail', jpg, 'print.jpg')
        .expect(403);
    });
  });

});
});
