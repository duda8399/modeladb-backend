import { randomUUID } from 'crypto';

export const DATA_TYPES = [
  'TINYINT',
  'SMALLINT',
  'MEDIUMINT',
  'INT',
  'BIGINT',
  'DECIMAL',
  'FLOAT',
  'DOUBLE',
  'BIT',
  'DATE',
  'DATETIME',
  'TIMESTAMP',
  'TIME',
  'YEAR',
  'CHAR',
  'VARCHAR',
  'TINYTEXT',
  'TEXT',
  'MEDIUMTEXT',
  'LONGTEXT',
  'ENUM',
  'SET',
  'BINARY',
  'VARBINARY',
  'TINYBLOB',
  'BLOB',
  'MEDIUMBLOB',
  'LONGBLOB',
  'BOOLEAN',
  'JSON',
  'GEOMETRY',
  'POINT',
];

export const CATEGORIES = [
  'normalizacao',
  'chaves',
  'tipos',
  'integridade',
  'nomenclatura',
  'desempenho',
  'modelagem',
] as const;

export const SEVERITIES = ['alta', 'media', 'baixa'] as const;

export const ACTION_TYPES = [
  'rename_table',
  'rename_column',
  'set_column_type',
  'set_column_flag',
  'set_default',
  'add_column',
  'add_index',
  'add_check',
  'set_fk_action',
] as const;

const FK_ACTIONS = ['RESTRICT', 'CASCADE', 'SET NULL', 'NO ACTION'] as const;
const MAX_SUGGESTIONS = 20;

export type ActionType = (typeof ACTION_TYPES)[number];

export type SuggestionAction = {
  type: ActionType;
  table: string;
  column: string | null;
  newName: string | null;
  dataType: string | null;
  size: string | null;
  flag: 'notNull' | 'unique' | null;
  value: boolean | null;
  columns: string[] | null;
  expression: string | null;
  defaultValue: string | null;
  onDelete: (typeof FK_ACTIONS)[number] | null;
  onUpdate: (typeof FK_ACTIONS)[number] | null;
};

export type Suggestion = {
  id: string;
  category: (typeof CATEGORIES)[number];
  severity: (typeof SEVERITIES)[number];
  title: string;
  description: string;
  table: string | null;
  column: string | null;
  action: SuggestionAction | null;
};

export type AnalysisResult = {
  score: number;
  summary: string;
  suggestions: Suggestion[];
};

type RawNode = { id?: unknown; type?: unknown; data?: unknown };
type RawEdge = { source?: unknown; target?: unknown; data?: unknown };

type CompactColumn = {
  name: string;
  type: string | null;
  size?: string;
  pk?: true;
  fk?: true;
  notNull?: true;
  unique?: true;
  autoIncrement?: true;
  default?: string;
};

export type CompactModel = {
  name: string;
  tables: {
    name: string;
    columns: CompactColumn[];
    indexes?: { name: string; columns: string[]; unique: boolean }[];
    checks?: string[];
  }[];
  relationships: {
    parent: string;
    child: string;
    type: string;
    fkColumn: string | null;
    onDelete?: string;
    onUpdate?: string;
  }[];
  views: { name: string; sql: string }[];
};

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : {};

const asString = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value : null;

