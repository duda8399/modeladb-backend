import { startMemoryDb } from './memory-db';

async function main() {
  const db = await startMemoryDb(
    process.env.MEMORY_DB_NAME || 'modeladb_test_server',
  );
  console.log(`MODELADB_MEMORY_DB_READY ${db.uri}`);

  let stopping = false;
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
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
