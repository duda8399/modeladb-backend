import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import OpenAI from 'openai';
import { UserService } from 'src/users/user.service';
import {
  ANALYSIS_SCHEMA,
  buildAnalysisSystemPrompt,
  buildAnalysisUserPrompt,
  compactModel,
  sanitizeAnalysis,
  type AnalysisResult,
} from './diagram-analysis';

@Injectable()
export class OpenAIService {
  constructor(private userService: UserService) {}

  createClient(apiKey: string): OpenAI {
    return new OpenAI({ apiKey });
  }

  async analyzeDiagram(
    userId: string,
    diagram: {
      diagramName?: string;
      nodes?: unknown[];
      edges?: unknown[];
      focus?: string;
    },
  ): Promise<AnalysisResult> {
    const model = compactModel(
      diagram.diagramName,
      diagram.nodes,
      diagram.edges,
    );

    if (!model.tables.length) {
      throw new BadRequestException(
        'Adicione ao menos uma tabela antes de pedir uma análise.',
      );
    }

    const user = await this.userService.findById(userId);

    if (!user) {
      throw new BadRequestException('Usuário não encontrado');
    }

    if (!user.openaiToken) {
      throw new BadRequestException(
        'Nenhuma chave da OpenAI cadastrada para este usuário',
      );
    }

    let completion: OpenAI.Chat.Completions.ChatCompletion;

    try {
      completion = await this.createClient(
        user.openaiToken,
      ).chat.completions.create({
        model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
        temperature: 0.2,
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'analise_modelo',
            strict: true,
            schema: ANALYSIS_SCHEMA as unknown as Record<string, unknown>,
          },
        },
        messages: [
          { role: 'system', content: buildAnalysisSystemPrompt() },
          {
            role: 'user',
            content: buildAnalysisUserPrompt(model, diagram.focus),
          },
        ],
      });
    } catch (error) {
      throw new InternalServerErrorException(
        (error as Error)?.message || 'Falha ao se comunicar com a OpenAI',
      );
    }

    const message = completion.choices[0]?.message;

    if (message?.refusal) {
      throw new BadRequestException('A OpenAI recusou analisar este modelo.');
    }

    if (!message?.content) {
      throw new InternalServerErrorException(
        'A OpenAI não retornou nenhum conteúdo',
      );
    }

    try {
      return sanitizeAnalysis(JSON.parse(message.content), model);
    } catch {
      throw new InternalServerErrorException(
        'A OpenAI retornou uma análise inválida',
      );
    }
  }

  async generateDiagram(
    userId: string,
    description: string,
    currentDiagram?: {
      diagramName?: string;
      nodes?: Record<string, unknown>[];
      edges?: Record<string, unknown>[];
    },
  ) {
    if (!description?.trim()) {
      throw new BadRequestException('A descrição não pode estar vazia');
    }

    const user = await this.userService.findById(userId);

    if (!user) {
      throw new BadRequestException('Usuário não encontrado');
    }

    if (!user.openaiToken) {
      throw new BadRequestException(
        'Nenhuma chave da OpenAI cadastrada para este usuário',
      );
    }

    const openai = new OpenAI({ apiKey: user.openaiToken });

    let completion: OpenAI.Chat.Completions.ChatCompletion;

    try {
      completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: this.buildSystemPrompt() },
          {
            role: 'user',
            content: this.buildUserPrompt(description, currentDiagram),
          },
        ],
      });
    } catch (error) {
      throw new InternalServerErrorException(
        error?.message || 'Falha ao se comunicar com a OpenAI',
      );
    }

    const content = completion.choices[0]?.message?.content;

    if (!content) {
      throw new InternalServerErrorException(
        'A OpenAI não retornou nenhum conteúdo',
      );
    }

    try {
      return JSON.parse(content);
    } catch {
      throw new InternalServerErrorException(
        'A OpenAI retornou um JSON inválido',
      );
    }
  }

  private buildSystemPrompt(): string {
    return [
      'Você é um especialista em modelagem de bancos de dados relacionais.',
      'A partir da descrição em linguagem natural fornecida pelo usuário, você projeta',
      'um diagrama de entidade-relacionamento e o retorna ESTRITAMENTE no formato JSON especificado.',
      '',
      'Regras obrigatórias:',
      '- Responda APENAS com um objeto JSON válido, sem texto adicional, sem markdown e sem comentários.',
      '- Gere um "id" UUID v4 único para cada node, field e edge.',
      '- "type" de um node deve ser sempre "entityNode".',
      '- Cada entidade (node) deve ter um array "fields" com pelo menos a chave primária.',
      '- Tipos de campo válidos: INT, VARCHAR, TEXT, BOOLEAN, DATE, DATETIME, FLOAT, DECIMAL.',
      '- A chave primária deve ter pk=true, notNull=true e unique=true. Use ai=true apenas para PKs inteiras auto-incremento.',
      '- Chaves estrangeiras devem ter fk=true e nome no padrão "fk_<EntidadeReferenciada>_<campo>".',
      '- Para relacionamentos N:N, crie uma entidade associativa contendo as FKs das duas entidades como PK composta.',
      '- Para cada relacionamento, crie um edge ligando os nodes pelos seus ids ("source"/"sourceNodeId" e "target"/"targetNodeId").',
      '- Todo edge deve ter "type" igual a "floating", um "label" igual ao "relationType" e "sourceHandle" podendo ser null.',
      '- "relationType" do edge deve ser "1:1", "1:N" ou "N:N".',
      '- "fkFieldName" no data do edge deve corresponder ao nome do campo FK.',
      '- Crie edges APENAS entre nodes que existam na lista "nodes"; nunca referencie ids inexistentes.',
      '- Posicione os nodes com coordenadas "position" distintas (espaçadas em ~300px no eixo x) para evitar sobreposição.',
      '- Use width=300 e height calculado conforme a quantidade de campos (aprox. 60 + 42 por campo); style pode ser null.',
    ].join('\n');
  }

  private buildUserPrompt(
    description: string,
    currentDiagram?: {
      diagramName?: string;
      nodes?: Record<string, unknown>[];
      edges?: Record<string, unknown>[];
    },
  ): string {
    const hasCurrentDiagram = !!currentDiagram?.nodes?.length;

    const parts = [
      'Descrição da estrutura do banco de dados desejada:',
      '"""',
      description.trim(),
      '"""',
      '',
    ];

    if (hasCurrentDiagram) {
      parts.push(
        'Já existe um diagrama construído no editor, no formato JSON abaixo.',
        'Use-o como ponto de partida: preserve entidades, campos e relacionamentos existentes que não sejam',
        'contraditos pela descrição, e aplique as mudanças pedidas (adicionar, remover ou alterar entidades,',
        'campos ou relacionamentos). Retorne o diagrama COMPLETO resultante (todas as entidades e edges,',
        'inclusive as que não mudaram), não apenas as alterações.',
        '',
        'Diagrama atual:',
        JSON.stringify(
          {
            diagramName: currentDiagram?.diagramName,
            nodes: currentDiagram?.nodes,
            edges: currentDiagram?.edges,
          },
          null,
          2,
        ),
        '',
      );
    }

    parts.push(
      'Retorne o diagrama EXATAMENTE no seguinte formato JSON (este é apenas um exemplo de estrutura):',
      '',
      JSON.stringify(this.exampleModel(), null, 2),
    );

    return parts.join('\n');
  }

  private exampleModel() {
    return {
      diagramName: 'Diagrama 1',
      nodes: [
        {
          id: '89d7857a-fd98-4a05-980a-f2c694548df0',
          type: 'entityNode',
          data: {
            name: 'Produto',
            fields: [
              {
                id: '3a8af038-65be-469c-8ded-bb13e1933f4d',
                name: 'id',
                type: 'INT',
                pk: true,
                fk: false,
                notNull: true,
                unique: true,
                ai: true,
              },
              {
                id: '1551271a-3f73-46f7-a931-a69c95013517',
                name: 'name',
                type: 'VARCHAR',
                pk: false,
                fk: false,
                notNull: true,
                unique: false,
                ai: false,
              },
              {
                id: '85d88fd8-6107-41ba-a5d4-aedca7aa2991',
                name: 'type',
                type: 'VARCHAR',
                pk: false,
                fk: false,
                notNull: false,
                unique: false,
                ai: false,
              },
            ],
          },
          position: { x: 1241.23316552921, y: -231.3065004100778 },
          style: null,
          width: 300,
          height: 188,
        },
        {
          id: 'ff2059da-8eea-4ad7-9a50-9840597376ab',
          type: 'entityNode',
          data: {
            name: 'Cliente',
            fields: [
              {
                id: 'adc20e7d-d156-4e5e-89d6-1e9c5275b3ce',
                name: 'id',
                type: 'INT',
                pk: true,
                fk: false,
                notNull: true,
                unique: true,
                ai: true,
              },
              {
                id: 'e3bd9b85-2b73-49b6-9bcd-fbc4e46d0885',
                name: 'name',
                type: 'VARCHAR',
                pk: false,
                fk: false,
                notNull: false,
                unique: false,
                ai: false,
              },
              {
                id: 'c3c8c23d-5d58-46fe-a23f-fca2dfd39f0d',
                name: 'phone',
                type: 'VARCHAR',
                pk: false,
                fk: false,
                notNull: false,
                unique: false,
                ai: false,
              },
            ],
          },
          position: { x: 141.7672408105338, y: -280.036737966093 },
          style: null,
          width: 300,
          height: 188,
        },
        {
          id: 'bc211c69-e65c-45b1-affa-d66c1e2a1c86',
          type: 'entityNode',
          data: {
            name: 'Compra',
            fields: [
              {
                id: 'eaf8c98f-c6ce-4659-98ae-ce3d041cd65d',
                name: 'id',
                type: 'INT',
                pk: true,
                fk: false,
                notNull: true,
                unique: true,
                ai: false,
              },
              {
                id: '41c601e0-7437-4274-873f-677cc4f90ead',
                name: 'quantity',
                type: 'INT',
                pk: false,
                fk: false,
                notNull: true,
                unique: false,
                ai: false,
              },
              {
                id: 'd1b0dfcd-b260-4ba1-89f2-bd046659e2e5',
                name: 'fk_Cliente_id',
                type: 'INT',
                pk: false,
                fk: true,
                notNull: false,
                unique: false,
                ai: false,
              },
              {
                id: 'ba169c88-e74d-477c-bc0b-1a009b1b3122',
                name: 'fk_Produto_id',
                type: 'INT',
                pk: false,
                fk: true,
                notNull: false,
                unique: false,
                ai: false,
              },
            ],
          },
          position: { x: 641.7790756167059, y: -247.2653582468684 },
          style: null,
          width: 300,
          height: 223,
        },
      ],
      edges: [
        {
          id: 'reactflow__edge-ff2059da-8eea-4ad7-9a50-9840597376abright-bc211c69-e65c-45b1-affa-d66c1e2a1c86left',
          source: 'ff2059da-8eea-4ad7-9a50-9840597376ab',
          sourceHandle: 'right',
          target: 'bc211c69-e65c-45b1-affa-d66c1e2a1c86',
          label: '1:N',
          type: 'floating',
          data: {
            relationType: '1:N',
            sourceNodeId: 'ff2059da-8eea-4ad7-9a50-9840597376ab',
            targetNodeId: 'bc211c69-e65c-45b1-affa-d66c1e2a1c86',
            fkFieldName: 'fk_Cliente_id',
          },
        },
        {
          id: 'reactflow__edge-89d7857a-fd98-4a05-980a-f2c694548df0left-bc211c69-e65c-45b1-affa-d66c1e2a1c86right',
          source: '89d7857a-fd98-4a05-980a-f2c694548df0',
          sourceHandle: 'left',
          target: 'bc211c69-e65c-45b1-affa-d66c1e2a1c86',
          label: '1:N',
          type: 'floating',
          data: {
            relationType: '1:N',
            sourceNodeId: '89d7857a-fd98-4a05-980a-f2c694548df0',
            targetNodeId: 'bc211c69-e65c-45b1-affa-d66c1e2a1c86',
            fkFieldName: 'fk_Produto_id',
          },
        },
      ],
    };
  }
}
