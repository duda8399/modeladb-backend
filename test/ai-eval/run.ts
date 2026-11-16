import { mkdirSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { performance } from 'perf_hooks';
import OpenAI from 'openai';
import { OpenAIService } from 'src/openai/openai.service';
import { compactModel, type CompactModel } from 'src/openai/diagram-analysis';
import {
  materializeGeneration,
  type GenerationColumn,
  type GenerationResult,
} from 'src/openai/diagram-generation';
import type { UserService } from 'src/users/user.service';
import {
  DOMAINS,
  type Domain,
  type FlawedModel,
  type PlantedDefect,
} from './dataset';
import {
  fromDiagram,
  meanPairwiseJaccard,
  scoreAnalysis,
  scoreGeneration,
  type EvalSuggestion,
  type GenerationScore,
} from './metrics';
import { csv, describe, writeMarkdown } from './report';

const ROOT = resolve(__dirname, '..', '..');
const OUT_DIR = join(ROOT, 'reports', 'ai-eval');
const FAKE = process.env.EVAL_FAKE === '1';
const RUNS = Math.max(1, Number(process.env.EVAL_RUNS ?? 5));
const PARTS = new Set((process.env.EVAL_PARTS ?? 'geracao,analise').split(','));
const DOMAIN_FILTER = process.env.EVAL_DOMAINS?.split(',').filter(Boolean);
const CONCURRENCY = Math.max(1, Number(process.env.EVAL_CONCURRENCY ?? 3));
const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

type CallLog = {
  latencyMs: number;
  promptTokens: number | null;
  completionTokens: number | null;
  raw: string | null;
};

export type GenerationRun = {
  domain: string;
  run: number;
  ok: boolean;
  error?: string;
  call?: CallLog;
  rawRelationships?: number;
  rawTables?: number;
  score?: GenerationScore;
};

export type AnalysisRun = {
  domain: string;
  run: number;
  ok: boolean;
  error?: string;
  call?: CallLog;
  rawSuggestions?: number;
  rawActions?: number;
  score?: number;
  summary?: string;
  suggestions?: EvalSuggestion[];
  metrics?: ReturnType<typeof scoreAnalysis>;
};

function parseColumn(spec: string): GenerationColumn {
  const [name, typeSpec, ...flags] = spec.split(/\s+/);
  const match = /^([A-Z]+)(?:\(([^)]+)\))?$/.exec(typeSpec);
  if (!match) throw new Error(`coluna inválida: ${spec}`);
  return {
    name,
    type: match[1],
    size: match[2] ?? null,
    values: null,
    pk: flags.includes('pk'),
    notNull: flags.includes('nn') || flags.includes('pk'),
    unique: flags.includes('uq'),
    autoIncrement: flags.includes('ai'),
    defaultValue: null,
    description: null,
  };
}

function flawedToGeneration(model: FlawedModel): GenerationResult {
  return {
    diagramName: model.name,
    tables: model.tables.map((t) => ({
      name: t.name,
      columns: t.columns.map(parseColumn),
    })),
    relationships: model.relationships.map(
      ([parent, child, fkColumn, type]) => ({
        parent,
        child,
        fkColumn,
        type,
        onDelete: null,
        onUpdate: null,
      }),
    ),
  };
}

function defectPresent(model: CompactModel, defect: PlantedDefect) {
  const table = model.tables.find((t) => t.name === defect.table);
  const column = table?.columns.find((c) => c.name === defect.column);
  if (!table || !column) return false;
  switch (defect.kind) {
    case 'dinheiro_float':
      return column.type === 'FLOAT' || column.type === 'DOUBLE';
    case 'data_texto':
      return column.type === 'VARCHAR' || column.type === 'CHAR';
    case 'falta_unique':
      return !column.unique && !column.pk;
    case 'falta_not_null':
      return !column.notNull;
    case 'fk_sem_indice':
      return !(table.indexes ?? []).some((i) => i.columns[0] === defect.column);
    default:
      return true;
  }
}

function fakeGeneration(domain: Domain): GenerationResult {
  const id = (): GenerationColumn => parseColumn('id INT pk ai');
  const tables = new Map(domain.entities.map((e) => [e.name, [id()]]));
  const relationships: GenerationResult['relationships'] = [];
  for (const rel of domain.relationships) {
    if (rel.card === 'N:N') {
      const name = `${rel.a}${rel.b}`;
      tables.set(name, [
        parseColumn(`fk_${rel.a}_id INT pk nn`),
        parseColumn(`fk_${rel.b}_id INT pk nn`),
      ]);
      for (const parent of [rel.a, rel.b]) {
        relationships.push({
          parent,
          child: name,
          fkColumn: `fk_${parent}_id`,
          type: '1:N',
          onDelete: null,
          onUpdate: null,
        });
      }
      continue;
    }
    const fkColumn = `fk_${rel.parent}_id`;
    tables
      .get(rel.child)!
      .push(
        parseColumn(`${fkColumn} INT nn${rel.card === '1:1' ? ' uq' : ''}`),
      );
    relationships.push({
      parent: rel.parent,
      child: rel.child,
      fkColumn,
      type: rel.card,
      onDelete: null,
      onUpdate: null,
    });
  }
  return {
    diagramName: domain.title,
    tables: [...tables.entries()].map(([name, columns]) => ({ name, columns })),
    relationships,
  };
}

