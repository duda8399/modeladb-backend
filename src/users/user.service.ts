import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/database/prisma.service';
import { UserDto } from './dto/user.dto';

@Injectable()
export class UserService {
  constructor(private prisma: PrismaService) {}

  async create(name: string, email: string, password: string) {
    return this.prisma.user.create({
      data: { name, email, password },
    });
  }

  async update(id: string, dto: UserDto) {
    return this.prisma.user.update({
      where: { id },
      data: { name: dto.name, password: dto.newPassword, avatarUrl: dto.avatarUrl },
    });
  }

  async findByEmail(email: string) {
    return this.prisma.user.findUnique({
      where: { email },
    });
  }

  async findById(id: string) {
    return this.prisma.user.findUnique({
      where: { id },
    });
  }

  async updateRefreshToken(userId: string, refreshToken: string) {
    return this.prisma.user.update({
      where: { id: userId },
      data: { refreshToken },
    });
  }

  async updatePassword(userId: string, password: string) {
    return this.prisma.user.update({
      where: { id: userId },
      data: { password },
    });
  }
}
