import { randomUUID } from 'crypto';
import { DATA_TYPES } from './diagram-analysis';
import {
  normalizeGeneratedDiagram,
  type GeneratedDiagram,
} from './generated-diagram';

export const GENERATION_FK_ACTIONS = [
  'RESTRICT',
  'CASCADE',
  'SET NULL',
  'SET DEFAULT',
  'NO ACTION',
] as const;

export const GENERATION_RELATION_TYPES = ['1:1', '1:N'] as const;

type FkAction = (typeof GENERATION_FK_ACTIONS)[number];
type RelationType = (typeof GENERATION_RELATION_TYPES)[number];

export type GenerationColumn = {
  name: string;
  type: string;
  size: string | null;
  values: string[] | null;
  pk: boolean;
  notNull: boolean;
  unique: boolean;
  autoIncrement: boolean;
  defaultValue: string | null;
  description: string | null;
};

export type GenerationTable = {
  name: string;
  columns: GenerationColumn[];
};

export type GenerationRelationship = {
  parent: string;
  child: string;
  fkColumn: string;
  type: RelationType;
  onDelete: FkAction | null;
  onUpdate: FkAction | null;
};

export type GenerationResult = {
  diagramName: string;
  tables: GenerationTable[];
  relationships: GenerationRelationship[];
};

export type CurrentDiagram = {
  diagramName?: string;
  nodes?: Record<string, unknown>[];
  edges?: Record<string, unknown>[];
};

type Json = Record<string, unknown>;

const nullable = (schema: Json) => ({ anyOf: [schema, { type: 'null' }] });

export const GENERATION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['diagramName', 'tables', 'relationships'],
  properties: {
    diagramName: { type: 'string' },
    tables: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'columns'],
        properties: {
          name: { type: 'string' },
          columns: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: [
                'name',
                'type',
                'size',
                'values',
                'pk',
                'notNull',
                'unique',
                'autoIncrement',
                'defaultValue',
                'description',
              ],
              properties: {
                name: { type: 'string' },
                type: { type: 'string', enum: DATA_TYPES },
                size: nullable({ type: 'string' }),
                values: nullable({ type: 'array', items: { type: 'string' } }),
                pk: { type: 'boolean' },
                notNull: { type: 'boolean' },
                unique: { type: 'boolean' },
                autoIncrement: { type: 'boolean' },
                defaultValue: nullable({ type: 'string' }),
                description: nullable({ type: 'string' }),
              },
            },
          },
        },
      },
    },
    relationships: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'parent',
          'child',
          'fkColumn',
          'type',
          'onDelete',
          'onUpdate',
        ],
        properties: {
          parent: { type: 'string' },
          child: { type: 'string' },
          fkColumn: { type: 'string' },
          type: { type: 'string', enum: [...GENERATION_RELATION_TYPES] },
          onDelete: nullable({
            type: 'string',
            enum: [...GENERATION_FK_ACTIONS],
          }),
          onUpdate: nullable({
            type: 'string',
            enum: [...GENERATION_FK_ACTIONS],
          }),
        },
      },
    },
  },
} as const;

const isRecord = (value: unknown): value is Json =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const str = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const optStr = (value: unknown): string | null => str(value) || null;

const lower = (value: string) => value.toLowerCase();

export const nameKey = (value: string) =>
  value
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_]/g, '_')
    .toLowerCase();

const finite = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const alive = (item: Json): boolean =>
  item.deleted !== true && !(isRecord(item.data) && item.data.deleted === true);

const liveNodes = (current: CurrentDiagram | undefined): Json[] =>
  (current?.nodes ?? []).filter(isRecord).filter(alive);

const liveEdges = (current: CurrentDiagram | undefined): Json[] =>
  (current?.edges ?? []).filter(isRecord).filter(alive);

const fieldsOf = (node: Json): Json[] => {
  const data = isRecord(node.data) ? node.data : {};
  return Array.isArray(data.fields)
    ? data.fields.filter(isRecord).filter((field) => field.deleted !== true)
    : [];
};

const nameOf = (node: Json): string => {
  const data = isRecord(node.data) ? node.data : {};
  return str(data.name);
};

const FK_ACTION_SET = new Set<string>(GENERATION_FK_ACTIONS);
const DATA_TYPE_SET = new Set(DATA_TYPES);

const fkAction = (value: unknown): FkAction | null =>
  FK_ACTION_SET.has(str(value)) ? (str(value) as FkAction) : null;