function fakeAnalysis(defects: PlantedDefect[]) {
  return {
    score: 60,
    summary: 'Resposta simulada.',
    suggestions: defects.map((d) => ({
      category: 'integridade',
      severity: 'media',
      title: `Revisar ${d.column}`,
      description: `Simulação para ${d.table}.${d.column}.`,
      table: d.table,
      column: d.column,
      action: null,
    })),
  };
}

class Recorder {
  last: CallLog | null = null;
}

function buildService(
  apiKey: string,
  recorder: Recorder,
  fakeReply: () => unknown,
) {
  const users = {
    findById: () => Promise.resolve({ id: 'avaliacao' }),
    getOpenAIKey: () => Promise.resolve(apiKey),
  } as unknown as UserService;
  const service = new OpenAIService(users);

  service.createClient = (key: string) => {
    const client: OpenAI = FAKE
      ? ({
          chat: {
            completions: {
              create: () =>
                Promise.resolve({
                  choices: [
                    {
                      message: {
                        content: JSON.stringify(fakeReply()),
                        refusal: null,
                      },
                    },
                  ],
                  usage: { prompt_tokens: 0, completion_tokens: 0 },
                }),
            },
          },
        } as unknown as OpenAI)
      : new OpenAI({ apiKey: key, maxRetries: 3 });

    const create = client.chat.completions.create.bind(
      client.chat.completions,
    ) as (
      ...args: unknown[]
    ) => Promise<OpenAI.Chat.Completions.ChatCompletion>;

    (client.chat.completions as unknown as { create: unknown }).create = async (
      ...args: unknown[]
    ) => {
      const started = performance.now();
      const completion = await create(...args);
      recorder.last = {
        latencyMs: Math.round(performance.now() - started),
        promptTokens: completion.usage?.prompt_tokens ?? null,
        completionTokens: completion.usage?.completion_tokens ?? null,
        raw: completion.choices[0]?.message?.content ?? null,
      };
      return completion;
    };
    return client;
  };
  return service;
}

const redact = (message: string) => message.replace(/sk-[\w*-]+/g, 'sk-***');

async function pool<T>(
  items: (() => Promise<T>)[],
  size: number,
): Promise<T[]> {
  const results: T[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) {
        const index = next++;
        results[index] = await items[index]();
      }
    }),
  );
  return results;
}

