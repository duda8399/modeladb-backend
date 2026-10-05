import { applyTestEnv } from './test-env';

applyTestEnv(process.env.E2E_DATABASE_URL as string);
