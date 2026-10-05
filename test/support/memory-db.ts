import { execFileSync } from 'child_process';
import { copyFileSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

const BACKEND_ROOT = resolve(__dirname, '..', '..');

/**
 * Garante que nenhum teste rode contra um banco remoto (ex.: o Atlas de
 * desenvolvimento). Só aceitamos URIs apontando para a máquina local.
 */
export function assertLocalDatabaseUrl(url: string | undefined) {
  if (!url || !/^mongodb:\/\/(127\.0\.0\.1|localhost)[:/]/.test(url)) {
    throw new Error(
      `DATABASE_URL de teste precisa apontar para um MongoDB local, recebido: ${
        url ? url.replace(/\/\/[^@]*@/, '//***@') : '(vazio)'
      }`,
    );
  }
}

/**
 * Aplica o schema do Prisma (coleções + índices únicos) no banco em memória.
 *
 * O comando roda num diretório temporário contendo apenas uma cópia do
 * schema.prisma, para que o Prisma CLI nunca encontre o .env do projeto e
 * acabe usando a DATABASE_URL real.
 */
export function pushPrismaSchema(databaseUrl: string) {
  assertLocalDatabaseUrl(databaseUrl);

  const workDir = mkdtempSync(join(tmpdir(), 'modeladb-prisma-'));
  const schemaPath = join(workDir, 'schema.prisma');
  copyFileSync(join(BACKEND_ROOT, 'prisma', 'schema.prisma'), schemaPath);

  try {
    const output = execFileSync(
      process.execPath,
      [
        require.resolve('prisma/build/index.js', { paths: [BACKEND_ROOT] }),
        'db',
        'push',
        '--skip-generate',
        `--schema=${schemaPath}`,
      ],
      {
        cwd: workDir,
        env: { ...process.env, DATABASE_URL: databaseUrl },
        stdio: 'pipe',
        encoding: 'utf8',
      },
    );

    if (!/127\.0\.0\.1|localhost/.test(output)) {
      throw new Error(`prisma db push não confirmou banco local:\n${output}`);
    }
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

export type MemoryDb = {
  uri: string;
  stop: () => Promise<void>;
};

/**
 * Sobe um MongoDB em memória como replica set de 1 nó (o Prisma exige
 * replica set para escritas no MongoDB) e aplica o schema.
 */
export async function startMemoryDb(
  dbName = 'modeladb_test',
): Promise<MemoryDb> {
  const replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: 'wiredTiger' },
  });

  const uri = replSet.getUri(dbName);
  pushPrismaSchema(uri);

  return {
    uri,
    stop: async () => {
      await replSet.stop();
    },
  };
}