export function describeCurrentDiagram(
  current: CurrentDiagram | undefined,
): GenerationResult | null {
  const nodes = liveNodes(current);
  const entities = nodes.filter((node) => node.type === 'entityNode');
  if (!entities.length) return null;

  const byId = new Map(entities.map((node) => [str(node.id), node]));

  const tables: GenerationTable[] = entities.map((node) => ({
    name: nameOf(node) || 'sem_nome',
    columns: fieldsOf(node)
      .filter((field) => str(field.name))
      .map((field) => ({
        name: str(field.name),
        type: str(field.type) || 'VARCHAR',
        size: optStr(field.size),
        values: Array.isArray(field.values)
          ? field.values.filter((v): v is string => typeof v === 'string')
          : null,
        pk: field.pk === true,
        notNull: field.notNull === true,
        unique: field.unique === true,
        autoIncrement: field.ai === true,
        defaultValue: optStr(field.defaultValue),
        description: optStr(field.description),
      })),
  }));

  const relationships: GenerationRelationship[] = [];
  const seen = new Set<string>();

  for (const edge of liveEdges(current)) {
    const data = isRecord(edge.data) ? edge.data : {};

    const junctionId = str(data.junctionId);
    let parent: Json | undefined;
    let child: Json | undefined;
    let fkColumn = str(data.fkFieldName);

    if (junctionId) {
      child = byId.get(junctionId);
      const otherId =
        str(edge.source) === junctionId ? str(edge.target) : str(edge.source);
      parent = byId.get(otherId);
      if (parent && child) {
        const prefix = lower(`fk_${nameOf(parent)}_`);
        fkColumn =
          str(
            fieldsOf(child).find((field) =>
              lower(str(field.name)).startsWith(prefix),
            )?.name,
          ) || `fk_${nameOf(parent)}_id`;
      }
    } else {
      parent = byId.get(str(data.sourceNodeId) || str(edge.source));
      child = byId.get(str(data.targetNodeId) || str(edge.target));
      if (parent && child) {
        const byFieldId = fieldsOf(child).find(
          (field) => str(field.id) && field.id === data.fkFieldId,
        );
        fkColumn =
          str(byFieldId?.name) || fkColumn || `fk_${nameOf(parent)}_id`;
      }
    }

    if (!parent || !child) continue;

    const key = lower(`${nameOf(parent)}|${nameOf(child)}|${fkColumn}`);
    if (seen.has(key)) continue;
    seen.add(key);

    relationships.push({
      parent: nameOf(parent),
      child: nameOf(child),
      fkColumn,
      type: str(data.relationType) === '1:1' ? '1:1' : '1:N',
      onDelete: fkAction(data.onDelete),
      onUpdate: fkAction(data.onUpdate),
    });
  }

  return {
    diagramName: str(current?.diagramName) || 'Diagrama',
    tables,
    relationships,
  };
}

export function buildGenerationSystemPrompt(): string {
  return [
    'Você é um especialista em modelagem de bancos de dados relacionais.',
    'A partir da descrição do usuário, projete o modelo lógico (tabelas, colunas e relacionamentos).',
    'A resposta segue um JSON Schema estrito; preencha todos os campos.',
    '',
    'Regras:',
    '- "diagramName" é um nome curto e descritivo em português para o modelo.',
    '- Nomes de tabela no singular e em PascalCase (ex.: "Cliente", "ItemPedido"). Duas tabelas nunca podem ter o mesmo nome,',
    '  nem nomes que só diferem em maiúsculas, acentos ou espaços, nem o nome de uma view do modelo atual.',
    '- Nomes de coluna únicos dentro da tabela, em snake_case.',
    '- Toda tabela tem chave primária: pk=true e notNull=true. Use autoIncrement=true só em PK inteira simples.',
    '- Toda chave estrangeira é uma coluna na tabela filha, com o mesmo tipo da PK da tabela pai,',
    '  nomeada "fk_<TabelaPai>_<colunaPK>" (ex.: "fk_Cliente_id").',
    '- Para CADA chave estrangeira, inclua exatamente um item em "relationships" com "parent" (tabela referenciada),',
    '  "child" (tabela que contém a FK) e "fkColumn" (nome exato da coluna FK em "child").',
    '  Use em "parent" e "child" os nomes exatos das tabelas em "tables".',
    '- "type" é "1:1" quando a FK também é única (unique=true) e "1:N" nos demais casos.',
    '- Relacionamentos N:N viram uma tabela associativa com as duas FKs formando a PK composta',
    '  (pk=true, autoIncrement=false) e dois itens em "relationships", um para cada tabela pai.',
    '- "size": comprimento para CHAR/VARCHAR/BINARY/VARBINARY (ex.: "255") ou precisão para DECIMAL (ex.: "10,2"); null nos demais.',
    '- "values": lista de valores apenas para ENUM e SET; null nos demais.',
    '- "defaultValue": valor padrão literal (ex.: "0", "CURRENT_TIMESTAMP") ou null.',
    '- "description": explicação curta da coluna ou null.',
    '- "onDelete"/"onUpdate": ação referencial quando fizer sentido (ex.: CASCADE em tabelas dependentes); senão null.',
  ].join('\n');
}

