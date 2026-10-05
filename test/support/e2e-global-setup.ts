import { startMemoryDb } from './memory-db';

/**
 * Executado uma única vez antes de toda a suíte de integração: sobe o
 * MongoDB em memória e publica a URI para os arquivos de teste.
 */
export default async function globalSetup() {
  const db = await startMemoryDb('modeladb_e2e');
  process.env.E2E_DATABASE_URL = db.uri;
  (globalThis as { __MEMORY_DB__?: typeof db }).__MEMORY_DB__ = db;
}
