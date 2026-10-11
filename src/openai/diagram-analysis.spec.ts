import {
  compactModel,
  sanitizeAnalysis,
  type SuggestionAction,
} from './diagram-analysis';

const nodes = [
  {
    id: 'c',
    type: 'entityNode',
    data: {
      name: 'cliente',
      fields: [
        {
          id: 'c1',
          name: 'id',
          type: 'INT',
          pk: true,
          notNull: true,
          ai: true,
        },
        { id: 'c2', name: 'email', type: 'VARCHAR', size: '255' },
        { id: 'c3', name: null, type: null },
      ],
      indexes: [{ id: 'i', name: 'idx_email', columns: ['c2'], unique: false }],
      checks: [{ id: 'k', name: 'chk', expression: 'id > 0' }],
    },
  },
  {
    id: 'p',
    type: 'entityNode',
    data: {
      name: 'pedido',
      fields: [
        { id: 'p1', name: 'id', type: 'INT', pk: true },
        { id: 'p2', name: 'cliente_id', type: 'INT', fk: true },
        { id: 'p3', name: 'total', type: 'FLOAT', defaultValue: '0' },
      ],
    },
  },
  { id: 'v', type: 'viewNode', data: { name: 'resumo', sql: 'SELECT 1' } },
  { id: 'n', type: 'noteNode', data: { text: 'ignorar' } },
];

const edges = [
  {
    id: 'e',
    source: 'c',
    target: 'p',
    data: {
      relationType: '1:N',
      sourceNodeId: 'c',
      targetNodeId: 'p',
      fkFieldName: 'cliente_id',
      onDelete: 'CASCADE',
    },
  },
];

const model = compactModel(' Loja ', nodes, edges);

const action = (partial: Partial<SuggestionAction>): SuggestionAction => ({
  type: 'set_column_type',
  table: 'pedido',
  column: null,
  newName: null,
  dataType: null,
  size: null,
  flag: null,
  value: null,
  columns: null,
  expression: null,
  defaultValue: null,
  onDelete: null,
  onUpdate: null,
  ...partial,
});

const suggestion = (a: SuggestionAction | null) => ({
  category: 'tipos',
  severity: 'alta',
  title: 't',
  description: 'd',
  table: 'pedido',
  column: 'total',
  action: a,
});

const analyze = (...actions: (SuggestionAction | null)[]) =>
  sanitizeAnalysis(
    { score: 70, summary: 's', suggestions: actions.map(suggestion) },
    model,
  ).suggestions.map((s) => s.action);

describe('compactModel', () => {
  it('resume tabelas, colunas, índices, CHECK, relacionamentos e views, ignorando o resto', () => {
    expect(model).toEqual({
      name: 'Loja',
      tables: [
        {
          name: 'cliente',
          columns: [
            {
              name: 'id',
              type: 'INT',
              pk: true,
              notNull: true,
              autoIncrement: true,
            },
            { name: 'email', type: 'VARCHAR', size: '255' },
          ],
          indexes: [{ name: 'idx_email', columns: ['email'], unique: false }],
          checks: ['id > 0'],
        },
        {
          name: 'pedido',
          columns: [
            { name: 'id', type: 'INT', pk: true },
            { name: 'cliente_id', type: 'INT', fk: true },
            { name: 'total', type: 'FLOAT', default: '0' },
          ],
        },
      ],
      relationships: [
        {
          parent: 'cliente',
          child: 'pedido',
          type: '1:N',
          fkColumn: 'cliente_id',
          onDelete: 'CASCADE',
        },
      ],
      views: [{ name: 'resumo', sql: 'SELECT 1' }],
    });
  });

  it('relacionamento N:N aparece uma vez, pela tabela associativa', () => {
    const junction = compactModel(
      'x',
      [
        ...nodes,
        { id: 'j', type: 'entityNode', data: { name: 'cp', fields: [] } },
      ],
      [
        {
          source: 'c',
          target: 'j',
          data: { junctionId: 'j', sourceNodeId: 'c', targetNodeId: 'p' },
        },
        {
          source: 'j',
          target: 'p',
          data: { junctionId: 'j', sourceNodeId: 'c', targetNodeId: 'p' },
        },
      ],
    );
    expect(junction.relationships).toEqual([
      {
        parent: 'cliente',
        child: 'pedido',
        type: 'N:N via cp',
        fkColumn: null,
      },
    ]);
  });
});