function safeJson(
  raw: string | null | undefined,
): Record<string, unknown> | null {
  try {
    return raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

async function runGeneration(
  domain: Domain,
  run: number,
  apiKey: string,
): Promise<GenerationRun> {
  const recorder = new Recorder();
  const service = buildService(apiKey, recorder, () => fakeGeneration(domain));
  try {
    const diagram = await service.generateDiagram(
      'avaliacao',
      domain.description,
    );
    const raw = safeJson(recorder.last?.raw);
    return {
      domain: domain.id,
      run,
      ok: true,
      call: recorder.last ?? undefined,
      rawTables: Array.isArray(raw?.tables) ? raw.tables.length : undefined,
      rawRelationships: Array.isArray(raw?.relationships)
        ? raw.relationships.length
        : undefined,
      score: scoreGeneration(domain, fromDiagram(diagram)),
    };
  } catch (error) {
    return {
      domain: domain.id,
      run,
      ok: false,
      error: redact((error as Error).message),
      call: recorder.last ?? undefined,
    };
  }
}

async function runAnalysis(
  domain: Domain,
  run: number,
  apiKey: string,
): Promise<AnalysisRun> {
  const recorder = new Recorder();
  const service = buildService(apiKey, recorder, () =>
    fakeAnalysis(domain.flawed.defects),
  );
  const diagram = materializeGeneration(
    flawedToGeneration(domain.flawed),
    undefined,
  );
  try {
    const result = await service.analyzeDiagram('avaliacao', {
      diagramName: domain.flawed.name,
      nodes: diagram.nodes,
      edges: diagram.edges,
    });
    const raw = safeJson(recorder.last?.raw);
    const rawSuggestions = Array.isArray(raw?.suggestions)
      ? (raw.suggestions as Record<string, unknown>[])
      : [];
    const suggestions = result.suggestions as unknown as EvalSuggestion[];
    return {
      domain: domain.id,
      run,
      ok: true,
      call: recorder.last ?? undefined,
      rawSuggestions: rawSuggestions.length,
      rawActions: rawSuggestions.filter((s) => s.action).length,
      score: result.score,
      summary: result.summary,
      suggestions,
      metrics: scoreAnalysis(domain.flawed.defects, suggestions),
    };
  } catch (error) {
    return {
      domain: domain.id,
      run,
      ok: false,
      error: redact((error as Error).message),
      call: recorder.last ?? undefined,
    };
  }
}

function checkFlawedModels(domains: Domain[]) {
  for (const domain of domains) {
    const diagram = materializeGeneration(
      flawedToGeneration(domain.flawed),
      undefined,
    );
    const model = compactModel(
      domain.flawed.name,
      diagram.nodes,
      diagram.edges,
    );
    for (const defect of domain.flawed.defects) {
      if (!defectPresent(model, defect)) {
        throw new Error(
          `defeito plantado ausente no modelo enviado à IA: ${defect.id}`,
        );
      }
    }
  }
}

async function main() {
  const apiKey = FAKE ? 'fake' : (process.env.OPENAI_API_KEY ?? '');
  if (!apiKey) {
    throw new Error(
      'Defina OPENAI_API_KEY (ou EVAL_FAKE=1 para validar o pipeline sem chamar a OpenAI).',
    );
  }

  if (!FAKE) {
    try {
      await new OpenAI({ apiKey, maxRetries: 1 }).models.retrieve(MODEL);
    } catch (error) {
      const status = (error as { status?: number }).status;
      throw new Error(
        status === 401
          ? 'A OpenAI recusou a chave (401). Confira OPENAI_API_KEY: chave completa, sem aspas ou espaços, ativa e do projeto certo.'
          : `Não foi possível usar o modelo ${MODEL}: ${status ?? ''} ${(error as Error).message.replace(/sk-[\w*-]+/g, 'sk-***')}`,
      );
    }
  }

  const domains = DOMAINS.filter(
    (d) => !DOMAIN_FILTER || DOMAIN_FILTER.includes(d.id),
  );
  checkFlawedModels(domains);

  const started = Date.now();
  const generation: GenerationRun[] = [];
  const analysis: AnalysisRun[] = [];

  if (PARTS.has('geracao')) {
    const tasks = domains.flatMap((d) =>
      Array.from({ length: RUNS }, (_, i) => async () => {
        const result = await runGeneration(d, i + 1, apiKey);
        const s = result.score;
        console.log(
          `geração ${d.id} #${i + 1}: ` +
            (result.ok && s
              ? `entidades F1=${s.entities.f1?.toFixed(2)} PK=${s.primaryKeys.accuracy?.toFixed(2)} rel F1=${s.relationships.f1?.toFixed(2)} card=${s.cardinality.accuracy?.toFixed(2)}`
              : `ERRO ${result.error}`),
        );
        return result;
      }),
    );
    generation.push(...(await pool(tasks, CONCURRENCY)));
  }

  if (PARTS.has('analise')) {
    const tasks = domains.flatMap((d) =>
      Array.from({ length: RUNS }, (_, i) => async () => {
        const result = await runAnalysis(d, i + 1, apiKey);
        console.log(
          `análise ${d.id} #${i + 1}: ` +
            (result.ok && result.metrics
              ? `defeitos ${result.metrics.detected.length}/${result.metrics.defects}, ${result.metrics.suggestions} sugestões, nota ${result.score}`
              : `ERRO ${result.error}`),
        );
        return result;
      }),
    );
    analysis.push(...(await pool(tasks, CONCURRENCY)));
  }

  const environment = {
    date: new Date().toISOString(),
    fake: FAKE,
    model: MODEL,
    temperature: 0.2,
    runsPerPrompt: RUNS,
    domains: domains.map((d) => d.id),
    durationSeconds: Math.round((Date.now() - started) / 1000),
  };

  const stability = domains.map((d) => {
    const runs = generation
      .filter((g) => g.domain === d.id && g.ok && g.score)
      .map((g) => g.score!);
    const analyses = analysis.filter(
      (a) => a.domain === d.id && a.ok && a.metrics,
    );
    return {
      domain: d.id,
      entitiesJaccard: meanPairwiseJaccard(runs.map((s) => s.entitySet)),
      relationshipsJaccard: meanPairwiseJaccard(
        runs.map((s) => s.relationshipSet),
      ),
      detectedDefectsJaccard: meanPairwiseJaccard(
        analyses.map((a) => a.metrics!.detected),
      ),
      analysisScore: describe(analyses.map((a) => a.score ?? NaN)),
      suggestionCount: describe(
        analyses.map((a) => a.suggestions?.length ?? NaN),
      ),
    };
  });

  mkdirSync(join(OUT_DIR, 'respostas'), { recursive: true });
  for (const g of generation) {
    writeFileSync(
      join(OUT_DIR, 'respostas', `geracao-${g.domain}-${g.run}.json`),
      g.call?.raw ?? JSON.stringify({ erro: g.error }),
    );
  }
  for (const a of analysis) {
    writeFileSync(
      join(OUT_DIR, 'respostas', `analise-${a.domain}-${a.run}.json`),
      a.call?.raw ?? JSON.stringify({ erro: a.error }),
    );
  }

  writeFileSync(
    join(OUT_DIR, 'ai-eval.json'),
    JSON.stringify({ environment, generation, analysis, stability }, null, 2),
  );

  writeFileSync(
    join(OUT_DIR, 'geracao-execucoes.csv'),
    csv(
      [
        'dominio',
        'execucao',
        'ok',
        'erro',
        'tabelas_geradas',
        'entidades_precisao',
        'entidades_revocacao',
        'entidades_f1',
        'entidades_ausentes',
        'entidades_extras',
        'pk_corretas',
        'pk_avaliadas',
        'tabelas_sem_pk',
        'rel_precisao',
        'rel_revocacao',
        'rel_f1',
        'rel_ausentes',
        'card_corretas',
        'card_avaliadas',
        'erros_cardinalidade',
        'fk_validas',
        'fk_total',
        'rel_descartados_na_materializacao',
        'latencia_ms',
        'tokens_entrada',
        'tokens_saida',
      ],
      generation.map((g) => {
        const s = g.score;
        return [
          g.domain,
          g.run,
          g.ok ? 1 : 0,
          g.error ?? '',
          s?.entities.generated,
          s?.entities.precision,
          s?.entities.recall,
          s?.entities.f1,
          s?.entities.missing.join(' | '),
          s?.entities.extra.join(' | '),
          s?.primaryKeys.correct,
          s?.primaryKeys.evaluated,
          s?.primaryKeys.tablesWithoutPk,
          s?.relationships.precision,
          s?.relationships.recall,
          s?.relationships.f1,
          s?.relationships.missing.join(' | '),
          s?.cardinality.correct,
          s?.cardinality.evaluated,
          s?.cardinality.errors.join(' | '),
          s?.integrity.valid,
          s?.integrity.foreignKeys,
          g.rawRelationships !== undefined && s
            ? g.rawRelationships - s.relationships.generated
            : '',
          g.call?.latencyMs,
          g.call?.promptTokens,
          g.call?.completionTokens,
        ];
      }),
    ),
  );

  writeFileSync(
    join(OUT_DIR, 'analise-execucoes.csv'),
    csv(
      [
        'dominio',
        'execucao',
        'ok',
        'erro',
        'nota_modelo',
        'defeitos_plantados',
        'defeitos_detectados',
        'revocacao_defeitos',
        'detectados',
        'sugestoes',
        'sugestoes_sobre_defeitos_plantados',
        'sugestoes_com_acao',
        'acoes_descartadas_na_validacao',
        'latencia_ms',
        'tokens_entrada',
        'tokens_saida',
      ],
      analysis.map((a) => [
        a.domain,
        a.run,
        a.ok ? 1 : 0,
        a.error ?? '',
        a.score,
        a.metrics?.defects,
        a.metrics?.detected.length,
        a.metrics?.recall,
        a.metrics?.detected.join(' | '),
        a.metrics?.suggestions,
        a.metrics?.suggestionsOnPlanted,
        a.metrics?.withAction,
        a.rawActions !== undefined && a.metrics
          ? a.rawActions - a.metrics.withAction
          : '',
        a.call?.latencyMs,
        a.call?.promptTokens,
        a.call?.completionTokens,
      ]),
    ),
  );

  writeFileSync(
    join(OUT_DIR, 'sugestoes-para-avaliar.csv'),
    csv(
      [
        'dominio',
        'execucao',
        'n',
        'categoria',
        'severidade',
        'tabela',
        'coluna',
        'titulo',
        'descricao',
        'acao',
        'defeito_plantado',
        'avaliador_1',
        'avaliador_2',
        'observacao',
      ],
      analysis.flatMap((a) =>
        (a.suggestions ?? []).map((s, i) => [
          a.domain,
          a.run,
          i + 1,
          s.category,
          s.severity,
          s.table ?? '',
          s.column ?? '',
          s.title,
          s.description,
          s.action
            ? JSON.stringify(
                Object.fromEntries(
                  Object.entries(s.action).filter(([, v]) => v !== null),
                ),
              )
            : '',
          a.metrics?.linked[i]?.join(' | ') ?? '',
          '',
          '',
          '',
        ]),
      ),
    ),
  );

  writeMarkdown(join(OUT_DIR, 'ai-eval.md'), {
    environment,
    domains,
    generation,
    analysis,
    stability,
  });
  console.log(`Relatórios em ${OUT_DIR}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
