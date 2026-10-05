import { JwtService } from '@nestjs/jwt';
import { PrismaService } from 'src/database/prisma.service';
import {
  TestContext,
  createTestApp,
  registerAndLogin,
  uniqueEmail,
} from './support/test-app';

/**
 * Item 3 — Integração da API: autenticação.
 * Cobre cadastro, login, refresh token, recuperação de senha e a proteção das
 * rotas privadas contra tokens ausentes, malformados, forjados ou expirados.
 */
describe('Autenticação (integração)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await ctx.close();
  });

  describe('cadastro e login', () => {
    it('cadastra um usuário e permite login com as mesmas credenciais', async () => {
      const email = uniqueEmail('cadastro');

      await ctx
        .http()
        .post('/auth/register')
        .send({ name: 'Ana', email, password: 'senha123' })
        .expect(201);

      const login = await ctx
        .http()
        .post('/auth/login')
        .send({ email, password: 'senha123' })
        .expect(201);

      expect(login.body).toEqual(
        expect.objectContaining({
          userId: expect.any(String),
          accessToken: expect.any(String),
        }),
      );
    });

    it('o access token carrega o id e o e-mail do usuário', async () => {
      const user = await registerAndLogin(ctx, 'payload');
      const payload = new JwtService().decode(user.token);

      expect(payload).toEqual(
        expect.objectContaining({ sub: user.id, email: user.email }),
      );
    });

    it('a senha é armazenada como hash bcrypt, nunca em texto puro', async () => {
      const user = await registerAndLogin(ctx, 'hash');
      const stored = await ctx.app
        .get(PrismaService)
        .user.findUnique({ where: { id: user.id } });

      expect(stored?.password).not.toBe(user.password);
      expect(stored?.password).toMatch(/^\$2[aby]\$10\$/);
    });

    it('rejeita cadastro com e-mail já existente', async () => {
      const user = await registerAndLogin(ctx, 'duplicado');

      const res = await ctx
        .http()
        .post('/auth/register')
        .send({ name: 'Outro', email: user.email, password: 'outra-senha' });

      expect(res.status).toBeGreaterThanOrEqual(400);
    });

    it('rejeita login com senha incorreta (401)', async () => {
      const user = await registerAndLogin(ctx, 'senha-errada');

      await ctx
        .http()
        .post('/auth/login')
        .send({ email: user.email, password: 'senha-incorreta' })
        .expect(401);
    });

    it('rejeita login de e-mail inexistente (401)', async () => {
      await ctx
        .http()
        .post('/auth/login')
        .send({ email: uniqueEmail('fantasma'), password: 'qualquer' })
        .expect(401);
    });
  });

  describe('proteção das rotas privadas', () => {
    const protectedRoute = '/diagram/my-documents';

    it('aceita um token válido', async () => {
      const user = await registerAndLogin(ctx, 'token-ok');

      await ctx
        .http()
        .get(protectedRoute)
        .set('Authorization', `Bearer ${user.token}`)
        .expect(200);
    });

    it('rejeita requisição sem token (401)', async () => {
      await ctx.http().get(protectedRoute).expect(401);
    });

    it('rejeita token malformado (401)', async () => {
      await ctx
        .http()
        .get(protectedRoute)
        .set('Authorization', 'Bearer isto-nao-e-um-jwt')
        .expect(401);
    });

    it('rejeita token assinado com outro segredo (401)', async () => {
      const user = await registerAndLogin(ctx, 'forjado');
      const forged = new JwtService({ secret: 'segredo-do-atacante' }).sign({
        sub: user.id,
        email: user.email,
      });

      await ctx
        .http()
        .get(protectedRoute)
        .set('Authorization', `Bearer ${forged}`)
        .expect(401);
    });

    it('rejeita token expirado (401)', async () => {
      const user = await registerAndLogin(ctx, 'expirado');
      const expired = new JwtService({ secret: process.env.JWT_SECRET }).sign(
        { sub: user.id, email: user.email },
        { expiresIn: -10 },
      );

      await ctx
        .http()
        .get(protectedRoute)
        .set('Authorization', `Bearer ${expired}`)
        .expect(401);
    });
  });

  describe('refresh token', () => {
    it('rejeita refresh sem token (401)', async () => {
      await ctx.http().post('/auth/refresh').send({}).expect(401);
    });

    it('rejeita refresh token assinado com outro segredo (401)', async () => {
      const forged = new JwtService({ secret: 'outro-segredo' }).sign({
        sub: 'qualquer',
      });

      await ctx
        .http()
        .post('/auth/refresh')
        .send({ refreshToken: forged })
        .expect(401);
    });
  });

  describe('recuperação de senha', () => {
    it('envia e-mail com token de redefinição para usuário existente', async () => {
      const user = await registerAndLogin(ctx, 'esqueci');
      ctx.mail.sendPasswordResetEmail.mockClear();

      await ctx
        .http()
        .post('/auth/forgot-password')
        .send({ email: user.email })
        .expect(201);

      expect(ctx.mail.sendPasswordResetEmail).toHaveBeenCalledTimes(1);
      const [to, token] = ctx.mail.sendPasswordResetEmail.mock.calls[0];
      expect(to).toBe(user.email);
      expect(new JwtService().decode(token)).toEqual(
        expect.objectContaining({ sub: user.id, type: 'password-reset' }),
      );
    });

    it('retorna 404 para e-mail não cadastrado e não envia e-mail', async () => {
      ctx.mail.sendPasswordResetEmail.mockClear();

      await ctx
        .http()
        .post('/auth/forgot-password')
        .send({ email: uniqueEmail('nao-existe') })
        .expect(404);

      expect(ctx.mail.sendPasswordResetEmail).not.toHaveBeenCalled();
    });

    it('redefine a senha com o token recebido por e-mail', async () => {
      const user = await registerAndLogin(ctx, 'reset');
      ctx.mail.sendPasswordResetEmail.mockClear();

      await ctx
        .http()
        .post('/auth/forgot-password')
        .send({ email: user.email })
        .expect(201);
      const [, resetToken] = ctx.mail.sendPasswordResetEmail.mock.calls[0];

      await ctx
        .http()
        .post('/auth/reset-password')
        .set('Authorization', `Bearer ${resetToken}`)
        .send({ password: 'nova-senha-456' })
        .expect(201);

      await ctx
        .http()
        .post('/auth/login')
        .send({ email: user.email, password: user.password })
        .expect(401);

      await ctx
        .http()
        .post('/auth/login')
        .send({ email: user.email, password: 'nova-senha-456' })
        .expect(201);
    });

    it('não aceita um access token comum para redefinir a senha (401)', async () => {
      const user = await registerAndLogin(ctx, 'reset-indevido');

      await ctx
        .http()
        .post('/auth/reset-password')
        .set('Authorization', `Bearer ${user.token}`)
        .send({ password: 'tentativa' })
        .expect(401);
    });
  });

  /**
   * Vulnerabilidades conhecidas, documentadas como `test.failing`: o teste
   * descreve o comportamento CORRETO e hoje falha. Quando a falha for
   * corrigida, o Jest acusa e o `.failing` deve ser removido.
   */
  describe('vulnerabilidades conhecidas', () => {
    test.failing(
      'a resposta do cadastro não expõe o hash da senha',
      async () => {
        const res = await ctx
          .http()
          .post('/auth/register')
          .send({
            name: 'X',
            email: uniqueEmail('exposto'),
            password: 'senha123',
          })
          .expect(201);

        expect(res.body).not.toHaveProperty('password');
      },
    );

    test.failing('GET /user/:id exige autenticação', async () => {
      const user = await registerAndLogin(ctx, 'perfil-publico');

      await ctx.http().get(`/user/${user.id}`).expect(401);
    });

    test.failing(
      'um usuário não consegue trocar a senha de outro via PUT /user/:id',
      async () => {
        const victim = await registerAndLogin(ctx, 'vitima');
        const attacker = await registerAndLogin(ctx, 'atacante');

        await ctx
          .http()
          .put(`/user/${victim.id}`)
          .set('Authorization', `Bearer ${attacker.token}`)
          .send({ password: 'senha-do-atacante' });

        await ctx
          .http()
          .post('/auth/login')
          .send({ email: victim.email, password: 'senha-do-atacante' })
          .expect(401);
      },
    );

    // Defeito: refresh() repassa o payload do JWT (que tem `sub`, não `id`)
    // para login(), que então tenta gravar o token num usuário `undefined`.
    test.failing(
      'POST /auth/refresh emite um novo access token a partir de um refresh token válido',
      async () => {
        const user = await registerAndLogin(ctx, 'refresh');
        const refreshToken = new JwtService({
          secret: process.env.JWT_SECRET,
        }).sign({ sub: user.id, email: user.email }, { expiresIn: '7d' });

        const res = await ctx
          .http()
          .post('/auth/refresh')
          .send({ refreshToken })
          .expect(201);

        expect(res.body.accessToken).toEqual(expect.any(String));
      },
    );

    test.failing('o cadastro valida o formato do e-mail', async () => {
      const res = await ctx
        .http()
        .post('/auth/register')
        .send({ name: 'X', email: 'nao-e-um-email', password: '1' });

      expect(res.status).toBe(400);
    });
  });
});
