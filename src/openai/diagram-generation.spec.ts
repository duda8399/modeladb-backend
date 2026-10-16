import {
  GENERATION_SCHEMA,
  describeCurrentDiagram,
  materializeGeneration,
  type GenerationColumn,
  type GenerationResult,
} from './diagram-generation';
import { ANALYSIS_SCHEMA } from './diagram-analysis';

const counter = () => {
  let n = 0;
  return () => `gen-${++n}`;
};

const col = (
  name: string,
  extra: Partial<GenerationColumn> = {},
): GenerationColumn => ({
  name,
  type: 'INT',
  size: null,
  values: null,
  pk: false,
  notNull: false,
  unique: false,
  autoIncrement: false,
  defaultValue: null,
  description: null,
  ...extra,
});

const pk = col('id', { pk: true, notNull: true, autoIncrement: true });

const loja: GenerationResult = {
  diagramName: 'Loja',
  tables: [
    {
      name: 'Cliente',
      columns: [pk, col('nome', { type: 'VARCHAR', size: '120' })],
    },
    { name: 'Pedido', columns: [pk, col('fk_Cliente_id', { notNull: true })] },
  ],
  relationships: [
    {
      parent: 'Cliente',
      child: 'Pedido',
      fkColumn: 'fk_Cliente_id',
      type: '1:N',
      onDelete: 'CASCADE',
      onUpdate: null,
    },
  ],
};

function assertStrict(schema: unknown, path = '$') {
  if (!schema || typeof schema !== 'object') return;
  const node = schema as Record<string, unknown>;
  if (node.type === 'object') {
    expect({ path, additionalProperties: node.additionalProperties }).toEqual({
      path,
      additionalProperties: false,
    });
    const keys = Object.keys(node.properties as object).sort();
    expect({ path, required: [...(node.required as string[])].sort() }).toEqual(
      {
        path,
        required: keys,
      },
    );
  }
  for (const [key, value] of Object.entries(node)) {
    if (Array.isArray(value))
      value.forEach((item, i) => assertStrict(item, `${path}.${key}[${i}]`));
    else if (typeof value === 'object') assertStrict(value, `${path}.${key}`);
  }
}

describe('schemas de Structured Outputs', () => {
  it.each([
    ['geração', GENERATION_SCHEMA],
    ['análise', ANALYSIS_SCHEMA],
  ])('o schema de %s obedece às regras do modo strict', (_, schema) => {
    assertStrict(schema);
  });
});

