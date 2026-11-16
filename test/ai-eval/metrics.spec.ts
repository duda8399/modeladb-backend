import { DOMAINS } from './dataset';
import {
  entityKey,
  scoreAnalysis,
  scoreGeneration,
  type EvalModel,
} from './metrics';
import { cohenKappa, normalizeRating, parseCsv } from './score-ratings';

const biblioteca = DOMAINS.find((d) => d.id === 'biblioteca')!;
const academia = DOMAINS.find((d) => d.id === 'academia')!;

const table = (name: string, ...columns: string[]) => ({
  name,
  columns: [
    { name: 'id', type: 'INT', pk: true, unique: true },
    ...columns.map((c) => ({ name: c, type: 'INT', pk: false, unique: false })),
  ],
});

const rel = (parent: string, child: string, type = '1:N') => ({
  parent,
  child,
  type,
  fkColumn: `fk_${parent}_id`,
});

function bibliotecaModel(): EvalModel {
  return {
    tables: [
      table('Livros', 'fk_Categoria_id'),
      table('Autores'),
      table('Categoria'),
      table('Exemplar', 'fk_Livros_id'),
      table('Usuário', ''),
      table('Empréstimo', 'fk_Usuário_id', 'fk_Exemplar_id'),
      {
        name: 'LivroAutor',
        columns: [
          { name: 'fk_Livros_id', type: 'INT', pk: true, unique: false },
          { name: 'fk_Autores_id', type: 'INT', pk: true, unique: false },
        ],
      },
    ],
    relationships: [
      rel('Categoria', 'Livros'),
      rel('Livros', 'Exemplar'),
      rel('Usuário', 'Empréstimo'),
      rel('Exemplar', 'Empréstimo'),
      rel('Livros', 'LivroAutor'),
      rel('Autores', 'LivroAutor'),
    ],
  };
}

describe('métricas da avaliação da IA', () => {
  it('normaliza plural, acentos e CamelCase', () => {
    expect(entityKey('Empréstimos')).toBe(entityKey('Emprestimo'));
    expect(entityKey('Autores')).toBe('autor');
    expect(entityKey('TipoDeQuarto')).toBe(entityKey('Tipo_Quarto'));
    expect(entityKey('Prescrições')).toBe(entityKey('Prescricao'));
  });

  it('modelo equivalente ao gabarito, com sinônimos e tabela associativa, tem nota máxima', () => {
    const score = scoreGeneration(biblioteca, bibliotecaModel());
    expect(score.entities.f1).toBe(1);
    expect(score.relationships.f1).toBe(1);
    expect(score.cardinality.accuracy).toBe(1);
    expect(score.primaryKeys.accuracy).toBe(1);
  });

  it('penaliza entidade ausente, relacionamento invertido e cardinalidade errada', () => {
    const model = bibliotecaModel();
    model.tables = model.tables.filter((t) => t.name !== 'Categoria');
    model.relationships = model.relationships.filter(
      (r) => r.parent !== 'Categoria',
    );
    model.relationships[0] = rel('Exemplar', 'Livros');
    model.relationships[1].type = '1:1';
    model.tables.push(table('Editora'));

    const score = scoreGeneration(biblioteca, model);
    expect(score.entities.missing).toEqual([]);
    expect(score.entities.extra).toEqual(['Editora']);
    expect(score.relationships.missing).toContain('Livro 1:N Exemplar');
    expect(score.cardinality.errors).toEqual([
      'Leitor→Emprestimo: esperado 1:N, gerado 1:1',
    ]);
  });

  it('entidade obrigatória ausente reduz a revocação; opcional ausente não', () => {
    const model = bibliotecaModel();
    model.tables = model.tables.filter(
      (t) => t.name !== 'Exemplar' && t.name !== 'Categoria',
    );
    const score = scoreGeneration(biblioteca, model);
    expect(score.entities.missing).toEqual(['Exemplar']);
    expect(score.entities.recall).toBeCloseTo(4 / 5);
  });

  it('N:N modelado como 1:N direto não conta como encontrado', () => {
    const model: EvalModel = {
      tables: [
        table('Aluno', 'fk_Turma_id', 'fk_Plano_id'),
        table('Turma'),
        table('Plano'),
      ],
      relationships: [rel('Turma', 'Aluno'), rel('Plano', 'Aluno')],
    };
    const score = scoreGeneration(academia, model);
    expect(score.relationships.missing).toContain('Aluno N:N Turma');
    expect(score.relationships.precision).toBeCloseTo(1 / 2);
  });

  it('defeito plantado é detectado pela tabela e coluna ou pelo texto', () => {
    const [autores, isbn] = biblioteca.flawed.defects;
    const result = scoreAnalysis(biblioteca.flawed.defects, [
      {
        id: '1',
        category: 'normalizacao',
        severity: 'alta',
        title: 'Autores em uma coluna',
        description: 'A coluna autores guarda vários nomes.',
        table: 'Livro',
        column: null,
        action: null,
      },
      {
        id: '2',
        category: 'tipos',
        severity: 'baixa',
        title: 'Ano como YEAR',
        description: '',
        table: 'Livro',
        column: 'ano',
        action: null,
      },
    ]);
    expect(result.detected).toEqual([autores.id]);
    expect(result.detected).not.toContain(isbn.id);
    expect(result.linked).toEqual([[autores.id], []]);
  });
});

describe('pertinência', () => {
  it('lê CSV com aspas, vírgulas e quebras de linha', () => {
    expect(parseCsv('﻿a,b\n"x, ""y""","linha\nnova"\n')).toEqual([
      ['a', 'b'],
      ['x, "y"', 'linha\nnova'],
    ]);
  });

  it('aceita variações de resposta', () => {
    expect(normalizeRating('Sim')).toBe('sim');
    expect(normalizeRating('não')).toBe('nao');
    expect(normalizeRating('Parcial')).toBe('parcial');
    expect(normalizeRating('talvez')).toBeNull();
  });

  it('kappa de Cohen', () => {
    expect(
      cohenKappa([
        ['sim', 'sim'],
        ['nao', 'nao'],
      ]),
    ).toBe(1);
    expect(
      cohenKappa([
        ['sim', 'nao'],
        ['nao', 'sim'],
      ]),
    ).toBe(-1);
  });
});
