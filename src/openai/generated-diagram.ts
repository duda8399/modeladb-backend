import { randomUUID } from 'crypto';

type Json = Record<string, unknown>;

export type GeneratedField = Json & { id: string; name: string };

export type GeneratedNode = {
  id: string;
  type: string;
  data: Json & { name?: string; fields?: GeneratedField[] };
  position: { x: number; y: number };
  style: Json | null;
  width?: number;
  height?: number;
};

export type GeneratedEdge = {
  id: string;
  source: string;
  sourceHandle: string | null;
  target: string;
  label: string;
  type: 'floating';
  data: Json & {
    relationType: '1:1' | '1:N' | 'N:N';
    sourceNodeId: string;
    targetNodeId: string;
    fkFieldName?: string;
    fkFieldId?: string;
  };
};

export type GeneratedDiagram = {
  diagramName?: string;
  nodes: GeneratedNode[];
  edges: GeneratedEdge[];
};

const NODE_TYPES = new Set([
  'entityNode',
  'sectionNode',
  'textNode',
  'noteNode',
  'viewNode',
]);
const RELATION_TYPES = new Set(['1:1', '1:N', 'N:N']);
const HANDLES = new Set(['left', 'right']);

const isRecord = (value: unknown): value is Json =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const str = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const lower = (value: string) => value.toLowerCase();

const finite = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

