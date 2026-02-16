import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/database/prisma.service';
import { DiagramDto } from './dto/diagram.dto';
import { UserService } from 'src/users/user.service';

@Injectable()
export class DiagramService {
  constructor(
    private prisma: PrismaService,
    private userService: UserService
  ) {}

  async create(dto: DiagramDto) {
    const user = await this.userService.findById(dto.userId);

    if(!user) {
        throw new NotFoundException('Usuário não encontrado.');
    }

    return this.prisma.diagram.create({
      data: { name: dto.name, userId: user.id },
    });
  }

  async update(id: string, dto: DiagramDto) {
    
  }

  async findById(id: string) {
    return this.prisma.diagram.findUnique({
      where: { id },
    });
  }
}