export function compactModel(
  diagramName: string | undefined,
  nodes: unknown[] = [],
  edges: unknown[] = [],
): CompactModel {
  const nameById = new Map<string, string>();
  const tables: CompactModel['tables'] = [];
  const views: CompactModel['views'] = [];

  for (const raw of nodes as RawNode[]) {
    const data = asRecord(raw?.data);
    const id = asString(raw?.id);
    const name = asString(data.name) ?? 'sem_nome';

    if (raw?.type === 'viewNode') {
      views.push({ name, sql: asString(data.sql) ?? '' });
      continue;
    }
    if (raw?.type !== 'entityNode') continue;
    if (id) nameById.set(id, name);

    const fields = (Array.isArray(data.fields) ? data.fields : []).map(
      asRecord,
    );
    const fieldNameById = new Map(fields.map((f) => [f.id, asString(f.name)]));

    const columns: CompactColumn[] = fields
      .filter((f) => asString(f.name))
      .map((f) => ({
        name: f.name as string,
        type: asString(f.type),
        ...(asString(f.size) ? { size: f.size as string } : {}),
        ...(f.pk ? { pk: true as const } : {}),
        ...(f.fk ? { fk: true as const } : {}),
        ...(f.notNull ? { notNull: true as const } : {}),
        ...(f.unique ? { unique: true as const } : {}),
        ...(f.ai ? { autoIncrement: true as const } : {}),
        ...(asString(f.defaultValue)
          ? { default: f.defaultValue as string }
          : {}),
      }));

    const indexes = (Array.isArray(data.indexes) ? data.indexes : [])
      .map(asRecord)
      .map((index) => ({
        name: asString(index.name) ?? '',
        columns: (Array.isArray(index.columns) ? index.columns : [])
          .map((columnId) => fieldNameById.get(columnId))
          .filter((column): column is string => !!column),
        unique: !!index.unique,
      }));

    const checks = (Array.isArray(data.checks) ? data.checks : [])
      .map((check) => asString(asRecord(check).expression))
      .filter((expression): expression is string => !!expression);

    tables.push({
      name,
      columns,
      ...(indexes.length ? { indexes } : {}),
      ...(checks.length ? { checks } : {}),
    });
  }

  const relationships: CompactModel['relationships'] = [];
  const seenJunctions = new Set<string>();
  for (const raw of edges as RawEdge[]) {
    const data = asRecord(raw?.data);
    const junctionId = asString(data.junctionId);
    if (junctionId) {
      if (seenJunctions.has(junctionId)) continue;
      seenJunctions.add(junctionId);
      relationships.push({
        parent: nameById.get(asString(data.sourceNodeId) ?? '') ?? '?',
        child: nameById.get(asString(data.targetNodeId) ?? '') ?? '?',
        type: `N:N via ${nameById.get(junctionId) ?? '?'}`,
        fkColumn: null,
      });
      continue;
    }
    relationships.push({
      parent:
        nameById.get(
          asString(data.sourceNodeId) ?? asString(raw?.source) ?? '',
        ) ?? '?',
      child:
        nameById.get(
          asString(data.targetNodeId) ?? asString(raw?.target) ?? '',
        ) ?? '?',
      type: asString(data.relationType) ?? '1:N',
      fkColumn: asString(data.fkFieldName),
      ...(asString(data.onDelete) ? { onDelete: data.onDelete as string } : {}),
      ...(asString(data.onUpdate) ? { onUpdate: data.onUpdate as string } : {}),
    });
  }

  return {
    name: diagramName?.trim() || 'Diagrama',
    tables,
    relationships,
    views,
  };
}

const nullable = (schema: Record<string, unknown>) => ({
  anyOf: [schema, { type: 'null' }],
});

export const ANALYSIS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['score', 'summary', 'suggestions'],
  properties: {
    score: { type: 'integer' },
    summary: { type: 'string' },
    suggestions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'category',
          'severity',
          'title',
          'description',
          'table',
          'column',
          'action',
        ],
        properties: {
          category: { type: 'string', enum: [...CATEGORIES] },
          severity: { type: 'string', enum: [...SEVERITIES] },
          title: { type: 'string' },
          description: { type: 'string' },
          table: nullable({ type: 'string' }),
          column: nullable({ type: 'string' }),
          action: nullable({
            type: 'object',
            additionalProperties: false,
            required: [
              'type',
              'table',
              'column',
              'newName',
              'dataType',
              'size',
              'flag',
              'value',
              'columns',
              'expression',
              'defaultValue',
              'onDelete',
              'onUpdate',
            ],
            properties: {
              type: { type: 'string', enum: [...ACTION_TYPES] },
              table: { type: 'string' },
              column: nullable({ type: 'string' }),
              newName: nullable({ type: 'string' }),
              dataType: nullable({ type: 'string', enum: DATA_TYPES }),
              size: nullable({ type: 'string' }),
              flag: nullable({ type: 'string', enum: ['notNull', 'unique'] }),
              value: nullable({ type: 'boolean' }),
              columns: nullable({ type: 'array', items: { type: 'string' } }),
              expression: nullable({ type: 'string' }),
              defaultValue: nullable({ type: 'string' }),
              onDelete: nullable({ type: 'string', enum: [...FK_ACTIONS] }),
              onUpdate: nullable({ type: 'string', enum: [...FK_ACTIONS] }),
            },
          }),
        },
      },
    },
  },
} as const;