export function normalizeGeneratedDiagram(
  raw: unknown,
  newId: () => string = randomUUID,
): GeneratedDiagram {
  const input = isRecord(raw) ? raw : {};
  const rawNodes = Array.isArray(input.nodes)
    ? input.nodes.filter(isRecord)
    : [];
  const rawEdges = Array.isArray(input.edges)
    ? input.edges.filter(isRecord)
    : [];

  const usedIds = new Set<string>();
  const uniqueId = (candidate: unknown) => {
    const value = str(candidate);
    const id = value && !usedIds.has(value) ? value : newId();
    usedIds.add(id);
    return id;
  };

  const nodeAlias = new Map<string, string>();

  const nodes: GeneratedNode[] = rawNodes.map((node, index) => {
    const originalId = str(node.id);
    const id = uniqueId(originalId);
    if (originalId && !nodeAlias.has(originalId)) nodeAlias.set(originalId, id);

    const data = isRecord(node.data) ? node.data : {};
    const type = NODE_TYPES.has(str(node.type)) ? str(node.type) : 'entityNode';
    const rawFields = Array.isArray(data.fields)
      ? data.fields.filter(isRecord)
      : [];
    const fields = rawFields.map((field) => ({
      ...field,
      id: uniqueId(field.id),
      name: str(field.name),
    }));

    const x = finite((node.position as Json | undefined)?.x);
    const y = finite((node.position as Json | undefined)?.y);
    const position =
      x !== null && y !== null
        ? { x, y }
        : { x: (index % 4) * 400, y: Math.floor(index / 4) * 350 };

    const name =
      str(data.name) || (type === 'entityNode' ? `Tabela_${index + 1}` : '');

    const result: GeneratedNode = {
      id,
      type,
      data: {
        ...data,
        ...(name ? { name } : {}),
        ...(type === 'entityNode' || type === 'viewNode' ? { fields } : {}),
      },
      position,
      style: isRecord(node.style) ? node.style : null,
    };

    if (type === 'entityNode') {
      result.width = finite(node.width) ?? 300;
      result.height =
        finite(node.height) ?? 60 + 42 * Math.max(fields.length, 1);
    }

    return result;
  });

  const entities = nodes.filter((node) => node.type === 'entityNode');
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const byName = new Map<string, GeneratedNode>();
  for (const node of entities) {
    const key = lower(node.data.name ?? '');
    if (key && !byName.has(key)) byName.set(key, node);
  }

  const resolveNode = (value: unknown): GeneratedNode | undefined => {
    const key = str(value);
    if (!key) return undefined;
    const aliased = nodeAlias.get(key);
    if (aliased) return byId.get(aliased);
    return byName.get(lower(key));
  };

  const fieldsOf = (node: GeneratedNode) => node.data.fields ?? [];
  const parentNameOf = (node: GeneratedNode) => node.data.name ?? node.id;

  const parentFromFkName = (
    fkName: string,
    exclude?: GeneratedNode,
  ): GeneratedNode | undefined => {
    const name = lower(fkName);
    let best: GeneratedNode | undefined;
    for (const node of entities) {
      if (node === exclude) continue;
      const entityName = lower(node.data.name ?? '');
      if (!entityName) continue;
      const prefix = `fk_${entityName}_`;
      if (
        (name.startsWith(prefix) || name === `fk_${entityName}`) &&
        (!best || entityName.length > lower(best.data.name ?? '').length)
      ) {
        best = node;
      }
    }
    return best;
  };

  const findFkField = (
    child: GeneratedNode,
    parent: GeneratedNode,
    fkFieldName: string,
    fkFieldId: string,
  ): GeneratedField | undefined => {
    const fields = fieldsOf(child);
    if (fkFieldId) {
      const byFieldId = fields.find((field) => field.id === fkFieldId);
      if (byFieldId) return byFieldId;
    }
    const expected = lower(fkFieldName || `fk_${parentNameOf(parent)}_id`);
    return (
      fields.find(
        (field) => field.fk === true && lower(field.name) === expected,
      ) ??
      fields.find((field) => lower(field.name) === expected) ??
      (fkFieldName
        ? undefined
        : fields.find(
            (field) =>
              field.fk === true &&
              lower(field.name).startsWith(
                `fk_${lower(parentNameOf(parent))}_`,
              ),
          ))
    );
  };

  const edges: GeneratedEdge[] = [];
  const seen = new Set<string>();
  const claimedFields = new Set<string>();

  const pushEdge = (
    parent: GeneratedNode,
    child: GeneratedNode,
    relationType: GeneratedEdge['data']['relationType'],
    field: GeneratedField | undefined,
    fallbackFkName: string,
    extra: Json,
    candidateId: unknown,
    handle: unknown,
  ) => {
    const fkFieldName =
      field?.name || fallbackFkName || `fk_${parentNameOf(parent)}_id`;
    const key = `${parent.id}|${child.id}|${field?.id ?? lower(fkFieldName)}`;
    if (seen.has(key)) return;
    seen.add(key);
    if (field) claimedFields.add(field.id);

    edges.push({
      id: uniqueId(candidateId),
      source: parent.id,
      sourceHandle: HANDLES.has(str(handle)) ? str(handle) : null,
      target: child.id,
      label: relationType,
      type: 'floating',
      data: {
        ...extra,
        relationType,
        sourceNodeId: parent.id,
        targetNodeId: child.id,
        fkFieldName,
        ...(field ? { fkFieldId: field.id } : {}),
      },
    });
  };

  for (const edge of rawEdges) {
    const data = isRecord(edge.data) ? edge.data : {};
    const fkFieldName = str(data.fkFieldName);

    let parent = resolveNode(edge.source) ?? resolveNode(data.sourceNodeId);
    let child = resolveNode(edge.target) ?? resolveNode(data.targetNodeId);

    if (fkFieldName && (!parent || !child)) {
      if (!child) {
        child = entities.find(
          (node) =>
            node !== parent &&
            fieldsOf(node).some(
              (field) => lower(field.name) === lower(fkFieldName),
            ),
        );
      }
      if (!parent) parent = parentFromFkName(fkFieldName, child);
    }

    if (!parent || !child || parent === child) continue;

    const rawRelation = str(data.relationType) || str(edge.label);
    const relationType = (
      RELATION_TYPES.has(rawRelation) ? rawRelation : '1:N'
    ) as GeneratedEdge['data']['relationType'];
    const field = findFkField(child, parent, fkFieldName, str(data.fkFieldId));

    pushEdge(
      parent,
      child,
      relationType,
      field,
      fkFieldName,
      data,
      edge.id,
      edge.sourceHandle,
    );
  }

  for (const child of entities) {
    for (const field of fieldsOf(child)) {
      if (claimedFields.has(field.id)) continue;
      if (field.fk !== true && !lower(field.name).startsWith('fk_')) continue;
      const parent = parentFromFkName(field.name, child);
      if (!parent) continue;
      const relationType =
        field.unique === true && field.pk !== true ? '1:1' : '1:N';
      pushEdge(
        parent,
        child,
        relationType,
        field,
        field.name,
        {},
        undefined,
        null,
      );
    }
  }

  const diagramName = str(input.diagramName);

  return {
    ...(diagramName ? { diagramName } : {}),
    nodes,
    edges,
  };
}
