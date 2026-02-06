import { Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { User } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { MailService } from 'src/mail/mail.service';
import { UserService } from 'src/users/user.service';

@Injectable()
export class AuthService {
  constructor(
    private userService: UserService,
    private jwtService: JwtService,
    private mailService: MailService
  ) {}

  async register(name: string, email: string, password: string) {
    const hash = await bcrypt.hash(password, 10);
    return this.userService.create(name, email, hash);
  }

  async validateUser(email: string, password: string) {
    const user = await this.userService.findByEmail(email);
    if (!user) throw new UnauthorizedException();

    const match = await bcrypt.compare(password, user.password);
    if (!match) throw new UnauthorizedException();

    return user;
  }

  async login(user: User) {
    const payload = { sub: user.id, email: user.email };

    const accessToken = this.jwtService.sign(payload, {
      expiresIn: '15m',
    });

    const refreshToken = this.jwtService.sign(payload, {
      expiresIn: '1d',
    });

    await this.userService.updateRefreshToken(user.id, refreshToken);

    return { accessToken, refreshToken };
  }

  async refresh(user: any) {
    return this.login(user);
  }

  async forgotPassword(email: string) {
    const user = await this.userService.findByEmail(email);

    if (!user) {
      throw new NotFoundException('Usuário não encontrado.');
    }

    const payload = {
      sub: user.id,
      email: user.email,
      type: 'password-reset',
    };

    const token = this.jwtService.sign(payload, {
      expiresIn: '15m',
    });

    await this.mailService.sendPasswordResetEmail(user.email, token);
  }

  async resetPassword(user: User, password: string) {
    const hash = await bcrypt.hash(password, 10);

    await this.userService.updatePassword(user.id, hash);

    return {
      message: 'Senha alterada com sucesso',
    };
  }
}
