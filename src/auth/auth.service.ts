import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { UserService } from 'src/users/user.service';

@Injectable()
export class AuthService {
  constructor(
    private userService: UserService,
    private jwtService: JwtService,
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

  async login(user: any) {
    const payload = { sub: user.id, email: user.email };

    const accessToken = this.jwtService.sign(payload, {
      expiresIn: '15m',
    });

    const refreshToken = this.jwtService.sign(payload, {
      expiresIn: '7d',
    });

    await this.userService.updateRefreshToken(user.id, refreshToken);

    return { accessToken, refreshToken };
  }

  async refresh(user: any) {
    return this.login(user);
  }
}
