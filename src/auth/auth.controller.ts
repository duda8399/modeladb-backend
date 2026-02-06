import { Controller, Post, Body, UseGuards, Request } from '@nestjs/common';
import { AuthService } from './auth.service';
import { JwtRefreshGuard } from './guards/jwt-refresh.guard';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { JwtResetPasswordGuard } from './guards/jwt-reset.guard';

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto.name, dto.email, dto.password);
  }

  @Post('login')
  async login(@Body() dto: LoginDto) {
    const user = await this.authService.validateUser(dto.email, dto.password);
    return this.authService.login(user);
  }

  @UseGuards(JwtRefreshGuard)
  @Post('refresh')
  refresh(@Request() req) {
    return this.authService.refresh(req.user);
  }

  @Post('forgot-password')
  async forgotPassword(@Body('email') email: string) {
    return await this.authService.forgotPassword(email);
  }

  @UseGuards(JwtResetPasswordGuard)
  @Post('reset-password')
  async resetPassword(@Request() req, @Body('password') password: string) {
    return await this.authService.resetPassword(req.user.sub, password);
  }
}
