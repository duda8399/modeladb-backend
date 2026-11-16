import type {
  Domain,
  GoldEntity,
  GoldRelationship,
  PkSpec,
  PlantedDefect,
} from './dataset';

export type EvalColumn = {
  name: string;
  type: string;
  pk: boolean;
  unique: boolean;
};

export type EvalTable = { name: string; columns: EvalColumn[] };

export type EvalRelationship = {
  parent: string;
  child: string;
  type: string;
  fkColumn: string;
};

export type EvalModel = {
  tables: EvalTable[];
  relationships: EvalRelationship[];
};

type Json = Record<string, unknown>;

const STOPWORDS = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'tb', 'tbl']);

const asRecord = (value: unknown): Json =>
  value && typeof value === 'object' ? (value as Json) : {};

const text = (value: unknown) => (typeof value === 'string' ? value : '');

export function tokens(name: string): string[] {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^a-zA-Z0-9]+/)
    .map((t) => t.toLowerCase())
    .filter((t) => t && !STOPWORDS.has(t));
}

function singular(word: string) {
  if (word.length > 4 && /(oes|aes)$/.test(word))
    return `${word.slice(0, -3)}ao`;
  if (word.length > 4 && /[rzl]es$/.test(word)) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith('s')) return word.slice(0, -1);
  return word;
}

export function entityKey(name: string) {
  return tokens(name).map(singular).join('');
}

export const columnKey = (name: string) => tokens(name).join('_');

export function fromDiagram(diagram: {
  nodes?: unknown[];
  edges?: unknown[];
}): EvalModel {
  const nameById = new Map<string, string>();
  const tables: EvalTable[] = [];

  for (const raw of diagram.nodes ?? []) {
    const node = asRecord(raw);
    if (node.type !== 'entityNode') continue;
    const data = asRecord(node.data);
    const name = text(data.name);
    nameById.set(text(node.id), name);
    const fields = Array.isArray(data.fields) ? data.fields.map(asRecord) : [];
    tables.push({
      name,
      columns: fields
        .filter((f) => !f.deleted && text(f.name))
        .map((f) => ({
          name: text(f.name),
          type: text(f.type).toUpperCase(),
          pk: !!f.pk,
          unique: !!f.unique,
        })),
    });
  }

  const relationships: EvalRelationship[] = (diagram.edges ?? []).map((raw) => {
    const edge = asRecord(raw);
    const data = asRecord(edge.data);
    return {
      parent: nameById.get(text(data.sourceNodeId) || text(edge.source)) ?? '?',
      child: nameById.get(text(data.targetNodeId) || text(edge.target)) ?? '?',
      type: text(data.relationType) || '1:N',
      fkColumn: text(data.fkFieldName),
    };
  });

  return { tables, relationships };
}

type Mapping = {
  goldByTable: Map<string, string>;
  tableByGold: Map<string, string>;
  junctions: Map<string, [string, string]>;
};

function goldKeys(entity: GoldEntity) {
  return new Set([entity.name, ...(entity.aliases ?? [])].map(entityKey));
}

function isNN(
  rel: GoldRelationship,
): rel is { a: string; b: string; card: 'N:N' } {
  return rel.card === 'N:N';
}

function mapEntities(domain: Domain, model: EvalModel): Mapping {
  const goldByTable = new Map<string, string>();
  const tableByGold = new Map<string, string>();

  for (const entity of domain.entities) {
    const keys = goldKeys(entity);
    const table = model.tables.find(
      (t) => !goldByTable.has(t.name) && keys.has(entityKey(t.name)),
    );
    if (!table) continue;
    goldByTable.set(table.name, entity.name);
    tableByGold.set(entity.name, table.name);
  }

  const mapped = (name: string) => goldByTable.get(name);
  const parentsOf = (tableName: string) => [
    ...new Set(
      model.relationships
        .filter((r) => r.child === tableName)
        .map((r) => mapped(r.parent))
        .filter((p): p is string => !!p),
    ),
  ];

  for (const entity of domain.entities) {
    if (tableByGold.has(entity.name)) continue;
    const goldParents = domain.relationships
      .filter(
        (r): r is Extract<GoldRelationship, { child: string }> =>
          !isNN(r) && r.child === entity.name,
      )
      .map((r) => r.parent)
      .sort();
    if (goldParents.length < 2) continue;
    const table = model.tables.find((t) => {
      if (goldByTable.has(t.name)) return false;
      const parents = parentsOf(t.name).sort();
      return (
        parents.length === goldParents.length &&
        parents.every((p, i) => p === goldParents[i])
      );
    });
    if (!table) continue;
    goldByTable.set(table.name, entity.name);
    tableByGold.set(entity.name, table.name);
  }

  const junctions = new Map<string, [string, string]>();
  for (const table of model.tables) {
    if (goldByTable.has(table.name)) continue;
    const parents = parentsOf(table.name);
    if (parents.length === 2)
      junctions.set(table.name, [parents[0], parents[1]]);
  }

  return { goldByTable, tableByGold, junctions };
}