describe('materializeGeneration', () => {
  it('monta nodes e edges com ids consistentes e FK ligada por id', () => {
    const result = materializeGeneration(loja, undefined, counter());

    expect(result.diagramName).toBe('Loja');
    expect(result.nodes.map((n) => n.data.name)).toEqual(['Cliente', 'Pedido']);
    const [cliente, pedido] = result.nodes;
    const fkField = pedido.data.fields!.find(
      (f) => f.name === 'fk_Cliente_id',
    )!;
    expect(fkField).toMatchObject({ fk: true, notNull: true, pk: false });
    expect(cliente.data.fields![0]).toMatchObject({
      pk: true,
      ai: true,
      notNull: true,
    });
    expect(cliente.data.fields![1]).toMatchObject({
      type: 'VARCHAR',
      size: '120',
    });

    expect(result.edges).toHaveLength(1);
    expect(result.edges[0]).toMatchObject({
      source: cliente.id,
      target: pedido.id,
      type: 'floating',
      label: '1:N',
      data: {
        relationType: '1:N',
        sourceNodeId: cliente.id,
        targetNodeId: pedido.id,
        fkFieldName: 'fk_Cliente_id',
        fkFieldId: fkField.id,
        onDelete: 'CASCADE',
      },
    });
    expect(
      new Set(result.nodes.map((n) => `${n.position.x},${n.position.y}`)).size,
    ).toBe(2);
  });

  it('cria a coluna FK quando o relacionamento cita uma coluna inexistente', () => {
    const result = materializeGeneration(
      {
        ...loja,
        tables: [loja.tables[0], { name: 'Pedido', columns: [pk] }],
        relationships: [{ ...loja.relationships[0], fkColumn: 'cliente_id' }],
      },
      undefined,
      counter(),
    );

    const pedido = result.nodes[1];
    expect(pedido.data.fields!.map((f) => [f.name, f.type, f.fk])).toEqual([
      ['id', 'INT', false],
      ['cliente_id', 'INT', true],
    ]);
    expect(result.edges[0].data.fkFieldName).toBe('cliente_id');
  });

  it('descarta relacionamentos com tabelas inexistentes, auto-relacionamentos e duplicados', () => {
    const result = materializeGeneration(
      {
        ...loja,
        relationships: [
          loja.relationships[0],
          loja.relationships[0],
          { ...loja.relationships[0], parent: 'Fantasma' },
          { ...loja.relationships[0], parent: 'Pedido' },
        ],
      },
      undefined,
      counter(),
    );

    expect(result.edges).toHaveLength(1);
  });

  it('remove tabelas e colunas repetidas e troca tipos desconhecidos por VARCHAR', () => {
    const result = materializeGeneration(
      {
        diagramName: 'X',
        tables: [
          { name: 'A', columns: [pk, col('id'), col('x', { type: 'NUMBER' })] },
          { name: 'a', columns: [pk] },
        ],
        relationships: [],
      },
      undefined,
      counter(),
    );

    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0].data.fields!.map((f) => [f.name, f.type])).toEqual([
      ['id', 'INT'],
      ['x', 'VARCHAR'],
    ]);
  });

  it('mantém valores só para ENUM e SET', () => {
    const result = materializeGeneration(
      {
        diagramName: 'X',
        tables: [
          {
            name: 'A',
            columns: [
              pk,
              col('status', { type: 'ENUM', values: ['ativo', 'inativo'] }),
              col('nome', { type: 'VARCHAR', values: ['a'] }),
            ],
          },
        ],
        relationships: [],
      },
      undefined,
      counter(),
    );

    const fields = result.nodes[0].data.fields!;
    expect(fields[1].values).toEqual(['ativo', 'inativo']);
    expect(fields[2].values).toBeNull();
  });

  it('reaproveita ids, posições, dados extras e ações do diagrama atual', () => {
    const current = {
      diagramName: 'Loja antiga',
      nodes: [
        {
          id: 'cli',
          type: 'entityNode',
          position: { x: 10, y: 20 },
          data: {
            name: 'Cliente',
            fields: [
              { id: 'c1', name: 'id', type: 'INT', pk: true },
              { id: 'c2', name: 'nome', type: 'TEXT', comment: 'x' },
            ],
            indexes: [
              { id: 'i1', name: 'idx_nome', columns: ['c2'], unique: false },
            ],
          },
        },
        {
          id: 'ped',
          type: 'entityNode',
          position: { x: 500, y: 20 },
          data: {
            name: 'Pedido',
            fields: [
              { id: 'p1', name: 'id', type: 'INT', pk: true },
              { id: 'p2', name: 'fk_Cliente_id', type: 'INT', fk: true },
            ],
          },
        },
        {
          id: 'nota',
          type: 'noteNode',
          position: { x: 0, y: 0 },
          data: { text: 'oi' },
        },
      ],
      edges: [
        {
          id: 'e1',
          source: 'cli',
          target: 'ped',
          sourceHandle: 'right',
          data: {
            relationType: '1:N',
            sourceNodeId: 'cli',
            targetNodeId: 'ped',
            fkFieldName: 'fk_Cliente_id',
            fkFieldId: 'p2',
            onUpdate: 'RESTRICT',
          },
        },
      ],
    };

    const result = materializeGeneration(
      {
        ...loja,
        tables: [...loja.tables, { name: 'Produto', columns: [pk] }],
      },
      current,
      counter(),
    );

    const [cliente, pedido, produto, nota] = result.nodes;
    expect(cliente).toMatchObject({ id: 'cli', position: { x: 10, y: 20 } });
    expect(cliente.data.indexes).toEqual(current.nodes[0].data.indexes);
    expect(cliente.data.fields!.map((f) => f.id)).toEqual(['c1', 'c2']);
    expect(cliente.data.fields![1]).toMatchObject({
      type: 'VARCHAR',
      comment: 'x',
    });
    expect(pedido.id).toBe('ped');
    expect(produto.id).toMatch(/^gen-/);
    expect(produto.position.x).toBeGreaterThan(500);
    expect(nota).toMatchObject({ id: 'nota', type: 'noteNode' });

    expect(result.edges).toHaveLength(1);
    expect(result.edges[0]).toMatchObject({
      id: 'e1',
      sourceHandle: 'right',
      data: { fkFieldId: 'p2', onDelete: 'CASCADE', onUpdate: 'RESTRICT' },
    });
  });

  it('ignora nodes, campos e edges excluídos no diagrama atual', () => {
    const current = {
      nodes: [
        {
          id: 'cli',
          type: 'entityNode',
          position: { x: 0, y: 0 },
          data: {
            name: 'Cliente',
            fields: [{ id: 'velho', name: 'id', type: 'INT', deleted: true }],
          },
        },
        {
          id: 'morto',
          type: 'noteNode',
          position: { x: 0, y: 0 },
          data: { deleted: true },
        },
      ],
      edges: [],
    };

    const result = materializeGeneration(loja, current, counter());

    expect(result.nodes.map((n) => n.id)).not.toContain('morto');
    expect(result.nodes[0].data.fields![0].id).not.toBe('velho');
  });
});

