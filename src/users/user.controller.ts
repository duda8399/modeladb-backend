import {
  Controller,
  Get,
  Param,
  Put,
  UseInterceptors,
  Body,
  UploadedFile,
  UseGuards,
  Request,
  ForbiddenException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { UserService } from './user.service';
import { UserDto } from './dto/user.dto';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { imageUploadOptions, MAX_AVATAR_BYTES } from 'src/common/image-upload';

type AuthRequest = { user: { sub: string } };

@UseGuards(JwtAuthGuard)
@Controller('user')
export class UserController {
  constructor(private userService: UserService) {}

  @Get('me')
  findMe(@Request() req: AuthRequest) {
    return this.userService.findPublicById(req.user.sub);
  }

  @Put('me')
  @UseInterceptors(
    FileInterceptor('avatar', imageUploadOptions(MAX_AVATAR_BYTES)),
  )
  async updateMe(
    @Request() req: AuthRequest,
    @Body() dto: UserDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    const user = await this.userService.update(req.user.sub, dto, file);
    return this.userService.toPublic(user);
  }

  @Get(':id')
  findUser(@Param('id') id: string, @Request() req: AuthRequest) {
    this.assertSelf(id, req);
    return this.userService.findPublicById(id);
  }

  @Put(':id')
  @UseInterceptors(
    FileInterceptor('avatar', imageUploadOptions(MAX_AVATAR_BYTES)),
  )
  async updateUser(
    @Param('id') id: string,
    @Request() req: AuthRequest,
    @Body() dto: UserDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    this.assertSelf(id, req);
    const user = await this.userService.update(id, dto, file);
    return this.userService.toPublic(user);
  }

  private assertSelf(id: string, req: AuthRequest) {
    if (id !== req.user.sub) {
      throw new ForbiddenException(
        'Você só pode acessar o seu próprio perfil.',
      );
    }
  }
}
