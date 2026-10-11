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
        type: 'refresh',
      });

      await ctx
        .http()
        .post('/auth/refresh')
        .send({ refreshToken: forged })
        .expect(401);
    });

    it('o login devolve um refresh token', async () => {
      const user = await registerAndLogin(ctx, 'login-refresh');

      expect(user.refreshToken).toEqual(expect.any(String));
      expect(new JwtService().decode(user.refreshToken!)).toEqual(
        expect.objectContaining({ sub: user.id, type: 'refresh' }),
      );
    });

    it('POST /auth/refresh emite um novo par de tokens a partir de um refresh token válido', async () => {
      const user = await registerAndLogin(ctx, 'refresh');

      const res = await ctx
        .http()
        .post('/auth/refresh')
        .send({ refreshToken: user.refreshToken })
        .expect(201);

      expect(res.body.accessToken).toEqual(expect.any(String));
      expect(res.body.refreshToken).toEqual(expect.any(String));
      expect(res.body.refreshToken).not.toBe(user.refreshToken);

      await ctx
        .http()
        .get('/diagram/my-documents')
        .set('Authorization', `Bearer ${res.body.accessToken}`)
        .expect(200);
    });

    it('um refresh token já usado não pode ser reaproveitado (rotação)', async () => {
      const user = await registerAndLogin(ctx, 'rotacao');

      await ctx
        .http()
        .post('/auth/refresh')
        .send({ refreshToken: user.refreshToken })
        .expect(201);

      await ctx
        .http()
        .post('/auth/refresh')
        .send({ refreshToken: user.refreshToken })
        .expect(401);
    });

    it('um access token não serve como refresh token', async () => {
      const user = await registerAndLogin(ctx, 'access-como-refresh');

      await ctx
        .http()
        .post('/auth/refresh')
        .send({ refreshToken: user.token })
        .expect(401);
    });

    it('um refresh token não serve como access token', async () => {
      const user = await registerAndLogin(ctx, 'refresh-como-access');

      await ctx
        .http()
        .get('/diagram/my-documents')
        .set('Authorization', `Bearer ${user.refreshToken}`)
        .expect(401);
    });

    it('um token sem o tipo "access" é rejeitado nas rotas privadas', async () => {
      const user = await registerAndLogin(ctx, 'sem-tipo');
      const legacy = new JwtService({ secret: process.env.JWT_SECRET }).sign({
        sub: user.id,
        email: user.email,
      });

      await ctx
        .http()
        .get('/diagram/my-documents')
        .set('Authorization', `Bearer ${legacy}`)
        .expect(401);
    });

    it('o logout invalida o refresh token', async () => {
      const user = await registerAndLogin(ctx, 'logout');

      await ctx
        .http()
        .post('/auth/logout')
        .send({ refreshToken: user.refreshToken })
        .expect(201);

      await ctx
        .http()
        .post('/auth/refresh')
        .send({ refreshToken: user.refreshToken })
        .expect(401);
    });

    it('sessões em dispositivos diferentes convivem', async () => {
      const user = await registerAndLogin(ctx, 'dois-dispositivos');
      const second = await ctx
        .http()
        .post('/auth/login')
        .send({ email: user.email, password: user.password })
        .expect(201);

      await ctx
        .http()
        .post('/auth/refresh')
        .send({ refreshToken: user.refreshToken })
        .expect(201);
      await ctx
        .http()
        .post('/auth/refresh')
        .send({ refreshToken: second.body.refreshToken })
        .expect(201);
    });

    it('o refresh token é guardado apenas como hash', async () => {
      const user = await registerAndLogin(ctx, 'hash-sessao');
      const sessions = await ctx.app
        .get(PrismaService)
        .refreshSession.findMany({ where: { userId: user.id } });

      expect(sessions).toHaveLength(1);
      expect(sessions[0].tokenHash).not.toBe(user.refreshToken);
      expect(sessions[0].tokenHash).toMatch(/^[0-9a-f]{64}$/);
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

    it('responde igual para e-mail não cadastrado, sem revelar se ele existe', async () => {
      const user = await registerAndLogin(ctx, 'existe');
      ctx.mail.sendPasswordResetEmail.mockClear();

      const missing = await ctx
        .http()
        .post('/auth/forgot-password')
        .send({ email: uniqueEmail('nao-existe') })
        .expect(201);

      expect(ctx.mail.sendPasswordResetEmail).not.toHaveBeenCalled();

      const existing = await ctx
        .http()
        .post('/auth/forgot-password')
        .send({ email: user.email })
        .expect(201);

      expect(missing.body).toEqual(existing.body);
    });

    it('não revela o e-mail mesmo quando o envio falha', async () => {
      const user = await registerAndLogin(ctx, 'smtp-falhou');
      ctx.mail.sendPasswordResetEmail.mockRejectedValueOnce(new Error('SMTP'));

      await ctx
        .http()
        .post('/auth/forgot-password')
        .send({ email: user.email })
        .expect(201);
    });

    it('o token de redefinição só pode ser usado uma vez', async () => {
      const user = await registerAndLogin(ctx, 'reset-unico');
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
        .send({ password: 'primeira-troca' })
        .expect(201);

      await ctx
        .http()
        .post('/auth/reset-password')
        .set('Authorization', `Bearer ${resetToken}`)
        .send({ password: 'segunda-troca' })
        .expect(401);
    });

    it('redefinir a senha encerra as sessões abertas', async () => {
      const user = await registerAndLogin(ctx, 'reset-sessoes');
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
        .send({ password: 'senha-nova-789' })
        .expect(201);

      await ctx
        .http()
        .post('/auth/refresh')
        .send({ refreshToken: user.refreshToken })
        .expect(401);
    });

    it('o token de redefinição não serve como access token', async () => {
      const user = await registerAndLogin(ctx, 'reset-como-access');
      ctx.mail.sendPasswordResetEmail.mockClear();

      await ctx
        .http()
        .post('/auth/forgot-password')
        .send({ email: user.email })
        .expect(201);
      const [, resetToken] = ctx.mail.sendPasswordResetEmail.mock.calls[0];

      await ctx
        .http()
        .get('/diagram/my-documents')
        .set('Authorization', `Bearer ${resetToken}`)
        .expect(401);
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

  describe('perfil do usuário', () => {
    it('a resposta do cadastro não expõe o hash da senha', async () => {
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
      expect(res.body).not.toHaveProperty('openaiToken');
    });

    it('o cadastro com e-mail repetido responde 409', async () => {
      const user = await registerAndLogin(ctx, 'repetido');

      await ctx
        .http()
        .post('/auth/register')
        .send({ name: 'Y', email: user.email, password: 'senha123' })
        .expect(409);
    });

    it('GET /user/:id exige autenticação', async () => {
      const user = await registerAndLogin(ctx, 'perfil-publico');

      await ctx.http().get(`/user/${user.id}`).expect(401);
    });

    it('GET /user/:id de outro usuário é proibido', async () => {
      const a = await registerAndLogin(ctx, 'curioso');
      const b = await registerAndLogin(ctx, 'alvo');

      await ctx
        .http()
        .get(`/user/${b.id}`)
        .set('Authorization', `Bearer ${a.token}`)
        .expect(403);
    });

    it('GET /user/me não expõe senha, sessões nem a chave da OpenAI', async () => {
      const user = await registerAndLogin(ctx, 'me');

      await ctx
        .http()
        .put('/user/me')
        .set('Authorization', `Bearer ${user.token}`)
        .field('openaiToken', 'sk-segredo-abcd')
        .expect(200);

      const res = await ctx
        .http()
        .get('/user/me')
        .set('Authorization', `Bearer ${user.token}`)
        .expect(200);

      expect(res.body).toEqual(
        expect.objectContaining({
          id: user.id,
          email: user.email,
          hasOpenaiToken: true,
          openaiTokenHint: '…abcd',
        }),
      );
      expect(JSON.stringify(res.body)).not.toContain('sk-segredo');
      expect(res.body).not.toHaveProperty('password');
      expect(res.body).not.toHaveProperty('refreshToken');
      expect(res.body).not.toHaveProperty('openaiToken');
    });

    it('a chave da OpenAI é guardada criptografada', async () => {
      const user = await registerAndLogin(ctx, 'cripto');

      await ctx
        .http()
        .put(`/user/${user.id}`)
        .set('Authorization', `Bearer ${user.token}`)
        .field('openaiToken', 'sk-chave-em-claro')
        .expect(200);

      const stored = await ctx.app
        .get(PrismaService)
        .user.findUnique({ where: { id: user.id } });

      expect(stored?.openaiToken).toMatch(/^enc:v1:/);
      expect(stored?.openaiToken).not.toContain('sk-chave-em-claro');
    });

    it('enviar a chave vazia remove a chave da OpenAI', async () => {
      const user = await registerAndLogin(ctx, 'remove-chave');
      const http = () =>
        ctx.http().put('/user/me').set('Authorization', `Bearer ${user.token}`);

      await http().field('openaiToken', 'sk-qualquer').expect(200);
      const res = await http().field('openaiToken', '').expect(200);

      expect(res.body.hasOpenaiToken).toBe(false);
    });

    it('um usuário não consegue trocar a senha de outro via PUT /user/:id', async () => {
      const victim = await registerAndLogin(ctx, 'vitima');
      const attacker = await registerAndLogin(ctx, 'atacante');

      await ctx
        .http()
        .put(`/user/${victim.id}`)
        .set('Authorization', `Bearer ${attacker.token}`)
        .send({ password: 'senha-do-atacante' })
        .expect(403);

      await ctx
        .http()
        .post('/auth/login')
        .send({ email: victim.email, password: 'senha-do-atacante' })
        .expect(401);
    });

    it('PUT /user/:id sem token responde 401', async () => {
      const victim = await registerAndLogin(ctx, 'vitima-anonima');

      await ctx
        .http()
        .put(`/user/${victim.id}`)
        .send({ password: 'senha-anonima' })
        .expect(401);
    });

    it('o upload de avatar recusa arquivos que não são imagem', async () => {
      const user = await registerAndLogin(ctx, 'avatar-html');

      await ctx
        .http()
        .put('/user/me')
        .set('Authorization', `Bearer ${user.token}`)
        .attach('avatar', Buffer.from('<script>alert(1)</script>'), {
          filename: 'foto.png',
          contentType: 'image/png',
        })
        .expect(400);
    });

    it('o upload de avatar recusa arquivos acima de 2 MB', async () => {
      const user = await registerAndLogin(ctx, 'avatar-grande');
      const png = Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        Buffer.alloc(2 * 1024 * 1024 + 1),
      ]);

      await ctx
        .http()
        .put('/user/me')
        .set('Authorization', `Bearer ${user.token}`)
        .attach('avatar', png, { filename: 'grande.png' })
        .expect(413);
    });

    it('o upload de avatar aceita PNG', async () => {
      const user = await registerAndLogin(ctx, 'avatar-ok');
      const png = Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        Buffer.alloc(64),
      ]);

      const res = await ctx
        .http()
        .put('/user/me')
        .set('Authorization', `Bearer ${user.token}`)
        .attach('avatar', png, { filename: 'foto.png' })
        .expect(200);

      expect(res.body.avatarUrl).toEqual(expect.any(String));
    });
  });

  describe('validação de entrada', () => {
    it('o cadastro valida o formato do e-mail', async () => {
      const res = await ctx
        .http()
        .post('/auth/register')
        .send({ name: 'X', email: 'nao-e-um-email', password: '1' });

      expect(res.status).toBe(400);
    });

    it('o cadastro exige senha com no mínimo 6 caracteres', async () => {
      await ctx
        .http()
        .post('/auth/register')
        .send({ name: 'X', email: uniqueEmail('curta'), password: '123' })
        .expect(400);
    });

    it('campos desconhecidos são descartados', async () => {
      const email = uniqueEmail('extra');

      await ctx
        .http()
        .post('/auth/register')
        .send({ name: 'X', email, password: 'senha123', openaiToken: 'sk-x' })
        .expect(201);

      const stored = await ctx.app
        .get(PrismaService)
        .user.findUnique({ where: { email } });

      expect(stored?.openaiToken).toBeNull();
    });

    it('a redefinição de senha valida o tamanho da senha', async () => {
      await ctx
        .http()
        .post('/auth/reset-password')
        .set('Authorization', 'Bearer qualquer')
        .send({ password: '1' })
        .expect(400);
    });
  });
});
