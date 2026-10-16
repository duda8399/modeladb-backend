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
import {
  GENERATION_SCHEMA,
  buildGenerationSystemPrompt,
  buildGenerationUserPrompt,
  describeCurrentDiagram,
  materializeGeneration,
  type CurrentDiagram,
  type GenerationResult,
} from './diagram-generation';
import type { GeneratedDiagram } from './generated-diagram';

const OPENAI_MODEL = () => process.env.OPENAI_MODEL || 'gpt-4o-mini';

@Injectable()
export class OpenAIService {
  constructor(private userService: UserService) {}

  createClient(apiKey: string): OpenAI {
    return new OpenAI({ apiKey });
  }

  private async requireOpenAIKey(userId: string): Promise<string> {
    const user = await this.userService.findById(userId);

    if (!user) {
      throw new BadRequestException('Usuário não encontrado');
    }

    const apiKey = await this.userService.getOpenAIKey(userId);

    if (!apiKey) {
      throw new BadRequestException(
        'Nenhuma chave da OpenAI cadastrada para este usuário',
      );
    }

    return apiKey;
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

    const apiKey = await this.requireOpenAIKey(userId);

    let completion: OpenAI.Chat.Completions.ChatCompletion;

    try {
      completion = await this.createClient(apiKey).chat.completions.create({
        model: OPENAI_MODEL(),
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
    currentDiagram?: CurrentDiagram,
  ): Promise<GeneratedDiagram> {
    if (!description?.trim()) {
      throw new BadRequestException('A descrição não pode estar vazia');
    }

    const apiKey = await this.requireOpenAIKey(userId);

    let completion: OpenAI.Chat.Completions.ChatCompletion;

    try {
      completion = await this.createClient(apiKey).chat.completions.create({
        model: OPENAI_MODEL(),
        temperature: 0.2,
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'modelo_gerado',
            strict: true,
            schema: GENERATION_SCHEMA as unknown as Record<string, unknown>,
          },
        },
        messages: [
          { role: 'system', content: buildGenerationSystemPrompt() },
          {
            role: 'user',
            content: buildGenerationUserPrompt(
              description,
              describeCurrentDiagram(currentDiagram),
            ),
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
      throw new BadRequestException('A OpenAI recusou gerar este modelo.');
    }

    if (!message?.content) {
      throw new InternalServerErrorException(
        'A OpenAI não retornou nenhum conteúdo',
      );
    }

    let result: GenerationResult;

    try {
      result = JSON.parse(message.content) as GenerationResult;
    } catch {
      throw new InternalServerErrorException(
        'A OpenAI retornou um JSON inválido',
      );
    }

    return materializeGeneration(result, currentDiagram);
  }
}