export function buildAnalysisSystemPrompt(): string {
  return [
    'Você é um especialista em modelagem lógica de bancos de dados relacionais e revisa modelos feitos por estudantes e desenvolvedores.',
    'Analise o modelo recebido e aponte problemas e melhorias concretas, em português do Brasil.',
    '',
    'Avalie, entre outros:',
    '- normalização (1FN, 2FN, 3FN): atributos multivalorados, dependências parciais e transitivas, dados repetidos;',
    '- chaves: tabelas sem chave primária, chaves estrangeiras sem relacionamento, tipo da FK diferente da PK referenciada;',
    '- tipos: dinheiro em FLOAT/DOUBLE em vez de DECIMAL, datas em VARCHAR, VARCHAR sem tamanho adequado, BOOLEAN para flags;',
    '- integridade: colunas que deveriam ser NOT NULL ou UNIQUE (ex.: e-mail, CPF), CHECK para domínios (preço >= 0), DEFAULT úteis, ON DELETE adequado;',
    '- nomenclatura: padrão consistente (snake_case, singular ou plural em todas as tabelas), nomes ambíguos;',
    '- desempenho: índices em colunas de FK e em colunas usadas para busca;',
    '- modelagem: entidades ou relacionamentos que parecem faltar, tabelas redundantes.',
    '',
    'Regras da resposta:',
    '- score: nota de 0 a 100 para a qualidade geral do modelo.',
    '- summary: duas ou três frases com a avaliação geral.',
    '- suggestions: no máximo 15, as mais importantes primeiro. Não repita a mesma sugestão para várias colunas; agrupe quando fizer sentido.',
    '- table e column: o nome exato da tabela e da coluna afetadas, como aparecem no modelo, ou null.',
    '- action: preencha só quando a correção puder ser aplicada mecanicamente por UMA das ações abaixo; senão use null (ex.: dividir uma tabela para normalizar).',
    '  Use somente nomes de tabelas e colunas que existem no modelo. Campos não usados pela ação devem ser null.',
    '  - rename_table: table, newName.',
    '  - rename_column: table, column, newName.',
    '  - set_column_type: table, column, dataType e size (ex.: "10,2" para DECIMAL, "150" para VARCHAR, ou null).',
    '  - set_column_flag: table, column, flag ("notNull" ou "unique") e value.',
    '  - set_default: table, column, defaultValue em SQL (ex.: "0", "\'ativo\'", "CURRENT_TIMESTAMP").',
    '  - add_column: table, column (nome da nova coluna), dataType, size, value (true se NOT NULL), defaultValue.',
    '  - add_index: table, columns (lista de colunas existentes), value (true se o índice for único).',
    '  - add_check: table, expression (condição SQL sem a palavra CHECK).',
    '  - set_fk_action: table (tabela filha), column (coluna FK), onDelete e onUpdate.',
  ].join('\n');
}

export function buildAnalysisUserPrompt(
  model: CompactModel,
  focus?: string,
): string {
  return [
    focus?.trim()
      ? `Foco pedido pelo usuário: """${focus.trim().slice(0, 1000)}"""\n`
      : '',
    'Modelo a analisar (JSON):',
    JSON.stringify(model),
  ].join('\n');
}

const SIZED = new Set([
  'CHAR',
  'VARCHAR',
  'BINARY',
  'VARBINARY',
  'DECIMAL',
  'BIT',
  'DATETIME',
  'TIMESTAMP',
  'TIME',
]);