describe('describeCurrentDiagram', () => {
  it('retorna null quando não há tabelas', () => {
    expect(describeCurrentDiagram(undefined)).toBeNull();
    expect(
      describeCurrentDiagram({
        nodes: [{ id: 'n', type: 'noteNode', data: {} }],
      }),
    ).toBeNull();
  });

  it('descreve o diagrama no formato da resposta, incluindo N:N por tabela associativa', () => {
    const description = describeCurrentDiagram({
      diagramName: 'Escola',
      nodes: [
        {
          id: 'a',
          type: 'entityNode',
          data: {
            name: 'Aluno',
            fields: [{ id: 'a1', name: 'id', type: 'INT', pk: true, ai: true }],
          },
        },
        {
          id: 't',
          type: 'entityNode',
          data: {
            name: 'Turma',
            fields: [{ id: 't1', name: 'id', type: 'INT', pk: true }],
          },
        },
        {
          id: 'j',
          type: 'entityNode',
          data: {
            name: 'Aluno_Turma',
            fields: [
              {
                id: 'j1',
                name: 'fk_Aluno_id',
                type: 'INT',
                pk: true,
                fk: true,
              },
              {
                id: 'j2',
                name: 'fk_Turma_id',
                type: 'INT',
                pk: true,
                fk: true,
              },
            ],
          },
        },
      ],
      edges: [
        {
          id: 'e1',
          source: 'a',
          target: 'j',
          data: {
            relationType: '1:N',
            sourceNodeId: 'a',
            targetNodeId: 't',
            junctionId: 'j',
          },
        },
        {
          id: 'e2',
          source: 'j',
          target: 't',
          data: {
            relationType: '1:N',
            sourceNodeId: 'a',
            targetNodeId: 't',
            junctionId: 'j',
          },
        },
      ],
    });

    expect(description!.diagramName).toBe('Escola');
    expect(description!.tables[0].columns[0]).toEqual(
      col('id', { pk: true, autoIncrement: true }),
    );
    expect(description!.relationships).toEqual([
      {
        parent: 'Aluno',
        child: 'Aluno_Turma',
        fkColumn: 'fk_Aluno_id',
        type: '1:N',
        onDelete: null,
        onUpdate: null,
      },
      {
        parent: 'Turma',
        child: 'Aluno_Turma',
        fkColumn: 'fk_Turma_id',
        type: '1:N',
        onDelete: null,
        onUpdate: null,
      },
    ]);
  });
});

