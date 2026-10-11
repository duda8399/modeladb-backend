import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { io, Socket } from 'socket.io-client';
import { AppModule } from 'src/app.module';
import { MailService } from 'src/mail/mail.service';
import { StorageService } from 'src/storage/storage.service';

export type MailMock = {
  sendPasswordResetEmail: jest.Mock<Promise<void>, [string, string]>;
};

export type TestUser = {
  id: string;
  name: string;
  email: string;
  password: string;
  token: string;
  refreshToken?: string;
};

export type TestContext = {
  app: INestApplication;
  baseUrl: string;
  mail: MailMock;
  http: () => ReturnType<typeof request>;
  close: () => Promise<void>;
};

/**
 * Sobe a aplicação Nest completa (mesmo AppModule de produção) escutando numa
 * porta aleatória, para que HTTP e WebSocket possam ser testados de verdade.
 * Apenas os serviços externos (e-mail e S3) são substituídos por mocks.
 */
export async function createTestApp(): Promise<TestContext> {
  const mail: MailMock = {
    sendPasswordResetEmail: jest.fn().mockResolvedValue(undefined),
  };

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(MailService)
    .useValue(mail)
    .overrideProvider(StorageService)
    .useValue({
      upload: jest.fn().mockResolvedValue('http://storage.test/avatar.png'),
    })
    .compile();

  const app = moduleRef.createNestApplication({ logger: false });
  await app.listen(0, '127.0.0.1');

  const address = app.getHttpServer().address() as { port: number };
  const baseUrl = `http://127.0.0.1:${address.port}`;

  return {
    app,
    baseUrl,
    mail,
    http: () => request(app.getHttpServer()),
    close: () => app.close(),
  };
}

export function uniqueEmail(prefix = 'user') {
  return `${prefix}-${randomUUID().slice(0, 8)}@teste.modeladb`;
}

export async function registerAndLogin(
  ctx: TestContext,
  prefix = 'user',
): Promise<TestUser> {
  const email = uniqueEmail(prefix);
  const password = 'senha-segura-123';
  const name = `Usuário ${prefix}`;

  await ctx
    .http()
    .post('/auth/register')
    .send({ name, email, password })
    .expect(201);

  const login = await ctx
    .http()
    .post('/auth/login')
    .send({ email, password })
    .expect(201);

  return {
    id: login.body.userId,
    name,
    email,
    password,
    token: login.body.accessToken,
    refreshToken: login.body.refreshToken,
  };
}

export async function createDiagram(
  ctx: TestContext,
  owner: TestUser,
  name = 'Diagrama de teste',
): Promise<string> {
  const res = await ctx
    .http()
    .post('/diagram/create')
    .set('Authorization', `Bearer ${owner.token}`)
    .send({ name })
    .expect(201);

  return res.body.id;
}

export async function share(
  ctx: TestContext,
  owner: TestUser,
  diagramId: string,
  collaborator: TestUser,
  role: 'EDITOR' | 'VIEWER',
) {
  await ctx
    .http()
    .post(`/diagram/${diagramId}/collaborators`)
    .set('Authorization', `Bearer ${owner.token}`)
    .send({ email: collaborator.email, role })
    .expect(201);
}

export function auth(user: TestUser) {
  return { Authorization: `Bearer ${user.token}` };
}

// ---------------------------------------------------------------------------
// WebSocket
// ---------------------------------------------------------------------------

export function connectSocket(ctx: TestContext, token?: string): Socket {
  return io(ctx.baseUrl, {
    auth: token ? { token } : {},
    transports: ['websocket'],
    reconnection: false,
    forceNew: true,
  });
}

/** Resolve com o próximo evento `event` recebido, ou rejeita após `timeoutMs`. */
export function nextEvent<T = any>(
  socket: Socket,
  event: string,
  timeoutMs = 2000,
  predicate: (payload: T) => boolean = () => true,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`Timeout esperando o evento "${event}"`));
    }, timeoutMs);

    const handler = (payload: T) => {
      if (!predicate(payload)) return;
      clearTimeout(timer);
      socket.off(event, handler);
      resolve(payload);
    };

    socket.on(event, handler);
  });
}

/** Garante que `event` NÃO chega dentro da janela de tempo informada. */
export function expectNoEvent(
  socket: Socket,
  event: string,
  windowMs = 400,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const handler = (payload: unknown) => {
      clearTimeout(timer);
      socket.off(event, handler);
      reject(
        new Error(`Evento "${event}" inesperado: ${JSON.stringify(payload)}`),
      );
    };

    const timer = setTimeout(() => {
      socket.off(event, handler);
      resolve();
    }, windowMs);

    socket.on(event, handler);
  });
}

/** Conecta e entra na sala do diagrama; resolve com a lista ONLINE_USERS. */
export async function joinDiagram(
  ctx: TestContext,
  user: TestUser,
  diagramId: string,
): Promise<{
  socket: Socket;
  onlineUsers: { userId: string; email?: string }[];
}> {
  const socket = connectSocket(ctx, user.token);
  await nextEvent(socket, 'connect');

  const presence = nextEvent<{ type: string; users: any[] }>(
    socket,
    'presence',
    2000,
    (p) => p.type === 'ONLINE_USERS',
  );
  socket.emit('join_diagram', { diagramId });

  const { users } = await presence;
  return { socket, onlineUsers: users };
}
