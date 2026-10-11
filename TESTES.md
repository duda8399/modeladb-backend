# Testes do backend

## Pré-requisitos

- Node 20.19 ou superior (`nvm use` lê o `.nvmrc`).
- Nenhum banco precisa estar rodando. Os testes sobem um MongoDB em memória
  (`mongodb-memory-server`) e **nunca** usam a `DATABASE_URL` do `.env`.
  Há uma trava em `test/support/memory-db.ts` que aborta se a URL não for local.
- E-mail e S3 são substituídos por dublês; nenhum serviço externo é chamado.

## Comandos

| Comando | O que roda | Tempo |
|---|---|---|
| `npm test` | Testes unitários (`src/**/*.spec.ts`), com Prisma simulado | ~1 s |
| `npm run test:e2e` | Integração: API HTTP + gateway Socket.IO com a aplicação real | ~15 s |
| `npm run test:e2e:cov` | O mesmo, com relatório de cobertura em `coverage-e2e/` | ~20 s |
| `npm run perf:realtime` | Latência e vazão do gateway com 2 a 100 clientes | ~1 min |
| `npm run test:server` | Sobe o backend isolado em `:3101` (usado pelo Playwright do frontend) | — |

## O que cada suíte cobre

| Arquivo | Conteúdo |
|---|---|
| `test/auth.e2e-spec.ts` | Cadastro, login, hash bcrypt, tokens inválidos/forjados/expirados, recuperação de senha |
| `test/diagram-permissions.e2e-spec.ts` | Matriz papel × ação (dono, editor, leitor, sem acesso) × 7 ações = 28 casos |
| `test/diagrams.e2e-spec.ts` | Persistência dos nós/arestas, listagens, convites, troca de papel, remoção, exclusão em cascata |
| `test/realtime.e2e-spec.ts` | Handshake com JWT, entrada na sala, presença, difusão de operações, ordem FIFO, isolamento entre salas, bloqueio do leitor |
| `test/versions.e2e-spec.ts` | Histórico de versões: versão automática com intervalo e limite de 50, versões manuais, permissões por papel, restauração com backup e aviso em tempo real, exclusão em cascata |
| `test/ai-analysis.e2e-spec.ts` | Análise do modelo pela IA com a OpenAI simulada: JSON Schema estrito, modelo compacto, validação das ações, erros (sem tabelas, sem chave, falha, recusa, JSON inválido) |
| `src/openai/diagram-analysis.spec.ts` | Compactação do modelo enviado à IA e descarte de ações que citam tabelas/colunas inexistentes |
| `src/diagrams/diagram.service.spec.ts` | Regras de papel e normalização de dados, isoladas do banco |
| `test/perf/realtime-latency.ts` | Gera `reports/perf/realtime-latency.{md,csv,json}` e histogramas |

## Falhas conhecidas documentadas

Testes marcados com `test.failing` descrevem o comportamento **correto** e hoje
falham, porque expõem um problema real ainda não corrigido. Quando o problema
for corrigido, o Jest acusa e o `.failing` deve ser removido.

| Teste | Problema |
|---|---|
| a resposta do cadastro não expõe o hash da senha | `POST /auth/register` devolve o usuário com `password` |
| GET /user/:id exige autenticação | Rota pública que devolve o usuário inteiro, inclusive o hash |
| um usuário não consegue trocar a senha de outro via PUT /user/:id | Rota sem autenticação: qualquer pessoa troca a senha de qualquer conta |
| POST /auth/refresh emite um novo access token | `refresh()` passa o payload do JWT (`sub`) para `login()`, que espera `id`; sempre responde 500 |
| o cadastro valida o formato do e-mail | Não há `ValidationPipe` global, então os decorators dos DTOs não são aplicados |
| um cliente não consegue se passar por outro no evento de cursor | O `userId` enviado pelo cliente sobrescreve o do servidor |
| rebaixar um EDITOR para VIEWER bloqueia as operações já na conexão aberta | O papel é lido só no `join_diagram` |
| um colaborador removido deixa de receber as operações do diagrama | A remoção não tira o socket da sala |
