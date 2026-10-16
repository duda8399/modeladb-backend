import { normalizeGeneratedDiagram } from './generated-diagram';

const entity = (
  id: string,
  name: string,
  fields: Record<string, unknown>[],
) => ({
  id,
  type: 'entityNode',
  data: { name, fields },
  position: { x: 0, y: 0 },
});

const pk = (id: string) => ({ id, name: 'id', type: 'INT', pk: true });
const fk = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
  id,
  name,
  type: 'INT',
  fk: true,
  ...extra,
});

const counter = () => {
  let n = 0;
  return () => `gen-${++n}`;
};

const ids = (diagram: ReturnType<typeof normalizeGeneratedDiagram>) =>
  new Set(diagram.nodes.map((node) => node.id));

describe('normalizeGeneratedDiagram', () => {
  const nodes = [
    entity('cli', 'Cliente', [pk('c1')]),
    entity('pro', 'Produto', [pk('p1')]),
    entity('com', 'Compra', [
      pk('k1'),
      fk('k2', 'fk_Cliente_id'),
      fk('k3', 'fk_Produto_id'),
    ]),
  ];

  it('mantém edges válidas e liga o campo FK por id', () => {
    const result = normalizeGeneratedDiagram(
      {
        diagramName: 'Loja',
        nodes,
        edges: [
          {
            id: 'e1',
            source: 'cli',
            target: 'com',
            sourceHandle: 'right',
            data: { relationType: '1:N', fkFieldName: 'fk_Cliente_id' },
          },
        ],
      },
      counter(),
    );

    expect(result.diagramName).toBe('Loja');
    const edge = result.edges.find((e) => e.id === 'e1')!;
    expect(edge).toMatchObject({
      source: 'cli',
      target: 'com',
      sourceHandle: 'right',
      type: 'floating',
      label: '1:N',
      data: {
        sourceNodeId: 'cli',
        targetNodeId: 'com',
        fkFieldName: 'fk_Cliente_id',
        fkFieldId: 'k2',
      },
    });
  });

  it('recupera edges cujos ids não batem com nenhum node, usando o nome da FK', () => {
    const result = normalizeGeneratedDiagram(
      {
        nodes,
        edges: [
          {
            id: 'e1',
            source: 'uuid-inventado-1',
            target: 'uuid-inventado-2',
            data: { relationType: '1:N', fkFieldName: 'fk_Cliente_id' },
          },
          {
            id: 'e2',
            source: 'Produto',
            target: 'Compra',
            data: { relationType: '1:N', fkFieldName: 'fk_Produto_id' },
          },
        ],
      },
      counter(),
    );

    const valid = ids(result);
    expect(result.edges).toHaveLength(2);
    for (const edge of result.edges) {
      expect(valid.has(edge.source)).toBe(true);
      expect(valid.has(edge.target)).toBe(true);
    }
    expect(
      result.edges.map((e) => [e.source, e.target, e.data.fkFieldId]),
    ).toEqual([
      ['cli', 'com', 'k2'],
      ['pro', 'com', 'k3'],
    ]);
  });

  it('cria edges para campos FK que ficaram sem relacionamento', () => {
    const result = normalizeGeneratedDiagram({ nodes, edges: [] }, counter());

    expect(
      result.edges.map((e) => [
        e.source,
        e.target,
        e.data.fkFieldName,
        e.label,
      ]),
    ).toEqual([
      ['cli', 'com', 'fk_Cliente_id', '1:N'],
      ['pro', 'com', 'fk_Produto_id', '1:N'],
    ]);
  });

  it('usa 1:1 quando a FK é única e não faz parte da PK', () => {
    const result = normalizeGeneratedDiagram(
      {
        nodes: [
          entity('pes', 'Pessoa', [pk('a1')]),
          entity('pas', 'Passaporte', [
            pk('b1'),
            fk('b2', 'fk_Pessoa_id', { unique: true }),
          ]),
        ],
        edges: [],
      },
      counter(),
    );

    expect(result.edges).toHaveLength(1);
    expect(result.edges[0].data.relationType).toBe('1:1');
  });

  it('escolhe a entidade de nome mais longo quando os prefixos se sobrepõem', () => {
    const result = normalizeGeneratedDiagram(
      {
        nodes: [
          entity('a', 'Item', [pk('a1')]),
          entity('b', 'Item_Pedido', [pk('b1')]),
          entity('c', 'Entrega', [pk('c1'), fk('c2', 'fk_Item_Pedido_id')]),
        ],
        edges: [],
      },
      counter(),
    );

    expect(result.edges.map((e) => e.source)).toEqual(['b']);
  });

  it('não duplica edges e descarta as que não dá para resolver', () => {
    const result = normalizeGeneratedDiagram(
      {
        nodes,
        edges: [
          {
            id: 'e1',
            source: 'cli',
            target: 'com',
            data: { fkFieldName: 'fk_Cliente_id' },
          },
          {
            id: 'e1',
            source: 'cli',
            target: 'com',
            data: { fkFieldName: 'fk_Cliente_id' },
          },
          { id: 'e3', source: 'x', target: 'y', data: {} },
          { id: 'e4', source: 'cli', target: 'cli', data: {} },
        ],
      },
      counter(),
    );

    expect(
      result.edges.filter((e) => e.data.fkFieldName === 'fk_Cliente_id'),
    ).toHaveLength(1);
    expect(result.edges.map((e) => e.id)).not.toContain('e3');
    expect(result.edges.map((e) => e.id)).not.toContain('e4');
  });

  it('gera ids novos para nodes, campos e edges duplicados mantendo as referências', () => {
    const result = normalizeGeneratedDiagram(
      {
        nodes: [
          entity('dup', 'Autor', [pk('f')]),
          entity('dup', 'Livro', [pk('f'), fk('f', 'fk_Autor_id')]),
        ],
        edges: [],
      },
      counter(),
    );

    const nodeIds = result.nodes.map((n) => n.id);
    expect(new Set(nodeIds).size).toBe(2);
    const fieldIds = result.nodes.flatMap((n) =>
      n.data.fields!.map((f) => f.id),
    );
    expect(new Set(fieldIds).size).toBe(fieldIds.length);
    expect(result.edges).toHaveLength(1);
    expect(result.edges[0].source).toBe(nodeIds[0]);
    expect(result.edges[0].target).toBe(nodeIds[1]);
  });

  it('completa tipo, posição e tamanho ausentes e ignora lixo', () => {
    const result = normalizeGeneratedDiagram(
      {
        nodes: [{ data: { name: 'Tabela', fields: [pk('x')] } }, 'lixo', null],
        edges: 'nada',
      },
      counter(),
    );

    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0]).toMatchObject({
      id: 'gen-1',
      type: 'entityNode',
      position: { x: 0, y: 0 },
      width: 300,
      height: 102,
      style: null,
    });
    expect(result.edges).toEqual([]);
    expect(normalizeGeneratedDiagram(null).nodes).toEqual([]);
  });
});
