# ModelaDB – Backend

API REST e *gateway* de tempo real do **ModelaDB**, plataforma web para a modelagem
colaborativa de bancos de dados relacionais com apoio de IA generativa.

Desenvolvido como Trabalho de Conclusão de Curso de Maria Eduarda Leal Silva
(IFMG – Campus Formiga, 2026).

- Frontend: https://github.com/duda8399/modeladb-frontend
- Aplicação publicada: https://modeladb-frontend.onrender.com
- **Versão avaliada no TCC: tag [`v1.0.0`](https://github.com/duda8399/modeladb-backend/releases/tag/v1.0.0)**

## Tecnologias

NestJS 11, Socket.IO 4.8, Prisma 6.13 sobre MongoDB, Passport/JWT, bcrypt,
SDK da OpenAI, AWS SDK (S3) e Nodemailer. Node.js 20.19.6 (ver `.nvmrc`).

## Executar a aplicação

```bash
git clone https://github.com/duda8399/modeladb-backend.git
cd modeladb-backend
git checkout v1.0.0        # versão avaliada no TCC
nvm use                    # Node 20.19.6
npm install
cp .env.example .env       # preencha as variáveis abaixo
npx prisma generate
npm run start:dev          # API em http://localhost:3001
```

### Variáveis de ambiente

| Variável | Uso |
|---|---|
| `DATABASE_URL` | String de conexão do MongoDB (Atlas ou local, com *replica set*) |
| `JWT_SECRET`, `JWT_REFRESH_SECRET`, `JWT_RESET_SECRET` | Segredos dos tokens de acesso, de renovação e de redefinição de senha |
| `ENCRYPTION_KEY` | Chave usada para cifrar (AES-256-GCM) as chaves da OpenAI dos usuários |
| `OPENAI_MODEL` | Modelo usado pela IA (opcional; padrão `gpt-4o-mini`) |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `AWS_BUCKET_NAME` | Armazenamento das fotos de perfil no Amazon S3 |
| `MAIL_HOST`, `MAIL_PORT`, `MAIL_USER`, `MAIL_PASS`, `MAIL_FROM` | Servidor SMTP para os e-mails de recuperação de senha |
| `FRONT_URL`, `APP_URL` | Endereços do frontend e da API |
| `PORT` | Porta da API (opcional; padrão 3001) |
| `AUTO_VERSION_INTERVAL_MINUTES` | Intervalo entre versões automáticas, em minutos (opcional; padrão 10) |

A chave da OpenAI não é configurada no servidor: cada usuário informa a sua
na tela de perfil.

## Reproduzir os testes e medições do TCC (Capítulo 5)

Os testes **não precisam de nenhum serviço externo**: sobem um MongoDB em memória
(`mongodb-memory-server`) e substituem e-mail, S3 e OpenAI por dublês. Não é
necessário preencher o `.env` para executá-los.

| Item do TCC | Comando | Saída |
|---|---|---|
| Testes unitários do backend | `npm test` | terminal |
| Testes de integração (API REST e gateway Socket.IO) | `npm run test:e2e` | terminal |
| Latência e vazão do gateway com 2 a 100 clientes | `npm run perf:realtime` | `reports/perf/realtime-latency.{md,csv,json}`, `realtime-latency-repeticoes.csv` e histogramas |

Os testes ponta a ponta, de compatibilidade do SQL e de latência percebida são
executados a partir do repositório do frontend (ver o README de lá). Eles usam
`npm run test:server`, que sobe este backend isolado na porta 3101.

A descrição de cada suíte está em [`TESTES.md`](TESTES.md).

As medições do TCC foram feitas em um Intel Core i5-1345U (12 núcleos lógicos),
31 GB de RAM e Node.js 20.19.6, com servidor e clientes na mesma máquina.
Valores absolutos variam conforme o hardware.

## Licença

MIT – ver [`LICENSE`](LICENSE).
