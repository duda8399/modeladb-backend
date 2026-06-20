import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import OpenAI from 'openai';
import { UserService } from 'src/users/user.service';

@Injectable()
export class OpenAIService {
  constructor(private userService: UserService) {}

  async generateDiagram(userId: string, description: string) {
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
          { role: 'user', content: this.buildUserPrompt(description) },
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
      '- "relationType" do edge deve ser "1:1", "1:N" ou "N:N".',
      '- "fkFieldName" no data do edge deve corresponder ao nome do campo FK.',
      '- Posicione os nodes com coordenadas "position" distintas (espaçadas em ~300px no eixo x) para evitar sobreposição.',
      '- Use width=240 e height calculado conforme a quantidade de campos (aprox. 60 + 42 por campo); style pode ser null.',
    ].join('\n');
  }

  private buildUserPrompt(description: string): string {
    return [
      'Descrição da estrutura do banco de dados desejada:',
      '"""',
      description.trim(),
      '"""',
      '',
      'Retorne o diagrama EXATAMENTE no seguinte formato JSON (este é apenas um exemplo de estrutura):',
      '',
      JSON.stringify(this.exampleModel(), null, 2),
    ].join('\n');
  }

  private exampleModel() {
    return {
      diagramName: 'Nome do Diagrama',
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
            ],
          },
          position: { x: 955, y: 122 },
          style: null,
          width: 240,
          height: 188,
        },
      ],
      edges: [
        {
          id: '2c0d6fd5-1f4a-4f1f-92e1-d36b38034283',
          source: 'ff2059da-8eea-4ad7-9a50-9840597376ab',
          sourceHandle: null,
          target: 'b815220e-79c0-4ee4-9fab-0dc6d18e5663',
          data: {
            relationType: '1:N',
            sourceNodeId: 'ff2059da-8eea-4ad7-9a50-9840597376ab',
            targetNodeId: 'b815220e-79c0-4ee4-9fab-0dc6d18e5663',
            fkFieldName: 'fk_Cliente_id',
          },
        },
      ],
    };
  }
}