export function buildGenerationUserPrompt(
  description: string,
  current: GenerationResult | null,
): string {
  const parts = [
    'Descrição da estrutura do banco de dados desejada:',
    '"""',
    description.trim(),
    '"""',
  ];

  if (current) {
    parts.push(
      '',
      'Já existe um modelo no editor, no mesmo formato da resposta:',
      JSON.stringify(current),
      '',
      'Use-o como ponto de partida: mantenha os nomes das tabelas e colunas que não precisam mudar,',
      'preserve tudo que não for contradito pela descrição e aplique as mudanças pedidas.',
      'Retorne o modelo COMPLETO resultante, não apenas as alterações.',
    );
  }

  return parts.join('\n');
}

function withPrimaryKey(columns: GenerationColumn[]): GenerationColumn[] {
  if (columns.some((column) => column.pk === true)) return columns;
  const idColumn = columns.find((column) => lower(str(column.name)) === 'id');
  if (idColumn) {
    return columns.map((column) =>
      column === idColumn
        ? { ...column, pk: true, notNull: true, unique: true }
        : column,
    );
  }
  return [
    {
      name: 'id',
      type: 'INT',
      size: null,
      values: null,
      pk: true,
      notNull: true,
      unique: true,
      autoIncrement: true,
      defaultValue: null,
      description: null,
    },
    ...columns,
  ];
}

