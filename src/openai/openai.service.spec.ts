import { OpenAIService } from './openai.service';
import type { UserService } from 'src/users/user.service';

function setup(content: unknown, refusal: string | null = null) {
  const create = jest.fn().mockResolvedValue({
    choices: [{ message: { content: JSON.stringify(content), refusal } }],
  });
  const users = {
    findById: jest.fn().mockResolvedValue({ id: 'u' }),
    getOpenAIKey: jest.fn().mockResolvedValue('sk-test'),
  } as unknown as UserService;
  const service = new OpenAIService(users);
  jest
    .spyOn(service, 'createClient')
    .mockReturnValue({ chat: { completions: { create } } } as never);
  return { service, create };
}

const generation = {
  diagramName: 'Loja',
  tables: [
    {
      name: 'Cliente',
      columns: [
        {
          name: 'id',
          type: 'INT',
          size: null,
          values: null,
          pk: true,
          notNull: true,
          unique: false,
          autoIncrement: true,
          defaultValue: null,
          description: null,
        },
      ],
    },
  ],
  relationships: [],
};

describe('OpenAIService', () => {
  it('gera o diagrama com Structured Outputs estrito', async () => {
    const { service, create } = setup(generation);

    const result = await service.generateDiagram('u', 'uma loja');

    const request = create.mock.calls[0][0];
    expect(request.response_format).toMatchObject({
      type: 'json_schema',
      json_schema: { name: 'modelo_gerado', strict: true },
    });
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0].data.name).toBe('Cliente');
  });

  it('analisa o diagrama com Structured Outputs estrito', async () => {
    const { service, create } = setup({
      score: 80,
      summary: 'ok',
      suggestions: [],
    });

    await service.analyzeDiagram('u', {
      nodes: [{ id: 'n', type: 'entityNode', data: { name: 'A', fields: [] } }],
    });

    expect(create.mock.calls[0][0].response_format).toMatchObject({
      type: 'json_schema',
      json_schema: { strict: true },
    });
  });

  it('nenhuma chamada usa o modo json_object', async () => {
    const { service, create } = setup(generation);
    await service.generateDiagram('u', 'x');
    for (const [request] of create.mock.calls) {
      expect(request.response_format.type).not.toBe('json_object');
    }
  });

  it('traduz a recusa da OpenAI em erro de requisição', async () => {
    const { service } = setup(generation, 'não posso');
    await expect(service.generateDiagram('u', 'x')).rejects.toThrow(
      'A OpenAI recusou gerar este modelo.',
    );
  });

  it('rejeita descrição vazia sem chamar a OpenAI', async () => {
    const { service, create } = setup(generation);
    await expect(service.generateDiagram('u', '  ')).rejects.toThrow();
    expect(create).not.toHaveBeenCalled();
  });
});
