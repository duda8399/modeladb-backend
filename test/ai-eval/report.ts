import { writeFileSync } from 'fs';
import type { Domain, DefectKind } from './dataset';
import type { AnalysisRun, GenerationRun } from './run';

export type Described = {
  n: number;
  mean: number;
  sd: number;
  min: number;
  max: number;
};

export function describe(raw: (number | null | undefined)[]): Described {
  const values = raw.filter(
    (v): v is number => typeof v === 'number' && Number.isFinite(v),
  );
  const n = values.length;
  if (!n) return { n: 0, mean: NaN, sd: NaN, min: NaN, max: NaN };
  const mean = values.reduce((s, v) => s + v, 0) / n;
  const sd =
    n > 1
      ? Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1))
      : 0;
  return { n, mean, sd, min: Math.min(...values), max: Math.max(...values) };
}

function cell(value: unknown) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number')
    return Number.isFinite(value)
      ? String(Math.round(value * 10000) / 10000)
      : '';
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return /[",\n;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function csv(header: string[], rows: unknown[][]) {
  return (
    '﻿' +
    [header, ...rows].map((row) => row.map(cell).join(',')).join('\n') +
    '\n'
  );
}

const pct = (d: Described) =>
  d.n ? `${(d.mean * 100).toFixed(1)}% ± ${(d.sd * 100).toFixed(1)}` : '—';
const num = (d: Described, digits = 1) =>
  d.n ? `${d.mean.toFixed(digits)} ± ${d.sd.toFixed(digits)}` : '—';
const plain = (v: number | null | undefined, digits = 2) =>
  typeof v === 'number' && Number.isFinite(v) ? v.toFixed(digits) : '—';

const KIND_LABEL: Record<DefectKind, string> = {
  dinheiro_float: 'Valor monetário em FLOAT/DOUBLE',
  data_texto: 'Data guardada como texto',
  falta_unique: 'Identificador natural sem UNIQUE (CPF, e-mail, código)',
  falta_not_null: 'Coluna obrigatória sem NOT NULL',
  multivalorado: 'Atributo multivalorado (viola a 1FN)',
  redundancia: 'Dado copiado de outra tabela (dependência transitiva)',
  fk_sem_indice: 'Chave estrangeira sem índice',
};

function counts(items: string[]) {
  const map = new Map<string, number>();
  for (const item of items) map.set(item, (map.get(item) ?? 0) + 1);
  return [...map.entries()].sort((a, b) => b[1] - a[1]);
}

type Input = {
  environment: {
    date: string;
    fake: boolean;
    model: string;
    temperature: number;
    runsPerPrompt: number;
    durationSeconds: number;
  };
  domains: Domain[];
  generation: GenerationRun[];
  analysis: AnalysisRun[];
  stability: {
    domain: string;
    entitiesJaccard: number | null;
    relationshipsJaccard: number | null;
    detectedDefectsJaccard: number | null;
    analysisScore: Described;
    suggestionCount: Described;
  }[];
};

