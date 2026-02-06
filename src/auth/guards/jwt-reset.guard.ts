import { Injectable, UnauthorizedException } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";

@Injectable()
export class JwtResetPasswordGuard extends AuthGuard('jwt') {
  handleRequest(err, user) {
    if (err || !user) {
      throw new UnauthorizedException('Token inválido ou expirado');
    }

    if (user.type !== 'password-reset') {
      throw new UnauthorizedException('Token inválido');
    }

    return user;
  }
}
