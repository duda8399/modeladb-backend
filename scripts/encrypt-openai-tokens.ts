import { existsSync } from 'fs';
import { PrismaClient } from '@prisma/client';
import { encryptSecret, isEncrypted } from 'src/common/secret-box';

async function main() {
  if (existsSync('.env')) process.loadEnvFile('.env');

  const prisma = new PrismaClient();

  try {
    const users = await prisma.user.findMany({
      where: { openaiToken: { not: null } },
      select: { id: true, openaiToken: true },
    });

    const pending = users.filter(
      (user) => user.openaiToken && !isEncrypted(user.openaiToken),
    );

    for (const user of pending) {
      await prisma.user.update({
        where: { id: user.id },
        data: { openaiToken: encryptSecret(user.openaiToken as string) },
      });
    }

    console.log(
      `${pending.length} de ${users.length} chaves da OpenAI foram criptografadas.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

void main();