export function writeMarkdown(path: string, input: Input) {
  const { environment: env, domains, generation, analysis, stability } = input;
  const okGen = generation.filter((g) => g.ok && g.score);
  const okAna = analysis.filter((a) => a.ok && a.metrics);
  const runsOf = (id: string) =>
    okGen.filter((g) => g.domain === id).map((g) => g.score!);
  const anaOf = (id: string) => okAna.filter((a) => a.domain === id);

  const genMetrics: [
    string,
    (s: NonNullable<GenerationRun['score']>) => number | null,
  ][] = [
    ['Entidades: precisão', (s) => s.entities.precision],
    ['Entidades: revocação', (s) => s.entities.recall],
    ['Entidades: F1', (s) => s.entities.f1],
    ['Chave primária correta', (s) => s.primaryKeys.accuracy],
    ['Relacionamentos (FK): precisão', (s) => s.relationships.precision],
    ['Relacionamentos (FK): revocação', (s) => s.relationships.recall],
    ['Relacionamentos (FK): F1', (s) => s.relationships.f1],
    ['Cardinalidade correta', (s) => s.cardinality.accuracy],
    ['FK íntegra (coluna existe e tipo = PK)', (s) => s.integrity.rate],
  ];

  const domainMeans = (
    get: (s: NonNullable<GenerationRun['score']>) => number | null,
  ) => domains.map((d) => describe(runsOf(d.id).map(get)).mean);

  const allDefects = domains.flatMap((d) => d.flawed.defects);
  const kinds = [...new Set(allDefects.map((d) => d.kind))];

  const failures = [...generation, ...analysis].filter((r) => !r.ok);
  const calls = [...generation, ...analysis]
    .map((r) => r.call)
    .filter((c): c is NonNullable<typeof c> => !!c);
  const tokensIn = calls.reduce((s, c) => s + (c.promptTokens ?? 0), 0);
  const tokensOut = calls.reduce((s, c) => s + (c.completionTokens ?? 0), 0);

  const lines = [
    '# Avaliação da IA: geração e análise de modelos',
    '',
    `Gerado por \`npm run eval:ai\` em ${env.date}${env.fake ? ' — **MODO SIMULADO (EVAL_FAKE=1): respostas fabricadas a partir do gabarito, só para validar o pipeline; não são resultados da IA**' : ''}.`,
    '',
    `Modelo: \`${env.model}\`, temperature ${env.temperature}, ${env.runsPerPrompt} execuções por prompt, ${domains.length} domínios. ` +
      `As chamadas passam pelo mesmo \`OpenAIService\` da aplicação (mesmo prompt de sistema, JSON Schema estrito, ` +
      `sanitização e materialização do diagrama), então o que é avaliado é exatamente o que o usuário recebe no editor.`,
    '',
    '## Método',
    '',
    '**Geração.** Cada domínio tem uma descrição em linguagem natural, como um estudante escreveria, e um modelo de referência ' +
      '(entidades, chave primária esperada e relacionamentos com cardinalidade). As tabelas geradas são associadas às entidades ' +
      'de referência pelo nome normalizado (sem acentos, singular, aceitando sinônimos listados no gabarito). ' +
      'Uma tabela não associada que tem chaves estrangeiras para duas entidades é tratada como tabela associativa de um N:N. ' +
      'Entidades marcadas como opcionais no gabarito (que podem, com igual correção, virar colunas, como crachá ou check-in) ' +
      'não contam na revocação quando ausentes. Tabelas a mais reduzem a precisão de entidades.',
    '',
    '- **Chave primária correta**: tabela associada tem PK e na forma esperada (simples nas entidades; qualquer forma nas associativas com atributos).',
    '- **Relacionamentos**: um relacionamento de referência é encontrado quando existe FK do pai para o filho (em 1:1 aceita-se a FK em qualquer lado; ' +
      'em N:N, uma tabela associativa ligando as duas entidades). Precisão considera só relacionamentos entre entidades do gabarito.',
    '- **Cardinalidade correta**: entre os relacionamentos encontrados, fração com a cardinalidade de referência.',
    '- **Estabilidade**: índice de Jaccard médio entre todos os pares de execuções do mesmo prompt, sobre o conjunto de entidades ' +
      'e o conjunto de relacionamentos (1 = execuções idênticas).',
    '',
    '**Análise.** Para cada domínio há um modelo com defeitos plantados de propósito (veja a tabela por tipo). ' +
      'Um defeito conta como detectado quando alguma sugestão aponta a tabela e a coluna dele (nos campos da sugestão, na ação ou no texto). ' +
      'A pertinência de todas as sugestões, inclusive as que não tratam de defeitos plantados, depende de avaliação humana: ' +
      'veja a seção "Pertinência".',
    '',
    `Os valores são média ± desvio padrão entre as execuções. A linha "Geral" é a média ± desvio padrão das médias dos ${domains.length} domínios.`,
    '',
    '## 1. Geração de modelos',
    '',
    '| Domínio | Entidades P | Entidades R | Entidades F1 | PK correta | Rel. P | Rel. R | Rel. F1 | Cardinalidade | FK íntegra |',
    '|---|---|---|---|---|---|---|---|---|---|',
    ...domains.map((d) => {
      const runs = runsOf(d.id);
      return `| ${d.title} | ${genMetrics.map(([, get]) => pct(describe(runs.map(get)))).join(' | ')} |`;
    }),
    `| **Geral** | ${genMetrics.map(([, get]) => `**${pct(describe(domainMeans(get)))}**`).join(' | ')} |`,
    '',
    '### Erros mais frequentes',
    '',
    '| Entidade de referência ausente | Execuções |',
    '|---|---|',
    ...counts(
      okGen.flatMap((g) =>
        g.score!.entities.missing.map(
          (m) => `${domains.find((d) => d.id === g.domain)?.title}: ${m}`,
        ),
      ),
    )
      .slice(0, 12)
      .map(([k, v]) => `| ${k} | ${v} |`),
    '',
    '| Relacionamento de referência ausente | Execuções |',
    '|---|---|',
    ...counts(
      okGen.flatMap((g) =>
        g.score!.relationships.missing.map(
          (m) => `${domains.find((d) => d.id === g.domain)?.title}: ${m}`,
        ),
      ),
    )
      .slice(0, 12)
      .map(([k, v]) => `| ${k} | ${v} |`),
    '',
    '| Cardinalidade divergente | Execuções |',
    '|---|---|',
    ...counts(
      okGen.flatMap((g) =>
        g.score!.cardinality.errors.map(
          (m) => `${domains.find((d) => d.id === g.domain)?.title}: ${m}`,
        ),
      ),
    )
      .slice(0, 12)
      .map(([k, v]) => `| ${k} | ${v} |`),
    '',
    '### Estabilidade da geração',
    '',
    '| Domínio | Jaccard entidades | Jaccard relacionamentos | DP do F1 de entidades | DP do F1 de relacionamentos |',
    '|---|---|---|---|---|',
    ...domains.map((d) => {
      const st = stability.find((s) => s.domain === d.id)!;
      const runs = runsOf(d.id);
      return `| ${d.title} | ${plain(st.entitiesJaccard)} | ${plain(st.relationshipsJaccard)} | ${plain(describe(runs.map((s) => s.entities.f1)).sd)} | ${plain(describe(runs.map((s) => s.relationships.f1)).sd)} |`;
    }),
    `| **Geral** | **${num(describe(stability.map((s) => s.entitiesJaccard)), 2)}** | **${num(describe(stability.map((s) => s.relationshipsJaccard)), 2)}** | | |`,
    '',
    '## 2. Análise de modelos',
    '',
    '| Domínio | Defeitos plantados | Defeitos detectados | Sugestões | Sugestões sobre defeitos plantados | Com ação aplicável | Nota dada ao modelo | Jaccard dos defeitos detectados |',
    '|---|---|---|---|---|---|---|---|',
    ...domains.map((d) => {
      const runs = anaOf(d.id);
      const st = stability.find((s) => s.domain === d.id)!;
      return (
        `| ${d.title} | ${d.flawed.defects.length} | ${pct(describe(runs.map((a) => a.metrics!.recall)))} | ${num(describe(runs.map((a) => a.metrics!.suggestions)))} | ` +
        `${num(describe(runs.map((a) => a.metrics!.suggestionsOnPlanted)))} | ${num(describe(runs.map((a) => a.metrics!.withAction)))} | ${num(describe(runs.map((a) => a.score ?? NaN)))} | ${plain(st.detectedDefectsJaccard)} |`
      );
    }),
    `| **Geral** | ${allDefects.length} | **${pct(describe(domains.map((d) => describe(anaOf(d.id).map((a) => a.metrics!.recall)).mean)))}** | ${num(describe(okAna.map((a) => a.metrics!.suggestions)))} | | | ${num(describe(okAna.map((a) => a.score ?? NaN)))} | ${num(describe(stability.map((s) => s.detectedDefectsJaccard)), 2)} |`,
    '',
    '### Detecção por tipo de defeito',
    '',
    '| Tipo de defeito | Casos plantados | Taxa de detecção (todas as execuções) |',
    '|---|---|---|',
    ...kinds.map((kind) => {
      const ids = allDefects.filter((d) => d.kind === kind).map((d) => d.id);
      let hits = 0;
      let total = 0;
      for (const a of okAna) {
        const domainDefects = ids.filter((id) => id.startsWith(`${a.domain}.`));
        total += domainDefects.length;
        hits += domainDefects.filter((id) =>
          a.metrics!.detected.includes(id),
        ).length;
      }
      return `| ${KIND_LABEL[kind]} | ${ids.length} | ${total ? ((hits / total) * 100).toFixed(1) + '%' : '—'} (${hits}/${total}) |`;
    }),
    '',
    '## 3. Pertinência das sugestões',
    '',
    'Pendente de avaliação humana. Preencha as colunas `avaliador_1` (e, se houver um segundo avaliador, `avaliador_2`) de ' +
      '`sugestoes-para-avaliar.csv` com `sim`, `parcial` ou `nao` e rode `npm run eval:ai:pertinencia`, que gera `pertinencia.md` ' +
      'com a taxa de sugestões pertinentes e, havendo dois avaliadores, o kappa de Cohen.',
    '',
    '## Execução',
    '',
    `Chamadas: ${calls.length} (${failures.length} falharam). Tokens: ${tokensIn} de entrada e ${tokensOut} de saída. ` +
      `Latência por chamada: ${num(describe(calls.map((c) => c.latencyMs)), 0)} ms. Duração total: ${env.durationSeconds} s.`,
    ...(failures.length
      ? [
          '',
          '| Falha | Erro |',
          '|---|---|',
          ...failures.map(
            (f) =>
              `| ${f.domain} #${f.run} | ${String(f.error).replace(/\|/g, '/')} |`,
          ),
        ]
      : []),
    '',
    'Respostas brutas da IA em `respostas/`, uma por chamada; dados completos em `ai-eval.json`, `geracao-execucoes.csv` e `analise-execucoes.csv`.',
    '',
  ];

  writeFileSync(path, lines.join('\n'));
}
