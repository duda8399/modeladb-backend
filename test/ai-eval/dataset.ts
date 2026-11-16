export type PkSpec = 'simples' | 'composta' | 'qualquer';

export type GoldEntity = {
  name: string;
  aliases?: string[];
  pk?: PkSpec;
  optional?: boolean;
};

export type GoldRelationship =
  | { parent: string; child: string; card: '1:1' | '1:N' }
  | { a: string; b: string; card: 'N:N' };

export type DefectKind =
  | 'dinheiro_float'
  | 'data_texto'
  | 'falta_unique'
  | 'falta_not_null'
  | 'multivalorado'
  | 'redundancia'
  | 'fk_sem_indice';

export type PlantedDefect = {
  id: string;
  kind: DefectKind;
  table: string;
  column: string;
};

export type FlawedModel = {
  name: string;
  tables: { name: string; columns: string[] }[];
  relationships: [
    parent: string,
    child: string,
    fkColumn: string,
    type: '1:1' | '1:N',
  ][];
  defects: PlantedDefect[];
};

export type Domain = {
  id: string;
  title: string;
  description: string;
  entities: GoldEntity[];
  relationships: GoldRelationship[];
  flawed: FlawedModel;
};

export const DOMAINS: Domain[] = [
  {
    id: 'biblioteca',
    title: 'Biblioteca',
    description:
      'Quero um banco para a biblioteca da faculdade. Os livros têm título, ISBN, ano de publicação e pertencem a uma categoria. ' +
      'Um livro pode ter vários autores e um autor pode ter escrito vários livros; do autor guardamos nome e nacionalidade. ' +
      'A biblioteca tem vários exemplares de cada livro, cada um com um código de tombo e o estado de conservação. ' +
      'Os leitores (alunos e funcionários) têm nome, matrícula e e-mail. Um leitor pega exemplares emprestados: ' +
      'cada empréstimo registra o exemplar, o leitor, a data de retirada, a data prevista e a data de devolução.',
    entities: [
      { name: 'Livro', aliases: ['Obra', 'Titulo'] },
      { name: 'Autor' },
      { name: 'Categoria', aliases: ['Genero'], optional: true },
      { name: 'Exemplar', aliases: ['Copia'] },
      { name: 'Leitor', aliases: ['Usuario', 'Membro', 'Pessoa'] },
      { name: 'Emprestimo' },
    ],
    relationships: [
      { a: 'Livro', b: 'Autor', card: 'N:N' },
      { parent: 'Categoria', child: 'Livro', card: '1:N' },
      { parent: 'Livro', child: 'Exemplar', card: '1:N' },
      { parent: 'Leitor', child: 'Emprestimo', card: '1:N' },
      { parent: 'Exemplar', child: 'Emprestimo', card: '1:N' },
    ],
    flawed: {
      name: 'Biblioteca',
      tables: [
        {
          name: 'Livro',
          columns: [
            'id INT pk ai',
            'titulo VARCHAR(200) nn',
            'isbn VARCHAR(20)',
            'ano INT',
            'autores VARCHAR(255)',
          ],
        },
        {
          name: 'Exemplar',
          columns: [
            'id INT pk ai',
            'tombo VARCHAR(30) nn uq',
            'estado VARCHAR(30)',
            'fk_Livro_id INT nn',
          ],
        },
        {
          name: 'Leitor',
          columns: [
            'id INT pk ai',
            'nome VARCHAR(120) nn',
            'matricula VARCHAR(20) nn uq',
            'email VARCHAR(150)',
          ],
        },
        {
          name: 'Emprestimo',
          columns: [
            'id INT pk ai',
            'data_retirada VARCHAR(20) nn',
            'data_prevista DATE nn',
            'data_devolucao DATE',
            'fk_Leitor_id INT nn',
            'fk_Exemplar_id INT nn',
          ],
        },
      ],
      relationships: [
        ['Livro', 'Exemplar', 'fk_Livro_id', '1:N'],
        ['Leitor', 'Emprestimo', 'fk_Leitor_id', '1:N'],
        ['Exemplar', 'Emprestimo', 'fk_Exemplar_id', '1:N'],
      ],
      defects: [
        {
          id: 'biblioteca.autores',
          kind: 'multivalorado',
          table: 'Livro',
          column: 'autores',
        },
        {
          id: 'biblioteca.isbn',
          kind: 'falta_unique',
          table: 'Livro',
          column: 'isbn',
        },
        {
          id: 'biblioteca.data_retirada',
          kind: 'data_texto',
          table: 'Emprestimo',
          column: 'data_retirada',
        },
        {
          id: 'biblioteca.email',
          kind: 'falta_unique',
          table: 'Leitor',
          column: 'email',
        },
      ],
    },
  },
  {
    id: 'loja',
    title: 'Loja virtual',
    description:
      'Preciso modelar uma loja virtual. Os clientes se cadastram com nome, CPF, e-mail e telefone, e podem ter vários endereços de entrega. ' +
      'Os produtos têm nome, descrição, preço e quantidade em estoque, e cada produto pertence a uma categoria. ' +
      'O cliente faz pedidos; cada pedido tem data, status e endereço de entrega, e contém vários produtos, ' +
      'guardando para cada item a quantidade e o preço unitário no momento da compra. ' +
      'Cada pedido tem um único pagamento, com forma de pagamento, valor e data de confirmação.',
    entities: [
      { name: 'Cliente' },
      { name: 'Endereco' },
      { name: 'Produto' },
      { name: 'Categoria' },
      { name: 'Pedido', aliases: ['Compra', 'Venda'] },
      {
        name: 'ItemPedido',
        aliases: ['PedidoItem', 'ItemCompra', 'ItemVenda', 'PedidoProduto'],
        pk: 'qualquer',
      },
      { name: 'Pagamento', optional: true },
    ],
    relationships: [
      { parent: 'Cliente', child: 'Endereco', card: '1:N' },
      { parent: 'Categoria', child: 'Produto', card: '1:N' },
      { parent: 'Cliente', child: 'Pedido', card: '1:N' },
      { parent: 'Endereco', child: 'Pedido', card: '1:N' },
      { parent: 'Pedido', child: 'ItemPedido', card: '1:N' },
      { parent: 'Produto', child: 'ItemPedido', card: '1:N' },
      { parent: 'Pedido', child: 'Pagamento', card: '1:1' },
    ],
    flawed: {
      name: 'Loja',
      tables: [
        {
          name: 'Cliente',
          columns: [
            'id INT pk ai',
            'nome VARCHAR(120) nn',
            'cpf VARCHAR(14) nn',
            'email VARCHAR(150) nn uq',
          ],
        },
        {
          name: 'Produto',
          columns: [
            'id INT pk ai',
            'nome VARCHAR(120) nn',
            'preco FLOAT nn',
            'estoque INT nn',
          ],
        },
        {
          name: 'Pedido',
          columns: [
            'id INT pk ai',
            'data DATETIME nn',
            'status VARCHAR(20) nn',
            'nome_cliente VARCHAR(120)',
            'fk_Cliente_id INT nn',
          ],
        },
        {
          name: 'ItemPedido',
          columns: [
            'fk_Pedido_id INT pk nn',
            'fk_Produto_id INT pk nn',
            'quantidade INT',
            'preco_unitario DECIMAL(10,2) nn',
          ],
        },
      ],
      relationships: [
        ['Cliente', 'Pedido', 'fk_Cliente_id', '1:N'],
        ['Pedido', 'ItemPedido', 'fk_Pedido_id', '1:N'],
        ['Produto', 'ItemPedido', 'fk_Produto_id', '1:N'],
      ],
      defects: [
        {
          id: 'loja.preco',
          kind: 'dinheiro_float',
          table: 'Produto',
          column: 'preco',
        },
        {
          id: 'loja.cpf',
          kind: 'falta_unique',
          table: 'Cliente',
          column: 'cpf',
        },
        {
          id: 'loja.nome_cliente',
          kind: 'redundancia',
          table: 'Pedido',
          column: 'nome_cliente',
        },
        {
          id: 'loja.quantidade',
          kind: 'falta_not_null',
          table: 'ItemPedido',
          column: 'quantidade',
        },
      ],
    },
  },
  {
    id: 'clinica',
    title: 'Clínica médica',
    description:
      'Sistema para uma clínica médica. Pacientes têm nome, CPF, data de nascimento e telefone. ' +
      'Os médicos têm nome, CRM e uma especialidade (cardiologia, pediatria etc.), e cada especialidade pode ter vários médicos. ' +
      'Um paciente marca consultas com médicos; a consulta tem data, horário, valor e observações. ' +
      'Em uma consulta o médico pode prescrever vários medicamentos, informando dosagem e frequência para cada um. ' +
      'Os medicamentos têm nome comercial e princípio ativo.',
    entities: [
      { name: 'Paciente' },
      { name: 'Medico' },
      { name: 'Especialidade' },
      { name: 'Consulta', aliases: ['Atendimento', 'Agendamento'] },
      { name: 'Medicamento', aliases: ['Remedio'] },
      {
        name: 'Prescricao',
        aliases: [
          'ItemPrescricao',
          'ConsultaMedicamento',
          'Receita',
          'PrescricaoMedicamento',
        ],
        pk: 'qualquer',
      },
    ],
    relationships: [
      { parent: 'Especialidade', child: 'Medico', card: '1:N' },
      { parent: 'Paciente', child: 'Consulta', card: '1:N' },
      { parent: 'Medico', child: 'Consulta', card: '1:N' },
      { parent: 'Consulta', child: 'Prescricao', card: '1:N' },
      { parent: 'Medicamento', child: 'Prescricao', card: '1:N' },
    ],
    flawed: {
      name: 'Clínica',
      tables: [
        {
          name: 'Paciente',
          columns: [
            'id INT pk ai',
            'nome VARCHAR(120) nn',
            'cpf VARCHAR(14) nn uq',
            'data_nascimento VARCHAR(10)',
            'telefones VARCHAR(200)',
          ],
        },
        {
          name: 'Medico',
          columns: [
            'id INT pk ai',
            'nome VARCHAR(120) nn',
            'crm VARCHAR(20) nn',
            'especialidade VARCHAR(60)',
          ],
        },
        {
          name: 'Consulta',
          columns: [
            'id INT pk ai',
            'data_hora DATETIME nn',
            'valor DOUBLE',
            'observacoes TEXT',
            'fk_Paciente_id INT nn',
            'fk_Medico_id INT nn',
          ],
        },
      ],
      relationships: [
        ['Paciente', 'Consulta', 'fk_Paciente_id', '1:N'],
        ['Medico', 'Consulta', 'fk_Medico_id', '1:N'],
      ],
      defects: [
        {
          id: 'clinica.data_nascimento',
          kind: 'data_texto',
          table: 'Paciente',
          column: 'data_nascimento',
        },
        {
          id: 'clinica.telefones',
          kind: 'multivalorado',
          table: 'Paciente',
          column: 'telefones',
        },
        {
          id: 'clinica.valor',
          kind: 'dinheiro_float',
          table: 'Consulta',
          column: 'valor',
        },
        {
          id: 'clinica.crm',
          kind: 'falta_unique',
          table: 'Medico',
          column: 'crm',
        },
      ],
    },
  },
  {
    id: 'escola',
    title: 'Escola',
    description:
      'Banco de dados para controle acadêmico de uma escola técnica. Cada curso tem nome e carga horária total e é composto por várias disciplinas. ' +
      'Uma disciplina tem nome, código e carga horária, pertence a um único curso e é ministrada por um professor; um professor pode ministrar várias disciplinas. ' +
      'Dos professores guardamos nome, e-mail e titulação. Os alunos têm nome, matrícula e data de ingresso. ' +
      'Os alunos se matriculam em disciplinas a cada semestre, e para cada matrícula registramos o semestre, a nota final e a frequência.',
    entities: [
      { name: 'Curso' },
      { name: 'Disciplina', aliases: ['Materia'] },
      { name: 'Professor', aliases: ['Docente'] },
      { name: 'Aluno', aliases: ['Estudante'] },
      {
        name: 'Matricula',
        aliases: ['MatriculaDisciplina', 'AlunoDisciplina', 'Inscricao'],
        pk: 'qualquer',
      },
    ],
    relationships: [
      { parent: 'Curso', child: 'Disciplina', card: '1:N' },
      { parent: 'Professor', child: 'Disciplina', card: '1:N' },
      { parent: 'Aluno', child: 'Matricula', card: '1:N' },
      { parent: 'Disciplina', child: 'Matricula', card: '1:N' },
    ],
    flawed: {
      name: 'Escola',
      tables: [
        {
          name: 'Curso',
          columns: ['id INT pk ai', 'nome VARCHAR(120)', 'carga_horaria INT'],
        },
        {
          name: 'Disciplina',
          columns: [
            'id INT pk ai',
            'nome VARCHAR(120) nn',
            'codigo VARCHAR(20) nn',
            'professor_nome VARCHAR(120)',
            'fk_Curso_id INT nn',
          ],
        },
        {
          name: 'Aluno',
          columns: [
            'id INT pk ai',
            'nome VARCHAR(120) nn',
            'matricula VARCHAR(20) nn uq',
            'data_ingresso DATE nn',
          ],
        },
        {
          name: 'Matricula',
          columns: [
            'id INT pk ai',
            'semestre VARCHAR(6) nn',
            'nota FLOAT',
            'frequencia INT',
            'fk_Aluno_id INT nn',
            'fk_Disciplina_id INT nn',
          ],
        },
      ],
      relationships: [
        ['Curso', 'Disciplina', 'fk_Curso_id', '1:N'],
        ['Aluno', 'Matricula', 'fk_Aluno_id', '1:N'],
        ['Disciplina', 'Matricula', 'fk_Disciplina_id', '1:N'],
      ],
      defects: [
        {
          id: 'escola.professor_nome',
          kind: 'redundancia',
          table: 'Disciplina',
          column: 'professor_nome',
        },
        {
          id: 'escola.codigo',
          kind: 'falta_unique',
          table: 'Disciplina',
          column: 'codigo',
        },
        {
          id: 'escola.curso_nome',
          kind: 'falta_not_null',
          table: 'Curso',
          column: 'nome',
        },
      ],
    },
  },
  {
    id: 'hotel',
    title: 'Hotel',
    description:
      'Quero controlar as reservas de um hotel. Os hóspedes têm nome, documento, e-mail e telefone. ' +
      'Os quartos têm número, andar e um tipo de quarto (standard, luxo, suíte), e o tipo define a capacidade e o valor da diária. ' +
      'Um hóspede faz reservas; cada reserva é de um quarto, com data de entrada, data de saída e situação. ' +
      'Durante a estadia o hóspede consome serviços (frigobar, lavanderia, restaurante): ' +
      'cada serviço tem nome e preço, e para cada reserva registramos quais serviços foram consumidos, a quantidade e a data.',
    entities: [
      { name: 'Hospede', aliases: ['Cliente'] },
      { name: 'Quarto' },
      { name: 'TipoQuarto', aliases: ['CategoriaQuarto'] },
      { name: 'Reserva', aliases: ['Hospedagem', 'Estadia'] },
      { name: 'Servico' },
      {
        name: 'Consumo',
        aliases: [
          'ConsumoServico',
          'ReservaServico',
          'ServicoConsumido',
          'ItemConsumo',
        ],
        pk: 'qualquer',
      },
    ],
    relationships: [
      { parent: 'TipoQuarto', child: 'Quarto', card: '1:N' },
      { parent: 'Hospede', child: 'Reserva', card: '1:N' },
      { parent: 'Quarto', child: 'Reserva', card: '1:N' },
      { parent: 'Reserva', child: 'Consumo', card: '1:N' },
      { parent: 'Servico', child: 'Consumo', card: '1:N' },
    ],
    flawed: {
      name: 'Hotel',
      tables: [
        {
          name: 'Hospede',
          columns: [
            'id INT pk ai',
            'nome VARCHAR(120) nn',
            'documento VARCHAR(20) nn',
            'email VARCHAR(150)',
          ],
        },
        {
          name: 'Quarto',
          columns: [
            'id INT pk ai',
            'numero INT nn uq',
            'andar INT',
            'tipo VARCHAR(20)',
            'valor_diaria FLOAT nn',
          ],
        },
        {
          name: 'Reserva',
          columns: [
            'id INT pk ai',
            'data_entrada DATE nn',
            'data_saida DATE nn',
            'situacao VARCHAR(20)',
            'fk_Hospede_id INT nn',
            'fk_Quarto_id INT nn',
          ],
        },
      ],
      relationships: [
        ['Hospede', 'Reserva', 'fk_Hospede_id', '1:N'],
        ['Quarto', 'Reserva', 'fk_Quarto_id', '1:N'],
      ],
      defects: [
        {
          id: 'hotel.valor_diaria',
          kind: 'dinheiro_float',
          table: 'Quarto',
          column: 'valor_diaria',
        },
        {
          id: 'hotel.documento',
          kind: 'falta_unique',
          table: 'Hospede',
          column: 'documento',
        },
        {
          id: 'hotel.situacao',
          kind: 'falta_not_null',
          table: 'Reserva',
          column: 'situacao',
        },
        {
          id: 'hotel.fk_quarto',
          kind: 'fk_sem_indice',
          table: 'Reserva',
          column: 'fk_Quarto_id',
        },
      ],
    },
  },
  {
    id: 'academia',
    title: 'Academia',
    description:
      'Modelo para uma academia de ginástica. Cada aluno tem nome, CPF, data de nascimento e assina um plano (mensal, trimestral, anual), ' +
      'que tem nome, duração em meses e valor. A academia oferece modalidades (musculação, pilates, natação), ' +
      'e cada modalidade tem várias turmas com dia da semana, horário e número máximo de vagas. ' +
      'Cada turma é conduzida por um instrutor (nome, CREF e telefone). Um aluno pode se inscrever em várias turmas e uma turma tem vários alunos. ' +
      'Também registramos os pagamentos mensais do aluno, com data, valor e forma de pagamento.',
    entities: [
      { name: 'Aluno', aliases: ['Membro', 'Cliente'] },
      { name: 'Plano' },
      { name: 'Modalidade' },
      { name: 'Turma', aliases: ['Aula'] },
      { name: 'Instrutor', aliases: ['Professor'] },
      { name: 'Pagamento', aliases: ['Mensalidade'] },
    ],
    relationships: [
      { parent: 'Plano', child: 'Aluno', card: '1:N' },
      { parent: 'Modalidade', child: 'Turma', card: '1:N' },
      { parent: 'Instrutor', child: 'Turma', card: '1:N' },
      { a: 'Aluno', b: 'Turma', card: 'N:N' },
      { parent: 'Aluno', child: 'Pagamento', card: '1:N' },
    ],
    flawed: {
      name: 'Academia',
      tables: [
        {
          name: 'Plano',
          columns: [
            'id INT pk ai',
            'nome VARCHAR(60) nn',
            'duracao_meses INT nn',
            'valor DOUBLE nn',
          ],
        },
        {
          name: 'Aluno',
          columns: [
            'id INT pk ai',
            'nome VARCHAR(120) nn',
            'cpf VARCHAR(14)',
            'data_nascimento DATE',
            'fk_Plano_id INT nn',
          ],
        },
        {
          name: 'Turma',
          columns: [
            'id INT pk ai',
            'modalidade VARCHAR(60) nn',
            'dia_semana VARCHAR(10) nn',
            'horario TIME nn',
            'vagas INT',
            'instrutor_nome VARCHAR(120)',
          ],
        },
        {
          name: 'Pagamento',
          columns: [
            'id INT pk ai',
            'data_pagamento VARCHAR(10) nn',
            'valor DECIMAL(10,2) nn',
            'fk_Aluno_id INT nn',
          ],
        },
      ],
      relationships: [
        ['Plano', 'Aluno', 'fk_Plano_id', '1:N'],
        ['Aluno', 'Pagamento', 'fk_Aluno_id', '1:N'],
      ],
      defects: [
        {
          id: 'academia.valor',
          kind: 'dinheiro_float',
          table: 'Plano',
          column: 'valor',
        },
        {
          id: 'academia.cpf',
          kind: 'falta_unique',
          table: 'Aluno',
          column: 'cpf',
        },
        {
          id: 'academia.data_pagamento',
          kind: 'data_texto',
          table: 'Pagamento',
          column: 'data_pagamento',
        },
        {
          id: 'academia.instrutor_nome',
          kind: 'redundancia',
          table: 'Turma',
          column: 'instrutor_nome',
        },
      ],
    },
  },
  {
    id: 'rh',
    title: 'Recursos humanos e projetos',
    description:
      'Banco para o RH de uma empresa de software. Os funcionários têm nome, CPF, cargo, salário e data de admissão, e cada um trabalha em um departamento. ' +
      'Um departamento tem nome e sigla, e um de seus funcionários é o gerente do departamento. ' +
      'Cada funcionário tem exatamente um crachá, com número e data de emissão, e um crachá pertence a um só funcionário. ' +
      'Os funcionários podem ter dependentes (nome, parentesco e data de nascimento). ' +
      'A empresa tem projetos, cada um ligado a um departamento, com nome, data de início e orçamento. ' +
      'Um funcionário pode participar de vários projetos e um projeto tem vários funcionários; registramos as horas semanais alocadas de cada um em cada projeto.',
    entities: [
      { name: 'Funcionario', aliases: ['Colaborador', 'Empregado'] },
      { name: 'Departamento', aliases: ['Setor'] },
      { name: 'Cracha', optional: true },
      { name: 'Dependente' },
      { name: 'Projeto' },
      {
        name: 'Alocacao',
        aliases: [
          'FuncionarioProjeto',
          'ProjetoFuncionario',
          'Participacao',
          'AlocacaoProjeto',
        ],
        pk: 'qualquer',
      },
    ],
    relationships: [
      { parent: 'Departamento', child: 'Funcionario', card: '1:N' },
      { parent: 'Funcionario', child: 'Departamento', card: '1:1' },
      { parent: 'Funcionario', child: 'Cracha', card: '1:1' },
      { parent: 'Funcionario', child: 'Dependente', card: '1:N' },
      { parent: 'Departamento', child: 'Projeto', card: '1:N' },
      { parent: 'Funcionario', child: 'Alocacao', card: '1:N' },
      { parent: 'Projeto', child: 'Alocacao', card: '1:N' },
    ],
    flawed: {
      name: 'RH',
      tables: [
        {
          name: 'Departamento',
          columns: ['id INT pk ai', 'nome VARCHAR(80) nn', 'sigla VARCHAR(10)'],
        },
        {
          name: 'Funcionario',
          columns: [
            'id INT pk ai',
            'nome VARCHAR(120) nn',
            'cpf VARCHAR(14) nn',
            'cargo VARCHAR(60)',
            'salario FLOAT nn',
            'admissao DATE nn',
            'departamento_nome VARCHAR(80)',
            'fk_Departamento_id INT nn',
          ],
        },
        {
          name: 'Projeto',
          columns: [
            'id INT pk ai',
            'nome VARCHAR(120) nn',
            'inicio DATE',
            'orcamento DECIMAL(12,2)',
            'fk_Departamento_id INT nn',
          ],
        },
      ],
      relationships: [
        ['Departamento', 'Funcionario', 'fk_Departamento_id', '1:N'],
        ['Departamento', 'Projeto', 'fk_Departamento_id', '1:N'],
      ],
      defects: [
        {
          id: 'rh.salario',
          kind: 'dinheiro_float',
          table: 'Funcionario',
          column: 'salario',
        },
        {
          id: 'rh.cpf',
          kind: 'falta_unique',
          table: 'Funcionario',
          column: 'cpf',
        },
        {
          id: 'rh.departamento_nome',
          kind: 'redundancia',
          table: 'Funcionario',
          column: 'departamento_nome',
        },
        {
          id: 'rh.sigla',
          kind: 'falta_unique',
          table: 'Departamento',
          column: 'sigla',
        },
      ],
    },
  },
  {
    id: 'streaming',
    title: 'Streaming de música',
    description:
      'Plataforma de streaming de música. Os usuários têm nome, e-mail, senha e data de cadastro. ' +
      'Os artistas têm nome e país de origem; cada artista lança álbuns, com título e ano, e cada álbum é de um único artista. ' +
      'Um álbum contém várias músicas, cada uma com título, duração e número da faixa, e cada música tem um gênero musical. ' +
      'Os usuários criam playlists, com nome e indicação se é pública. Uma playlist tem várias músicas e uma música pode estar em várias playlists; ' +
      'guardamos a posição da música na playlist e quando ela foi adicionada.',
    entities: [
      { name: 'Usuario' },
      { name: 'Artista' },
      { name: 'Album' },
      { name: 'Musica', aliases: ['Faixa'] },
      { name: 'Genero', aliases: ['GeneroMusical'], optional: true },
      { name: 'Playlist' },
      {
        name: 'PlaylistMusica',
        aliases: ['ItemPlaylist', 'MusicaPlaylist', 'PlaylistFaixa'],
        pk: 'qualquer',
      },
    ],
    relationships: [
      { parent: 'Artista', child: 'Album', card: '1:N' },
      { parent: 'Album', child: 'Musica', card: '1:N' },
      { parent: 'Genero', child: 'Musica', card: '1:N' },
      { parent: 'Usuario', child: 'Playlist', card: '1:N' },
      { parent: 'Playlist', child: 'PlaylistMusica', card: '1:N' },
      { parent: 'Musica', child: 'PlaylistMusica', card: '1:N' },
    ],
    flawed: {
      name: 'Streaming',
      tables: [
        {
          name: 'Usuario',
          columns: [
            'id INT pk ai',
            'nome VARCHAR(120) nn',
            'email VARCHAR(150) nn',
            'senha VARCHAR(255) nn',
            'cadastro DATETIME',
          ],
        },
        {
          name: 'Artista',
          columns: ['id INT pk ai', 'nome VARCHAR(120) nn', 'pais VARCHAR(60)'],
        },
        {
          name: 'Album',
          columns: [
            'id INT pk ai',
            'titulo VARCHAR(150) nn',
            'ano VARCHAR(4)',
            'artista_nome VARCHAR(120)',
            'fk_Artista_id INT nn',
          ],
        },
        {
          name: 'Musica',
          columns: [
            'id INT pk ai',
            'titulo VARCHAR(150) nn',
            'duracao INT',
            'faixa INT',
            'generos VARCHAR(200)',
            'fk_Album_id INT nn',
          ],
        },
      ],
      relationships: [
        ['Artista', 'Album', 'fk_Artista_id', '1:N'],
        ['Album', 'Musica', 'fk_Album_id', '1:N'],
      ],
      defects: [
        {
          id: 'streaming.email',
          kind: 'falta_unique',
          table: 'Usuario',
          column: 'email',
        },
        {
          id: 'streaming.artista_nome',
          kind: 'redundancia',
          table: 'Album',
          column: 'artista_nome',
        },
        {
          id: 'streaming.generos',
          kind: 'multivalorado',
          table: 'Musica',
          column: 'generos',
        },
        {
          id: 'streaming.fk_album',
          kind: 'fk_sem_indice',
          table: 'Musica',
          column: 'fk_Album_id',
        },
      ],
    },
  },
  {
    id: 'oficina',
    title: 'Oficina mecânica',
    description:
      'Sistema para uma oficina mecânica. Os clientes têm nome, CPF e telefone, e cada cliente pode ter vários veículos (placa, modelo, marca e ano). ' +
      'Quando um veículo chega, é aberta uma ordem de serviço com data de abertura, data de conclusão, status e valor total. ' +
      'Cada ordem de serviço é de um veículo e fica sob responsabilidade de um mecânico (nome e especialidade). ' +
      'Uma ordem pode incluir vários serviços do catálogo da oficina (troca de óleo, alinhamento...), cada um com descrição e preço. ' +
      'A ordem também usa peças do estoque; para cada peça usada registramos a quantidade e o preço cobrado. As peças têm nome, código e preço de venda.',
    entities: [
      { name: 'Cliente' },
      { name: 'Veiculo', aliases: ['Carro'] },
      { name: 'OrdemServico', aliases: ['OS', 'Ordem'] },
      { name: 'Mecanico' },
      { name: 'Servico' },
      { name: 'Peca' },
      {
        name: 'ItemPeca',
        aliases: [
          'OrdemPeca',
          'PecaOrdem',
          'PecaUtilizada',
          'OrdemServicoPeca',
          'ItemOrdemPeca',
          'UsoPeca',
        ],
        pk: 'qualquer',
      },
    ],
    relationships: [
      { parent: 'Cliente', child: 'Veiculo', card: '1:N' },
      { parent: 'Veiculo', child: 'OrdemServico', card: '1:N' },
      { parent: 'Mecanico', child: 'OrdemServico', card: '1:N' },
      { a: 'OrdemServico', b: 'Servico', card: 'N:N' },
      { parent: 'OrdemServico', child: 'ItemPeca', card: '1:N' },
      { parent: 'Peca', child: 'ItemPeca', card: '1:N' },
    ],
    flawed: {
      name: 'Oficina',
      tables: [
        {
          name: 'Cliente',
          columns: [
            'id INT pk ai',
            'nome VARCHAR(120) nn',
            'cpf VARCHAR(14) nn uq',
            'telefone VARCHAR(20)',
          ],
        },
        {
          name: 'Veiculo',
          columns: [
            'id INT pk ai',
            'placa VARCHAR(8) nn',
            'modelo VARCHAR(60) nn',
            'marca VARCHAR(60)',
            'ano INT',
            'fk_Cliente_id INT nn',
          ],
        },
        {
          name: 'OrdemServico',
          columns: [
            'id INT pk ai',
            'abertura VARCHAR(20) nn',
            'conclusao DATETIME',
            'status VARCHAR(20)',
            'valor_total FLOAT',
            'cliente_telefone VARCHAR(20)',
            'fk_Veiculo_id INT nn',
          ],
        },
      ],
      relationships: [
        ['Cliente', 'Veiculo', 'fk_Cliente_id', '1:N'],
        ['Veiculo', 'OrdemServico', 'fk_Veiculo_id', '1:N'],
      ],
      defects: [
        {
          id: 'oficina.placa',
          kind: 'falta_unique',
          table: 'Veiculo',
          column: 'placa',
        },
        {
          id: 'oficina.abertura',
          kind: 'data_texto',
          table: 'OrdemServico',
          column: 'abertura',
        },
        {
          id: 'oficina.valor_total',
          kind: 'dinheiro_float',
          table: 'OrdemServico',
          column: 'valor_total',
        },
        {
          id: 'oficina.cliente_telefone',
          kind: 'redundancia',
          table: 'OrdemServico',
          column: 'cliente_telefone',
        },
      ],
    },
  },
  {
    id: 'eventos',
    title: 'Venda de ingressos',
    description:
      'Plataforma de venda de ingressos para eventos. Cada evento tem nome, data, horário e descrição, é criado por um organizador ' +
      '(nome, CNPJ e e-mail) e acontece em um local (nome, endereço e capacidade). ' +
      'Cada evento oferece tipos de ingresso (pista, camarote, meia-entrada), cada um com preço e quantidade disponível. ' +
      'Os participantes (nome, CPF e e-mail) fazem compras; uma compra tem data e valor total e pode conter vários ingressos. ' +
      'Cada ingresso emitido é de um tipo de ingresso e tem um código único. Na entrada do evento, o ingresso pode ter no máximo um check-in, com data e hora.',
    entities: [
      { name: 'Evento' },
      { name: 'Organizador', aliases: ['Produtor'] },
      { name: 'Local' },
      { name: 'TipoIngresso', aliases: ['CategoriaIngresso', 'Lote', 'Setor'] },
      { name: 'Participante', aliases: ['Cliente', 'Comprador', 'Usuario'] },
      { name: 'Compra', aliases: ['Pedido', 'Venda'] },
      { name: 'Ingresso' },
      {
        name: 'CheckIn',
        aliases: ['Checkin', 'Entrada', 'Acesso'],
        optional: true,
      },
    ],
    relationships: [
      { parent: 'Organizador', child: 'Evento', card: '1:N' },
      { parent: 'Local', child: 'Evento', card: '1:N' },
      { parent: 'Evento', child: 'TipoIngresso', card: '1:N' },
      { parent: 'Participante', child: 'Compra', card: '1:N' },
      { parent: 'Compra', child: 'Ingresso', card: '1:N' },
      { parent: 'TipoIngresso', child: 'Ingresso', card: '1:N' },
      { parent: 'Ingresso', child: 'CheckIn', card: '1:1' },
    ],
    flawed: {
      name: 'Ingressos',
      tables: [
        {
          name: 'Organizador',
          columns: [
            'id INT pk ai',
            'nome VARCHAR(120) nn',
            'cnpj VARCHAR(18) nn',
            'email VARCHAR(150)',
          ],
        },
        {
          name: 'Evento',
          columns: [
            'id INT pk ai',
            'nome VARCHAR(150) nn',
            'data VARCHAR(10)',
            'local_nome VARCHAR(120)',
            'local_capacidade INT',
            'fk_Organizador_id INT nn',
          ],
        },
        {
          name: 'TipoIngresso',
          columns: [
            'id INT pk ai',
            'nome VARCHAR(60) nn',
            'preco DOUBLE nn',
            'quantidade INT',
            'fk_Evento_id INT nn',
          ],
        },
        {
          name: 'Ingresso',
          columns: [
            'id INT pk ai',
            'codigo VARCHAR(40) nn',
            'fk_TipoIngresso_id INT nn',
          ],
        },
      ],
      relationships: [
        ['Organizador', 'Evento', 'fk_Organizador_id', '1:N'],
        ['Evento', 'TipoIngresso', 'fk_Evento_id', '1:N'],
        ['TipoIngresso', 'Ingresso', 'fk_TipoIngresso_id', '1:N'],
      ],
      defects: [
        {
          id: 'eventos.codigo',
          kind: 'falta_unique',
          table: 'Ingresso',
          column: 'codigo',
        },
        {
          id: 'eventos.preco',
          kind: 'dinheiro_float',
          table: 'TipoIngresso',
          column: 'preco',
        },
        {
          id: 'eventos.data',
          kind: 'data_texto',
          table: 'Evento',
          column: 'data',
        },
        {
          id: 'eventos.local_capacidade',
          kind: 'redundancia',
          table: 'Evento',
          column: 'local_capacidade',
        },
      ],
    },
  },
];
