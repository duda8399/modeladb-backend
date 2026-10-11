import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Request } from 'express';
import { Strategy, ExtractJwt } from 'passport-jwt';
import { refreshTokenSecret } from './jwt-secrets';

export type RefreshTokenUser = {
  sub: string;
  email: string;
  refreshToken: string;
};

@Injectable()
export class JwtRefreshStrategy extends PassportStrategy(
  Strategy,
  'jwt-refresh',
) {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromBodyField('refreshToken'),
      secretOrKey: refreshTokenSecret(),
      passReqToCallback: true,
    });
  }

  validate(
    req: Request,
    payload: { sub?: string; email?: string; type?: string },
  ): RefreshTokenUser {
    if (payload?.type !== 'refresh' || !payload.sub) {
      throw new UnauthorizedException();
    }

    return {
      sub: payload.sub,
      email: payload.email ?? '',
      refreshToken: (req.body as { refreshToken: string }).refreshToken,
    };
  }
}
