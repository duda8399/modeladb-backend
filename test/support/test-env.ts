import { assertLocalDatabaseUrl } from './memory-db';

/**
 * Variáveis de ambiente usadas por qualquer processo de teste (Jest, servidor
 * de testes do Playwright, scripts de desempenho).
 *
 * Precisa rodar ANTES de importar o AppModule: vários módulos leem
 * process.env no momento do import (ex.: segredo do JWT, CORS do gateway).
 * Como o ConfigModule/dotenv nunca sobrescreve variáveis já definidas, os
 * valores abaixo prevalecem sobre o .env do projeto.
 */
export function applyTestEnv(
  databaseUrl: string,
  frontUrl = 'http://localhost:5173',
) {
  assertLocalDatabaseUrl(databaseUrl);

  process.env.DATABASE_URL = databaseUrl;
  process.env.JWT_SECRET = 'modeladb-test-secret';
  process.env.FRONT_URL = frontUrl;
  process.env.APP_URL = 'http://localhost:3001';

  // Serviços externos ficam desabilitados de propósito: string vazia impede
  // que o dotenv preencha com as credenciais reais do .env.
  for (const key of [
    'MAIL_HOST',
    'MAIL_PORT',
    'MAIL_USER',
    'MAIL_PASS',
    'MAIL_FROM',
  ]) {
    process.env[key] = '';
  }

  // O S3Client exige uma região já no construtor; credenciais fictícias
  // garantem que qualquer upload acidental falhe em vez de usar a conta real.
  process.env.AWS_REGION = 'us-east-1';
  process.env.AWS_BUCKET_NAME = 'modeladb-test-inexistente';
  process.env.AWS_ACCESS_KEY_ID = 'test';
  process.env.AWS_SECRET_ACCESS_KEY = 'test';
}