const ratio = (num: number, den: number) => (den ? num / den : null);

function f1(p: number | null, r: number | null) {
  if (p === null || r === null) return null;
  return p + r ? (2 * p * r) / (p + r) : 0;
}

function pkOk(table: EvalTable, spec: PkSpec, fkColumns: Set<string>) {
  const pks = table.columns.filter((c) => c.pk);
  if (!pks.length) return false;
  if (spec === 'qualquer') return true;
  if (spec === 'simples') return pks.length === 1;
  return pks.length >= 2 && pks.every((c) => fkColumns.has(columnKey(c.name)));
}

export type GenerationScore = {
  entities: {
    gold: number;
    required: number;
    generated: number;
    matched: number;
    matchedRequired: number;
    extra: string[];
    missing: string[];
    precision: number | null;
    recall: number | null;
    f1: number | null;
  };
  primaryKeys: {
    evaluated: number;
    correct: number;
    accuracy: number | null;
    tablesWithoutPk: number;
  };
  relationships: {
    gold: number;
    generated: number;
    considered: number;
    matched: number;
    precision: number | null;
    recall: number | null;
    f1: number | null;
    missing: string[];
  };
  cardinality: {
    evaluated: number;
    correct: number;
    accuracy: number | null;
    errors: string[];
  };
  integrity: { foreignKeys: number; valid: number; rate: number | null };
  entitySet: string[];
  relationshipSet: string[];
};

export function scoreGeneration(
  domain: Domain,
  model: EvalModel,
): GenerationScore {
  const { goldByTable, tableByGold, junctions } = mapEntities(domain, model);
  const allJunctions = new Map(junctions);
  const label = (table: string) => goldByTable.get(table) ?? table;

  const required = domain.entities.filter((e) => !e.optional);
  const matchedRequired = required.filter((e) =>
    tableByGold.has(e.name),
  ).length;
  const extra = model.tables
    .filter((t) => !goldByTable.has(t.name) && !junctions.has(t.name))
    .map((t) => t.name);
  const precisionEntities = ratio(
    goldByTable.size,
    goldByTable.size + extra.length,
  );
  const recallEntities = ratio(matchedRequired, required.length);

  const optionalEntity = new Set(
    domain.entities.filter((e) => e.optional).map((e) => e.name),
  );
  const relevant = domain.relationships.filter((r) => {
    const ends = isNN(r) ? [r.a, r.b] : [r.parent, r.child];
    return ends.every((e) => !optionalEntity.has(e) || tableByGold.has(e));
  });

  const used = new Set<number>();
  const missing: string[] = [];
  const cardinalityErrors: string[] = [];
  let matched = 0;
  let cardinalityCorrect = 0;
  let cardinalityEvaluated = 0;

  for (const rel of relevant) {
    if (isNN(rel)) {
      const junction = [...junctions.entries()].find(
        ([, [p, q]]) =>
          (p === rel.a && q === rel.b) || (p === rel.b && q === rel.a),
      );
      if (!junction) {
        missing.push(`${rel.a} N:N ${rel.b}`);
        continue;
      }
      model.relationships.forEach((r, i) => {
        if (r.child === junction[0] && [rel.a, rel.b].includes(label(r.parent)))
          used.add(i);
      });
      junctions.delete(junction[0]);
      matched++;
      cardinalityEvaluated++;
      cardinalityCorrect++;
      continue;
    }

    const find = (parent: string, child: string) =>
      model.relationships.findIndex(
        (r, i) =>
          !used.has(i) &&
          label(r.parent) === parent &&
          label(r.child) === child,
      );
    let index = find(rel.parent, rel.child);
    if (index < 0 && rel.card === '1:1') index = find(rel.child, rel.parent);
    if (index < 0) {
      missing.push(`${rel.parent} ${rel.card} ${rel.child}`);
      continue;
    }
    used.add(index);
    matched++;
    cardinalityEvaluated++;
    const generatedType = model.relationships[index].type;
    if (generatedType === rel.card) cardinalityCorrect++;
    else
      cardinalityErrors.push(
        `${rel.parent}→${rel.child}: esperado ${rel.card}, gerado ${generatedType}`,
      );
  }

  const falsePositives =
    model.relationships.filter(
      (r, i) =>
        !used.has(i) && goldByTable.has(r.parent) && goldByTable.has(r.child),
    ).length + junctions.size;
  const consideredUnits = matched + falsePositives;

  const tableByName = new Map(model.tables.map((t) => [t.name, t]));
  const fkColumnsByTable = new Map<string, Set<string>>();
  let validFks = 0;
  for (const rel of model.relationships) {
    const child = tableByName.get(rel.child);
    const parent = tableByName.get(rel.parent);
    const fk = child?.columns.find(
      (c) => columnKey(c.name) === columnKey(rel.fkColumn),
    );
    const parentPks = parent?.columns.filter((c) => c.pk) ?? [];
    if (child && fk) {
      const set = fkColumnsByTable.get(child.name) ?? new Set<string>();
      set.add(columnKey(fk.name));
      fkColumnsByTable.set(child.name, set);
    }
    if (fk && parentPks.length === 1 && parentPks[0].type === fk.type)
      validFks++;
  }

  const pkTargets: [EvalTable, PkSpec][] = [];
  for (const entity of domain.entities) {
    const tableName = tableByGold.get(entity.name);
    const table = tableName ? tableByName.get(tableName) : undefined;
    if (table) pkTargets.push([table, entity.pk ?? 'simples']);
  }
  const pkCorrect = pkTargets.filter(([t, spec]) =>
    pkOk(t, spec, fkColumnsByTable.get(t.name) ?? new Set()),
  ).length;

  const entitySet = model.tables
    .map((t) => goldByTable.get(t.name) ?? `extra:${entityKey(t.name)}`)
    .sort();
  const relationshipSet = [
    ...new Set(
      model.relationships.map((r) => {
        const pair = allJunctions.get(r.child);
        if (pair) return `N:N:${[...pair].sort().join('|')}`;
        return `${label(r.parent)}>${label(r.child)}:${r.type}`;
      }),
    ),
  ].sort();

  const relPrecision = ratio(matched, consideredUnits);
  const relRecall = ratio(matched, relevant.length);

  return {
    entities: {
      gold: domain.entities.length,
      required: required.length,
      generated: model.tables.length,
      matched: goldByTable.size,
      matchedRequired,
      extra,
      missing: required
        .filter((e) => !tableByGold.has(e.name))
        .map((e) => e.name),
      precision: precisionEntities,
      recall: recallEntities,
      f1: f1(precisionEntities, recallEntities),
    },
    primaryKeys: {
      evaluated: pkTargets.length,
      correct: pkCorrect,
      accuracy: ratio(pkCorrect, pkTargets.length),
      tablesWithoutPk: model.tables.filter((t) => !t.columns.some((c) => c.pk))
        .length,
    },
    relationships: {
      gold: relevant.length,
      generated: model.relationships.length,
      considered: consideredUnits,
      matched,
      precision: relPrecision,
      recall: relRecall,
      f1: f1(relPrecision, relRecall),
      missing,
    },
    cardinality: {
      evaluated: cardinalityEvaluated,
      correct: cardinalityCorrect,
      accuracy: ratio(cardinalityCorrect, cardinalityEvaluated),
      errors: cardinalityErrors,
    },
    integrity: {
      foreignKeys: model.relationships.length,
      valid: validFks,
      rate: ratio(validFks, model.relationships.length),
    },
    entitySet,
    relationshipSet,
  };
}