describe('sanitizeAnalysis', () => {
  it('limita a nota a 0..100, gera ids e corrige categoria/severidade desconhecidas', () => {
    const result = sanitizeAnalysis(
      {
        score: 140,
        summary: '  ok  ',
        suggestions: [
          { ...suggestion(null), category: 'outra', severity: 'urgente' },
          { title: '', description: 'x' },
        ],
      },
      model,
    );
    expect(result.score).toBe(100);
    expect(result.summary).toBe('ok');
    expect(result.suggestions).toEqual([
      expect.objectContaining({
        id: expect.any(String),
        category: 'modelagem',
        severity: 'media',
        action: null,
      }),
    ]);
  });

  it('mantém ações válidas e normaliza nomes para os do modelo', () => {
    expect(
      analyze(
        action({ column: 'TOTAL', dataType: 'DECIMAL', size: '10, 2' }),
        action({
          type: 'set_column_flag',
          table: 'CLIENTE',
          column: 'email',
          flag: 'unique',
          value: true,
        }),
        action({ type: 'add_index', table: 'pedido', columns: ['Cliente_ID'] }),
        action({
          type: 'set_fk_action',
          column: 'cliente_id',
          onDelete: 'RESTRICT',
        }),
        action({
          type: 'add_column',
          column: 'criado_em',
          dataType: 'DATETIME',
        }),
        action({ type: 'add_check', expression: ' total >= 0 ' }),
        action({
          type: 'rename_column',
          column: 'total',
          newName: 'valor_total',
        }),
        action({ type: 'rename_table', newName: 'pedidos' }),
        action({ type: 'set_default', column: 'total', defaultValue: '0' }),
      ),
    ).toEqual([
      expect.objectContaining({
        table: 'pedido',
        column: 'total',
        dataType: 'DECIMAL',
        size: '10,2',
      }),
      expect.objectContaining({
        table: 'cliente',
        column: 'email',
        flag: 'unique',
        value: true,
      }),
      expect.objectContaining({ columns: ['cliente_id'] }),
      expect.objectContaining({ type: 'set_fk_action', onDelete: 'RESTRICT' }),
      expect.objectContaining({ type: 'add_column', column: 'criado_em' }),
      expect.objectContaining({ expression: 'total >= 0' }),
      expect.objectContaining({ newName: 'valor_total' }),
      expect.objectContaining({ newName: 'pedidos' }),
      expect.objectContaining({ defaultValue: '0' }),
    ]);
  });

  it('descarta ações que citam tabelas ou colunas inexistentes ou são incoerentes', () => {
    expect(
      analyze(
        action({ table: 'produto', column: 'preco', dataType: 'DECIMAL' }),
        action({ column: 'inexistente', dataType: 'INT' }),
        action({ column: 'total', dataType: 'INT', size: '10' }),
        action({ type: 'add_column', column: 'total', dataType: 'INT' }),
        action({ type: 'rename_table', newName: 'Cliente' }),
        action({ type: 'rename_column', column: 'total', newName: 'id' }),
        action({ type: 'add_index', columns: ['cliente_id', 'nada'] }),
        action({ type: 'set_fk_action', column: 'total', onDelete: 'CASCADE' }),
        action({
          type: 'set_column_flag',
          column: 'total',
          flag: 'notNull',
          value: null,
        }),
        action({ type: 'add_check', expression: '  ' }),
      ),
    ).toEqual(Array(10).fill(null));
  });
});
