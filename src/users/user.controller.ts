import {
  Controller,
  Get,
  Param,
  HttpException,
  HttpStatus,
  Put,
  UseInterceptors,
  Body,
  UploadedFile,
} from '@nestjs/common';
import { UserService } from './user.service';
import { UserDto } from './dto/user.dto';
import { FileInterceptor } from '@nestjs/platform-express';

@Controller('user')
export class UserController {
  constructor(private userService: UserService) {}

  @Get(':id')
  async findUser(@Param('id') id: string) {
    try {
      return await this.userService.findById(id);
    } catch (error) {
      throw new HttpException(
        error?.message || 'Usuário não encontrado',
        HttpStatus.NOT_FOUND,
      );
    }
  }

  @Put(':id')
  @UseInterceptors(FileInterceptor('avatar'))
  async updateUser(
    @Param('id') id: string,
    @Body() dto: UserDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    try {
      return await this.userService.update(id, dto, file);
    } catch (error) {
      throw new HttpException(
        error?.message || 'Não foi possível atualizar os dados do usuário.',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
