import { Controller, Get, Param, HttpException, HttpStatus, Put } from '@nestjs/common';
import { UserService } from './user.service';
import { UserDto } from './dto/user.dto';

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
  async updateUser(@Param('id') id: string, dto: UserDto) {
    try {
      return await this.userService.update(id, dto);
    } catch (error) {
      throw new HttpException(
        error?.message || 'Não foi possível atualizar os dados do usuário.',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