export function materializeGeneration(
  result: GenerationResult,
  current: CurrentDiagram | undefined,
  newId: () => string = randomUUID,
): GeneratedDiagram {
  const currentNodes = liveNodes(current);
  const currentEdges = liveEdges(current);
  const existingByName = new Map<string, Json>();
  for (const node of currentNodes) {
    if (node.type !== 'entityNode') continue;
    const key = nameKey(nameOf(node));
    if (key && !existingByName.has(key)) existingByName.set(key, node);
  }
  const viewKeys = new Set(
    currentNodes
      .filter((node) => node.type === 'viewNode')
      .map((node) => nameKey(nameOf(node)))
      .filter(Boolean),
  );

  const tables: GenerationTable[] = [];
  const tableNames = new Set<string>();
  for (const table of Array.isArray(result?.tables) ? result.tables : []) {
    const name = str(table?.name);
    if (!nameKey(name) || tableNames.has(nameKey(name))) continue;
    tableNames.add(nameKey(name));
    const columnNames = new Set<string>();
    const columns = (Array.isArray(table.columns) ? table.columns : []).filter(
      (column) => {
        const columnName = nameKey(str(column?.name));
        if (!columnName || columnNames.has(columnName)) return false;
        columnNames.add(columnName);
        return true;
      },
    );
    tables.push({ name, columns: withPrimaryKey(columns) });
  }

  const tableByName = new Map(
    tables.map((table) => [nameKey(table.name), table]),
  );

  for (const table of tables) {
    if (!viewKeys.has(nameKey(table.name))) continue;
    let suffix = 2;
    while (
      viewKeys.has(nameKey(`${table.name}_${suffix}`)) ||
      tableNames.has(nameKey(`${table.name}_${suffix}`))
    ) {
      suffix += 1;
    }
    table.name = `${table.name}_${suffix}`;
    tableNames.add(nameKey(table.name));
  }

  const relationships: GenerationRelationship[] = [];
  const relationKeys = new Set<string>();
  for (const relation of Array.isArray(result?.relationships)
    ? result.relationships
    : []) {
    const parent = tableByName.get(nameKey(str(relation?.parent)));
    const child = tableByName.get(nameKey(str(relation?.child)));
    if (!parent || !child || parent === child) continue;
    const fkColumn = str(relation.fkColumn) || `fk_${parent.name}_id`;
    const key = lower(`${parent.name}|${child.name}|${fkColumn}`);
    if (relationKeys.has(key)) continue;
    relationKeys.add(key);

    if (
      !child.columns.some(
        (column) => nameKey(column.name) === nameKey(fkColumn),
      )
    ) {
      const parentPk = parent.columns.find((column) => column.pk);
      child.columns.push({
        name: fkColumn,
        type: parentPk?.type || 'INT',
        size: parentPk?.size ?? null,
        values: null,
        pk: false,
        notNull: false,
        unique: relation.type === '1:1',
        autoIncrement: false,
        defaultValue: null,
        description: null,
      });
    }

    relationships.push({
      parent: parent.name,
      child: child.name,
      fkColumn,
      type: relation.type === '1:1' ? '1:1' : '1:N',
      onDelete: fkAction(relation.onDelete),
      onUpdate: fkAction(relation.onUpdate),
    });
  }

  const fkColumnsByTable = new Map<string, Set<string>>();
  for (const relation of relationships) {
    const key = nameKey(relation.child);
    const set = fkColumnsByTable.get(key) ?? new Set<string>();
    set.add(nameKey(relation.fkColumn));
    fkColumnsByTable.set(key, set);
  }

  const positioned = currentNodes
    .map((node) => (isRecord(node.position) ? node.position : null))
    .filter((position): position is Json => !!position);
  const baseX = positioned.length
    ? Math.max(...positioned.map((p) => finite(p.x) ?? 0)) + 400
    : 0;
  const baseY = positioned.length
    ? Math.min(...positioned.map((p) => finite(p.y) ?? 0))
    : 0;
  let placed = 0;

  const entityNodes = tables.map((table) => {
    const existing = existingByName.get(nameKey(table.name));
    const existingFields = new Map(
      (existing ? fieldsOf(existing) : []).map((field) => [
        nameKey(str(field.name)),
        field,
      ]),
    );
    const fkColumns = fkColumnsByTable.get(nameKey(table.name)) ?? new Set();

    const fields = table.columns.map((column, order) => {
      const previous = existingFields.get(nameKey(str(column.name)));
      const type = DATA_TYPE_SET.has(str(column.type))
        ? str(column.type)
        : 'VARCHAR';
      const values =
        (type === 'ENUM' || type === 'SET') && Array.isArray(column.values)
          ? column.values.map(str).filter(Boolean)
          : null;
      return {
        ...(previous ?? {}),
        id: str(previous?.id) || newId(),
        name: str(column.name),
        type,
        size: optStr(column.size),
        values,
        pk: column.pk === true,
        fk: fkColumns.has(nameKey(str(column.name))),
        notNull: column.pk === true || column.notNull === true,
        unique: column.unique === true,
        ai: column.autoIncrement === true,
        defaultValue: optStr(column.defaultValue),
        description: optStr(column.description),
        order,
      };
    });

    const existingData =
      existing && isRecord(existing.data) ? existing.data : {};
    let position: { x: number; y: number };
    if (existing && isRecord(existing.position)) {
      position = {
        x: finite(existing.position.x) ?? 0,
        y: finite(existing.position.y) ?? 0,
      };
    } else {
      position = {
        x: baseX + (placed % 4) * 400,
        y: baseY + Math.floor(placed / 4) * 350,
      };
      placed += 1;
    }

    return {
      id: str(existing?.id) || newId(),
      type: 'entityNode',
      data: { ...existingData, name: table.name, fields },
      position,
      style: existing && isRecord(existing.style) ? existing.style : null,
      width: finite(existing?.width) ?? 300,
      height: 60 + 42 * Math.max(fields.length, 1),
    };
  });

  const otherNodes = currentNodes.filter((node) => node.type !== 'entityNode');

  const nodeByName = new Map(
    entityNodes.map((node) => [nameKey(node.data.name), node]),
  );

  const existingEdges = new Map<string, Json>();
  for (const edge of currentEdges) {
    const data = isRecord(edge.data) ? edge.data : {};
    if (data.junctionId) continue;
    const key = [
      str(data.sourceNodeId) || str(edge.source),
      str(data.targetNodeId) || str(edge.target),
      lower(str(data.fkFieldName)),
    ].join('|');
    existingEdges.set(key, edge);
  }

  const edges = relationships.map((relation) => {
    const parent = nodeByName.get(nameKey(relation.parent))!;
    const child = nodeByName.get(nameKey(relation.child))!;
    const field = child.data.fields.find(
      (candidate) => nameKey(candidate.name) === nameKey(relation.fkColumn),
    )!;
    const previous = existingEdges.get(
      [parent.id, child.id, lower(field.name)].join('|'),
    );
    const previousData =
      previous && isRecord(previous.data) ? previous.data : {};
    const onDelete = relation.onDelete ?? fkAction(previousData.onDelete);
    const onUpdate = relation.onUpdate ?? fkAction(previousData.onUpdate);

    return {
      id: str(previous?.id) || newId(),
      source: parent.id,
      sourceHandle: optStr(previous?.sourceHandle),
      target: child.id,
      label: relation.type,
      type: 'floating',
      data: {
        ...previousData,
        relationType: relation.type,
        sourceNodeId: parent.id,
        targetNodeId: child.id,
        fkFieldName: field.name,
        fkFieldId: field.id,
        ...(onDelete ? { onDelete } : {}),
        ...(onUpdate ? { onUpdate } : {}),
      },
    };
  });

  return normalizeGeneratedDiagram(
    {
      diagramName: str(result?.diagramName) || str(current?.diagramName),
      nodes: [...entityNodes, ...otherNodes],
      edges,
    },
    newId,
  );
}
