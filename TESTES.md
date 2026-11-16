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
| `npm run perf:realtime` | Latência e vazão do gateway com 2 a 100 clientes, 10 repetições por cenário (`PERF_REPEATS`) com média, desvio padrão, CV e IC 95% | ~8 min |
| `npm run test:server` | Sobe o backend isolado em `:3101` (usado pelo Playwright do frontend) | — |
| `npm run test:memory-db` | Sobe só o MongoDB em memória e imprime a URI; com `TEST_SERVER_DB_URI=<uri>` o `test:server` usa esse banco, que sobrevive a reinícios do servidor (usado pelo experimento de reconexão do frontend) | — |

## O que cada suíte cobre

| Arquivo | Conteúdo |
|---|---|
| `test/auth.e2e-spec.ts` | Cadastro, login, hash bcrypt, tokens inválidos/forjados/expirados, tipos de token (acesso, refresh, redefinição), rotação e logout do refresh, recuperação de senha sem revelar e-mails, perfil só do próprio usuário, chave da OpenAI cifrada, upload de avatar, ValidationPipe |
| `test/diagram-permissions.e2e-spec.ts` | Matriz papel × ação (dono, editor, leitor, sem acesso) × 7 ações = 28 casos |
| `test/diagrams.e2e-spec.ts` | Persistência dos nós/arestas, listagens, convites, troca de papel, remoção, exclusão em cascata |
| `test/realtime.e2e-spec.ts` | Handshake com JWT, entrada na sala, presença, difusão de operações, ordem FIFO, isolamento entre salas, bloqueio do leitor, troca de papel e remoção aplicadas na conexão aberta, cursor sem falsificação, reconexão com reenvio das operações perdidas |
| `test/versions.e2e-spec.ts` | Histórico de versões: versão automática com intervalo e limite de 50, versões manuais, permissões por papel, restauração com backup e aviso em tempo real, exclusão em cascata |
| `test/ai-analysis.e2e-spec.ts` | Análise do modelo pela IA com a OpenAI simulada: JSON Schema estrito, modelo compacto, validação das ações, erros (sem tabelas, sem chave, falha, recusa, JSON inválido) |
| `src/openai/diagram-analysis.spec.ts` | Compactação do modelo enviado à IA e descarte de ações que citam tabelas/colunas inexistentes |
| `src/realtime/operation-log.spec.ts` | Log de operações por diagrama: sequência, época, operações perdidas, limite de tamanho e limpeza de salas ociosas |
| `src/common/secret-box.spec.ts` | Cifragem AES-256-GCM da chave da OpenAI, leitura de valores legados e detecção de adulteração |
| `src/common/image-upload.spec.ts` | Detecção de imagem pela assinatura do arquivo, sem confiar na extensão ou no mimetype |
| `src/diagrams/diagram.service.spec.ts` | Regras de papel e normalização de dados, isoladas do banco |
| `test/perf/realtime-latency.ts` | Gera `reports/perf/realtime-latency.{md,csv,json}` e histogramas |

## Falhas conhecidas documentadas

Testes marcados com `test.failing` descrevem o comportamento **correto** e hoje
falham, porque expõem um problema real ainda não corrigido. Quando o problema
for corrigido, o Jest acusa e o `.failing` deve ser removido.

Nenhuma no momento. As falhas de segurança que estavam registradas aqui foram
corrigidas e os testes correspondentes passaram a ser testes normais.
