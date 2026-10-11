import { OpenAIService } from 'src/openai/openai.service';
import { PrismaService } from 'src/database/prisma.service';
import {
  TestContext,
  TestUser,
  auth,
  createTestApp,
  registerAndLogin,
} from './support/test-app';

const diagram = {
  diagramName: 'Loja',
  nodes: [
    {
      id: 'p',
      type: 'entityNode',
      data: {
        name: 'produto',
        fields: [
          { id: 'f1', name: 'id', type: 'INT', pk: true },
          { id: 'f2', name: 'preco', type: 'FLOAT' },
        ],
      },
    },
  ],
  edges: [],
  focus: 'tipos de dados',
};

describe('Análise do modelo pela IA (integração, OpenAI simulada)', () => {
  let ctx: TestContext;
  let user: TestUser;
  let semChave: TestUser;
  let create: jest.Mock;

  beforeAll(async () => {
    ctx = await createTestApp();
    user = await registerAndLogin(ctx, 'ia');
    semChave = await registerAndLogin(ctx, 'semchave');
    await ctx.app.get(PrismaService).user.update({
      where: { id: user.id },
      data: { openaiToken: 'sk-teste' },
    });

    create = jest.fn();
    jest
      .spyOn(ctx.app.get(OpenAIService), 'createClient')
      .mockImplementation(
        () => ({ chat: { completions: { create } } }) as never,
      );
  });

  afterAll(async () => {
    await ctx.close();
  });

  beforeEach(() => create.mockReset());

  const analyze = (who: TestUser, body: object) =>
    ctx.http().post('/openai/analyze-diagram').set(auth(who)).send(body);

  it('envia o modelo compacto com JSON Schema estrito e devolve as sugestões validadas', async () => {
    create.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              score: 62,
              summary: 'Modelo simples, com um problema de tipo.',
              suggestions: [
                {
                  category: 'tipos',
                  severity: 'alta',
                  title: 'Use DECIMAL para preço',
                  description: 'FLOAT perde precisão em valores monetários.',
                  table: 'produto',
                  column: 'preco',
                  action: {
                    type: 'set_column_type',
                    table: 'produto',
                    column: 'preco',
                    newName: null,
                    dataType: 'DECIMAL',
                    size: '10,2',
                    flag: null,
                    value: null,
                    columns: null,
                    expression: null,
                    defaultValue: null,
                    onDelete: null,
                    onUpdate: null,
                  },
                },
                {
                  category: 'modelagem',
                  severity: 'baixa',
                  title: 'Categoria',
                  description: 'Crie uma tabela de categorias.',
                  table: 'categoria',
                  column: null,
                  action: {
                    type: 'add_column',
                    table: 'categoria',
                    column: 'nome',
                    newName: null,
                    dataType: 'VARCHAR',
                    size: null,
                    flag: null,
                    value: null,
                    columns: null,
                    expression: null,
                    defaultValue: null,
                    onDelete: null,
                    onUpdate: null,
                  },
                },
              ],
            }),
          },
        },
      ],
    });

    const res = await analyze(user, diagram).expect(201);

    expect(res.body.score).toBe(62);
    expect(res.body.suggestions).toEqual([
      expect.objectContaining({
        title: 'Use DECIMAL para preço',
        action: expect.objectContaining({ dataType: 'DECIMAL', size: '10,2' }),
      }),
      expect.objectContaining({ title: 'Categoria', action: null }),
    ]);

    const request = create.mock.calls[0][0];
    expect(request.response_format).toEqual(
      expect.objectContaining({
        type: 'json_schema',
        json_schema: expect.objectContaining({ strict: true }),
      }),
    );
    expect(request.messages[1].content).toContain('tipos de dados');
    expect(request.messages[1].content).toContain('"preco"');
    expect(request.messages[1].content).not.toContain('"f2"');
  });

  it('sem tabelas, sem chave ou sem login não chama a OpenAI', async () => {
    await analyze(user, { nodes: [], edges: [] }).expect(400);
    const noKey = await analyze(semChave, diagram).expect(400);
    expect(noKey.body.message).toContain('chave da OpenAI');
    await ctx.http().post('/openai/analyze-diagram').send(diagram).expect(401);
    expect(create).not.toHaveBeenCalled();
  });

  it('falha ou recusa da OpenAI viram erro legível', async () => {
    create.mockRejectedValueOnce(new Error('Incorrect API key provided'));
    const failed = await analyze(user, diagram).expect(500);
    expect(failed.body.message).toContain('Incorrect API key');

    create.mockResolvedValueOnce({
      choices: [{ message: { content: null, refusal: 'não' } }],
    });
    await analyze(user, diagram).expect(400);

    create.mockResolvedValueOnce({
      choices: [{ message: { content: '{quebrado' } }],
    });
    await analyze(user, diagram).expect(500);
  });
});
