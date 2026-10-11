import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { User } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { createHash, randomUUID } from 'crypto';
import { PrismaService } from 'src/database/prisma.service';
import { MailService } from 'src/mail/mail.service';
import { UserService } from 'src/users/user.service';
import {
  ACCESS_TOKEN_TTL,
  REFRESH_TOKEN_TTL_DAYS,
  RESET_TOKEN_TTL,
  refreshTokenSecret,
  resetTokenSecret,
} from './jwt-secrets';
import { RefreshTokenUser } from './jwt-refresh.strategy';

const FORGOT_PASSWORD_MESSAGE =
  'Se o e-mail estiver cadastrado, você receberá um link para redefinir a senha.';

function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private userService: UserService,
    private jwtService: JwtService,
    private mailService: MailService,
    private prisma: PrismaService,
  ) {}

  async register(name: string, email: string, password: string) {
    const hash = await bcrypt.hash(password, 10);
    const user = await this.userService.create(name, email, hash);
    return this.userService.toPublic(user);
  }

  async validateUser(email: string, password: string) {
    const user = await this.userService.findByEmail(email);
    if (!user) throw new UnauthorizedException();

    const match = await bcrypt.compare(password, user.password);
    if (!match) throw new UnauthorizedException();

    return user;
  }

  async login(user: User) {
    await this.prisma.refreshSession.deleteMany({
      where: { userId: user.id, expiresAt: { lt: new Date() } },
    });

    const tokens = await this.issueTokens(user);

    return {
      userId: user.id,
      avatarUrl: user.avatarUrl,
      ...tokens,
    };
  }

  async refresh(payload: RefreshTokenUser) {
    const { count } = await this.prisma.refreshSession.deleteMany({
      where: {
        tokenHash: hashToken(payload.refreshToken),
        userId: payload.sub,
        expiresAt: { gt: new Date() },
      },
    });

    if (count !== 1) {
      throw new UnauthorizedException('Sessão expirada. Faça login novamente.');
    }

    const user = await this.userService.findById(payload.sub);

    if (!user) {
      throw new UnauthorizedException();
    }

    return { userId: user.id, ...(await this.issueTokens(user)) };
  }

  async logout(refreshToken?: string) {
    if (refreshToken) {
      await this.prisma.refreshSession.deleteMany({
        where: { tokenHash: hashToken(refreshToken) },
      });
    }

    return { message: 'Sessão encerrada.' };
  }

  async forgotPassword(email: string) {
    const user = await this.userService.findByEmail(email);

    if (!user) {
      return { message: FORGOT_PASSWORD_MESSAGE };
    }

    const token = this.jwtService.sign(
      { sub: user.id, email: user.email, type: 'password-reset' },
      { secret: resetTokenSecret(user.password), expiresIn: RESET_TOKEN_TTL },
    );

    try {
      await this.mailService.sendPasswordResetEmail(user.email, token);
    } catch (error) {
      this.logger.error(
        `Falha ao enviar e-mail de recuperação: ${(error as Error)?.message}`,
      );
    }

    return { message: FORGOT_PASSWORD_MESSAGE };
  }

  async resetPassword(token: string | undefined, password: string) {
    const invalid = new UnauthorizedException('Token inválido ou expirado');

    if (!token) throw invalid;

    const decoded = this.jwtService.decode<{ sub?: string; type?: string }>(
      token,
    );

    if (!decoded?.sub || decoded.type !== 'password-reset') throw invalid;

    const user = await this.userService.findById(decoded.sub);

    if (!user) throw invalid;

    try {
      await this.jwtService.verifyAsync(token, {
        secret: resetTokenSecret(user.password),
      });
    } catch {
      throw invalid;
    }

    const hash = await bcrypt.hash(password, 10);

    await this.userService.updatePassword(user.id, hash);
    await this.userService.revokeAllSessions(user.id);

    return {
      message: 'Senha alterada com sucesso',
    };
  }

  private async issueTokens(user: User) {
    const accessToken = this.jwtService.sign(
      { sub: user.id, email: user.email, type: 'access' },
      { expiresIn: ACCESS_TOKEN_TTL },
    );

    const refreshToken = this.jwtService.sign(
      { sub: user.id, email: user.email, type: 'refresh', jti: randomUUID() },
      { secret: refreshTokenSecret(), expiresIn: `${REFRESH_TOKEN_TTL_DAYS}d` },
    );

    await this.prisma.refreshSession.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(refreshToken),
        expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * 86_400_000),
      },
    });

    return { accessToken, refreshToken };
  }
}
