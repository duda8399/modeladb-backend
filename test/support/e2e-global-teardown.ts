import type { MemoryDb } from './memory-db';

export default async function globalTeardown() {
  await (globalThis as { __MEMORY_DB__?: MemoryDb }).__MEMORY_DB__?.stop();
}