describe('chave primária obrigatória na geração', () => {
  it('promove a coluna "id" quando a tabela veio sem PK', () => {
    const result = materializeGeneration(
      {
        diagramName: 'X',
        tables: [{ name: 'A', columns: [col('id'), col('nome')] }],
        relationships: [],
      },
      undefined,
      counter(),
    );

    expect(result.nodes[0].data.fields![0]).toMatchObject({
      name: 'id',
      pk: true,
      notNull: true,
      unique: true,
    });
  });

  it('cria a coluna "id" como PK quando não há coluna para promover', () => {
    const result = materializeGeneration(
      {
        diagramName: 'X',
        tables: [
          { name: 'A', columns: [col('nome')] },
          { name: 'B', columns: [] },
        ],
        relationships: [],
      },
      undefined,
      counter(),
    );

    for (const node of result.nodes) {
      expect(node.data.fields![0]).toMatchObject({
        name: 'id',
        type: 'INT',
        pk: true,
        ai: true,
      });
    }
    expect(result.nodes[0].data.fields!.map((f) => f.name)).toEqual([
      'id',
      'nome',
    ]);
  });
});

describe('nomes de tabela únicos na geração', () => {
  it('descarta tabelas cujo nome só difere em maiúsculas, acentos ou espaços', () => {
    const result = materializeGeneration(
      {
        diagramName: 'X',
        tables: [
          { name: 'Matrícula', columns: [pk] },
          { name: 'matricula', columns: [pk] },
          { name: ' MATRICULA ', columns: [pk] },
          { name: 'Item Pedido', columns: [pk] },
          { name: 'Item_Pedido', columns: [pk] },
        ],
        relationships: [],
      },
      undefined,
      counter(),
    );

    expect(result.nodes.map((n) => n.data.name)).toEqual([
      'Matrícula',
      'Item Pedido',
    ]);
  });

  it('renomeia a tabela que colide com uma view existente e mantém o relacionamento', () => {
    const result = materializeGeneration(
      {
        ...loja,
        tables: [loja.tables[0], { ...loja.tables[1], name: 'Pedido' }],
      },
      {
        nodes: [
          {
            id: 'v',
            type: 'viewNode',
            position: { x: 0, y: 0 },
            data: { name: 'pedido', sql: 'SELECT 1' },
          },
        ],
        edges: [],
      },
      counter(),
    );

    const names = result.nodes.map((n) => n.data.name);
    expect(names).toEqual(['Cliente', 'Pedido_2', 'pedido']);
    expect(result.edges).toHaveLength(1);
    expect(result.edges[0].target).toBe(result.nodes[1].id);
  });
});

describe('nomes de coluna únicos na geração', () => {
  it('descarta colunas cujo nome só difere em maiúsculas, acentos ou espaços', () => {
    const result = materializeGeneration(
      {
        diagramName: 'X',
        tables: [
          {
            name: 'A',
            columns: [
              pk,
              col('Endereço', { type: 'TEXT' }),
              col('endereco'),
              col(' ENDERECO '),
              col('data nascimento', { type: 'DATE' }),
              col('data_nascimento'),
            ],
          },
        ],
        relationships: [],
      },
      undefined,
      counter(),
    );

    expect(result.nodes[0].data.fields!.map((f) => [f.name, f.type])).toEqual([
      ['id', 'INT'],
      ['Endereço', 'TEXT'],
      ['data nascimento', 'DATE'],
    ]);
  });

  it('não cria uma FK repetida quando a coluna já existe com outra grafia', () => {
    const result = materializeGeneration(
      {
        ...loja,
        tables: [
          loja.tables[0],
          { name: 'Pedido', columns: [pk, col('FK_Cliente_ID')] },
        ],
      },
      undefined,
      counter(),
    );

    const pedido = result.nodes[1];
    expect(pedido.data.fields!.map((f) => [f.name, f.fk])).toEqual([
      ['id', false],
      ['FK_Cliente_ID', true],
    ]);
    expect(result.edges[0].data.fkFieldId).toBe(pedido.data.fields![1].id);
  });
});
