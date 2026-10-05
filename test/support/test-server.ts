/**
 * Servidor de testes isolado: sobe o backend completo apontando para um
 * MongoDB em memória (nunca para o banco real do .env).
 *
 * Usado pelos testes ponta a ponta (Playwright, no frontend) e pelos testes
 * de desempenho. Uso:
 *
 *   PORT=3101 FRONT_URL=http://localhost:5174 npm run test:server
 */
import { startMemoryDb } from './memory-db';
import { applyTestEnv } from './test-env';

async function main() {
  const port = Number(process.env.PORT ?? 3101);
  const frontUrl = process.env.FRONT_URL || 'http://localhost:5174';

  const db = await startMemoryDb('modeladb_test_server');
  applyTestEnv(db.uri, frontUrl);

  // Imports só depois de configurar o ambiente: os módulos leem process.env
  // no momento em que são carregados.
  /* eslint-disable @typescript-eslint/no-require-imports */
  const { Test } = require('@nestjs/testing');
  const { AppModule } = require('src/app.module');
  const { MailService } = require('src/mail/mail.service');
  const { StorageService } = require('src/storage/storage.service');
  /* eslint-enable @typescript-eslint/no-require-imports */

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(MailService)
    .useValue({
      sendPasswordResetEmail: (email: string, token: string) => {
        console.log(
          `[test-server] e-mail de redefinição para ${email}: ${token}`,
        );
        return Promise.resolve();
      },
    })
    .overrideProvider(StorageService)
    .useValue({
      upload: () => Promise.resolve('http://storage.test/avatar.png'),
    })
    .compile();

  const app = moduleRef.createNestApplication({
    logger: process.env.TEST_SERVER_LOGS ? undefined : ['error'],
  });
  app.enableCors({
    origin: frontUrl,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    allowedHeaders: 'Content-Type, Authorization',
    credentials: true,
  });

  await app.listen(port, '127.0.0.1');
  console.log(`MODELADB_TEST_SERVER_READY http://127.0.0.1:${port}`);

  let stopping = false;
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    await app.close();
    await db.stop();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