export function jaccard(a: string[], b: string[]) {
  const sa = new Set(a);
  const sb = new Set(b);
  const union = new Set([...sa, ...sb]);
  if (!union.size) return 1;
  let inter = 0;
  for (const v of sa) if (sb.has(v)) inter++;
  return inter / union.size;
}

export function meanPairwiseJaccard(sets: string[][]) {
  const values: number[] = [];
  for (let i = 0; i < sets.length; i++) {
    for (let j = i + 1; j < sets.length; j++)
      values.push(jaccard(sets[i], sets[j]));
  }
  return values.length
    ? values.reduce((s, v) => s + v, 0) / values.length
    : null;
}

export type EvalSuggestion = {
  id: string;
  category: string;
  severity: string;
  title: string;
  description: string;
  table: string | null;
  column: string | null;
  action: Json | null;
};

export function suggestionHitsDefect(s: EvalSuggestion, defect: PlantedDefect) {
  const action = s.action ?? {};
  const body = `${s.title} ${s.description}`.toLowerCase();
  const tableKey = entityKey(defect.table);
  const colKey = columnKey(defect.column);

  const tableOk =
    (s.table && entityKey(s.table) === tableKey) ||
    (typeof action.table === 'string' &&
      entityKey(action.table) === tableKey) ||
    body.includes(defect.table.toLowerCase());
  if (!tableOk) return false;

  const columns = [
    s.column,
    action.column,
    ...(Array.isArray(action.columns) ? action.columns : []),
  ]
    .filter((c): c is string => typeof c === 'string')
    .map(columnKey);
  return columns.includes(colKey) || body.includes(defect.column.toLowerCase());
}

export function scoreAnalysis(
  defects: PlantedDefect[],
  suggestions: EvalSuggestion[],
) {
  const detected = defects.filter((d) =>
    suggestions.some((s) => suggestionHitsDefect(s, d)),
  );
  const linked = suggestions.map((s) =>
    defects.filter((d) => suggestionHitsDefect(s, d)).map((d) => d.id),
  );
  return {
    defects: defects.length,
    detected: detected.map((d) => d.id),
    recall: ratio(detected.length, defects.length),
    suggestions: suggestions.length,
    suggestionsOnPlanted: linked.filter((l) => l.length).length,
    withAction: suggestions.filter((s) => s.action).length,
    linked,
  };
}