function validSize(dataType: string, size: string | null): boolean {
  if (!size) return true;
  if (!SIZED.has(dataType)) return false;
  return dataType === 'DECIMAL'
    ? /^\d+(,\d+)?$/.test(size)
    : /^\d+$/.test(size);
}

function validateAction(
  action: SuggestionAction,
  model: CompactModel,
): SuggestionAction | null {
  const lower = (value: string | null) => (value ?? '').trim().toLowerCase();
  const table = model.tables.find((t) => lower(t.name) === lower(action.table));
  if (!table) return null;

  const hasColumn = (name: string | null) =>
    !!name && table.columns.some((c) => lower(c.name) === lower(name));
  const canonical = (name: string | null) =>
    table.columns.find((c) => lower(c.name) === lower(name))?.name ?? null;
  const size = action.size ? action.size.replace(/\s+/g, '') : null;
  const base = { ...action, table: table.name, size };

  switch (action.type) {
    case 'rename_table':
      return action.newName?.trim() &&
        !model.tables.some(
          (t) => t !== table && lower(t.name) === lower(action.newName),
        )
        ? { ...base, newName: action.newName.trim() }
        : null;
    case 'rename_column':
      return hasColumn(action.column) &&
        action.newName?.trim() &&
        !hasColumn(action.newName)
        ? {
            ...base,
            column: canonical(action.column),
            newName: action.newName.trim(),
          }
        : null;
    case 'set_column_type':
      return hasColumn(action.column) &&
        action.dataType &&
        validSize(action.dataType, size)
        ? { ...base, column: canonical(action.column) }
        : null;
    case 'set_column_flag':
      return hasColumn(action.column) && action.flag && action.value !== null
        ? { ...base, column: canonical(action.column) }
        : null;
    case 'set_default':
      return hasColumn(action.column) && action.defaultValue?.trim()
        ? {
            ...base,
            column: canonical(action.column),
            defaultValue: action.defaultValue.trim(),
          }
        : null;
    case 'add_column':
      return action.column?.trim() &&
        !hasColumn(action.column) &&
        action.dataType &&
        validSize(action.dataType, size)
        ? { ...base, column: action.column.trim() }
        : null;
    case 'add_index': {
      const columns = (action.columns ?? []).map((c) => canonical(c));
      return columns.length && columns.every(Boolean)
        ? { ...base, columns: columns as string[] }
        : null;
    }
    case 'add_check':
      return action.expression?.trim()
        ? { ...base, expression: action.expression.trim() }
        : null;
    case 'set_fk_action': {
      const isRelationFk = model.relationships.some(
        (r) =>
          lower(r.child) === lower(table.name) &&
          lower(r.fkColumn) === lower(action.column),
      );
      return isRelationFk && (action.onDelete || action.onUpdate)
        ? { ...base, column: canonical(action.column) }
        : null;
    }
    default:
      return null;
  }
}

export function sanitizeAnalysis(
  raw: unknown,
  model: CompactModel,
): AnalysisResult {
  const data = asRecord(raw);
  const score = Number(data.score);
  const suggestions = (Array.isArray(data.suggestions) ? data.suggestions : [])
    .map(asRecord)
    .filter((s) => asString(s.title) && asString(s.description))
    .slice(0, MAX_SUGGESTIONS)
    .map((s) => {
      const action =
        s.action && typeof s.action === 'object'
          ? validateAction(s.action as SuggestionAction, model)
          : null;
      return {
        id: randomUUID(),
        category: (CATEGORIES as readonly string[]).includes(
          s.category as string,
        )
          ? (s.category as Suggestion['category'])
          : 'modelagem',
        severity: (SEVERITIES as readonly string[]).includes(
          s.severity as string,
        )
          ? (s.severity as Suggestion['severity'])
          : 'media',
        title: (s.title as string).trim(),
        description: (s.description as string).trim(),
        table: asString(s.table),
        column: asString(s.column),
        action,
      };
    });

  return {
    score: Number.isFinite(score)
      ? Math.max(0, Math.min(100, Math.round(score)))
      : 0,
    summary: asString(data.summary)?.trim() ?? '',
    suggestions,
  };
}
