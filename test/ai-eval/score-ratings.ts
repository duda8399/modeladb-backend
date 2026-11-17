import { readFileSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';

const OUT_DIR = join(resolve(__dirname, '..', '..'), 'reports', 'ai-eval');
const FILE =
  process.env.EVAL_RATINGS_FILE ?? join(OUT_DIR, 'sugestoes-para-avaliar.csv');

type Rating = 'sim' | 'parcial' | 'nao';
const LABELS: Rating[] = ['sim', 'parcial', 'nao'];

export function parseCsv(content: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const text = content.replace(/^\uFEFF/, '');
  const separator =
    text.split('\n')[0].includes(';') && !text.split('\n')[0].includes(',')
      ? ';'
      : ',';

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === separator) {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      if (row.some((v) => v !== '')) rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  row.push(field);
  if (row.some((v) => v !== '')) rows.push(row);
  return rows;
}

export function normalizeRating(value: string): Rating | null {
  const v = value.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (['sim', 's', '1', 'pertinente'].includes(v)) return 'sim';
  if (['parcial', 'parcialmente', 'pp', '0.5', '0,5'].includes(v))
    return 'parcial';
  if (['nao', 'n', '0', 'np', 'nao pertinente'].includes(v)) return 'nao';
  return null;
}

export function cohenKappa(pairs: [Rating, Rating][]) {
  const n = pairs.length;
  if (!n) return null;
  const agree = pairs.filter(([a, b]) => a === b).length / n;
  let expected = 0;
  for (const label of LABELS) {
    const pa = pairs.filter(([a]) => a === label).length / n;
    const pb = pairs.filter(([, b]) => b === label).length / n;
    expected += pa * pb;
  }
  return expected === 1 ? 1 : (agree - expected) / (1 - expected);
}

function rates(ratings: Rating[]) {
  const n = ratings.length;
  const yes = ratings.filter((r) => r === 'sim').length;
  const partial = ratings.filter((r) => r === 'parcial').length;
  return {
    n,
    yes,
    partial,
    no: n - yes - partial,
    strict: n ? yes / n : NaN,
    lenient: n ? (yes + partial * 0.5) / n : NaN,
  };
}

const pct = (v: number) =>
  Number.isFinite(v) ? `${(v * 100).toFixed(1)}%` : '—';

function main() {
  const [header, ...rows] = parseCsv(readFileSync(FILE, 'utf8'));
  const col = (name: string) => {
    const index = header.indexOf(name);
    if (index < 0)
      throw new Error(`coluna "${name}" não encontrada em ${FILE}`);
    return index;
  };
  const iDomain = col('dominio');
  const iCategory = col('categoria');
  const iPlanted = col('defeito_plantado');
  const iA = header.includes('avaliador_1')
    ? col('avaliador_1')
    : col('avaliador');
  const iB = header.indexOf('avaliador_2');
  const iL = header.indexOf('avaliador_llm');

  const items = rows.map((r) => ({
    domain: r[iDomain],
    category: r[iCategory],
    planted: !!r[iPlanted]?.trim(),
    a: normalizeRating(r[iA] ?? ''),
    b: iB >= 0 ? normalizeRating(r[iB] ?? '') : null,
    llm: iL >= 0 ? normalizeRating(r[iL] ?? '') : null,
    raw: [r[iA], iB >= 0 ? r[iB] : '', iL >= 0 ? r[iL] : ''].map((v) =>
      (v ?? '').trim(),
    ),
  }));
  type Item = (typeof items)[number];

  const invalid = items.filter(
    (i) => (i.raw[0] && !i.a) || (i.raw[1] && !i.b) || (i.raw[2] && !i.llm),
  ).length;
  const humans = items.some((i) => i.a || i.b);
  const llmOnly = !humans && items.some((i) => i.llm);
  if (!humans && !llmOnly)
    throw new Error(
      'nenhuma sugestão avaliada (avaliador_1, avaliador_2 ou avaliador_llm)',
    );

  const consensus = (i: Item): Rating | null => {
    if (!humans) return i.llm;
    if (i.a && i.b) return i.a === i.b ? i.a : 'parcial';
    return i.a ?? i.b;
  };

  const groupTable = (title: string, key: (i: Item) => string) => {
    const groups = new Map<string, Rating[]>();
    for (const item of items) {
      const r = consensus(item);
      if (!r) continue;
      groups.set(key(item), [...(groups.get(key(item)) ?? []), r]);
    }
    return [
      `| ${title} | Avaliadas | Pertinentes | Parciais | Não pertinentes | Taxa estrita | Taxa com parciais = 0,5 |`,
      '|---|---|---|---|---|---|---|',
      ...[...groups.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([k, list]) => {
          const r = rates(list);
          return `| ${k} | ${r.n} | ${r.yes} | ${r.partial} | ${r.no} | ${pct(r.strict)} | ${pct(r.lenient)} |`;
        }),
    ];
  };

  const agreement = (
    label: string,
    get: (i: Item) => [Rating | null, Rating | null],
  ) => {
    const pairs = items
      .map(get)
      .filter((p): p is [Rating, Rating] => !!p[0] && !!p[1]);
    if (!pairs.length) return null;
    const same = pairs.filter(([x, y]) => x === y).length / pairs.length;
    return `| ${label} | ${pairs.length} | ${pct(same)} | ${cohenKappa(pairs)?.toFixed(3)} |`;
  };

  const all = rates(items.map(consensus).filter((r): r is Rating => !!r));
  const agreements = [
    agreement('Avaliador 1 x avaliador 2', (i) => [i.a, i.b]),
    agreement('Avaliador 1 x LLM', (i) => [i.a, i.llm]),
    agreement('Avaliador 2 x LLM', (i) => [i.b, i.llm]),
  ].filter((l): l is string => !!l);

  const lines = [
    '# Pertinência das sugestões da análise por IA',
    '',
    `Calculado por \`npm run eval:ai:pertinencia\` em ${new Date().toISOString()} a partir de \`${FILE.replace(/.*\//, '')}\`.`,
    '',
    llmOnly
      ? '**Atenção: só há a avaliação do avaliador automatizado (LLM, coluna `avaliador_llm`).** Ela não substitui a avaliação humana: ' +
        'é uma IA julgando outra IA. Use-a como pré-avaliação e confronte com ao menos um avaliador humano nas colunas `avaliador_1`/`avaliador_2`.'
      : 'A taxa considera só os avaliadores humanos; a coluna `avaliador_llm`, se houver, entra apenas na concordância.',
    '',
    `Sugestões avaliadas: ${all.n} de ${items.length}${invalid ? ` (${invalid} valores não reconhecidos foram ignorados)` : ''}. ` +
      'Quando há dois avaliadores humanos e eles discordam, a sugestão conta como "parcial".',
    '',
    `**Taxa de sugestões pertinentes: ${pct(all.strict)}** (estrita) e ${pct(all.lenient)} contando parciais como meio acerto ` +
      `(${all.yes} pertinentes, ${all.partial} parciais, ${all.no} não pertinentes).`,
    '',
    ...(agreements.length
      ? [
          '## Concordância',
          '',
          '| Par | Sugestões em comum | Concordância | Kappa de Cohen |',
          '|---|---|---|---|',
          ...agreements,
          '',
        ]
      : ['Sem um segundo avaliador não há medida de concordância.', '']),
    '## Por categoria',
    '',
    ...groupTable('Categoria', (i) => i.category),
    '',
    '## Por domínio',
    '',
    ...groupTable('Domínio', (i) => i.domain),
    '',
    '## Sugestões sobre defeitos plantados x demais',
    '',
    ...groupTable('Grupo', (i) =>
      i.planted ? 'Sobre defeito plantado' : 'Outras sugestões',
    ),
    '',
  ];

  writeFileSync(join(OUT_DIR, 'pertinencia.md'), lines.join('\n'));
  console.log(lines.slice(0, 10).join('\n'));
}

if (require.main === module) main();
