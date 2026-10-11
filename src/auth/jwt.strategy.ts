import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, ExtractJwt } from 'passport-jwt';
import { AccessTokenPayload, accessTokenSecret } from './jwt-secrets';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: accessTokenSecret(),
    });
  }

  validate(payload: Partial<AccessTokenPayload>): AccessTokenPayload {
    if (payload?.type !== 'access' || !payload.sub) {
      throw new UnauthorizedException();
    }

    return payload as AccessTokenPayload;
  }
}
