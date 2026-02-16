import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/database/prisma.service';
import { UserDto } from './dto/user.dto';
import * as bcrypt from 'bcrypt';
import { StorageService } from 'src/storage/storage.service';

@Injectable()
export class UserService {
  constructor(
    private prisma: PrismaService,
    private storageService: StorageService
  ) {}

  async create(name: string, email: string, password: string) {
    return this.prisma.user.create({
      data: { name, email, password },
    });
  }

  async update(id: string, dto: UserDto, file?: Express.Multer.File) {
    const data: any = {};

    if (dto.name) data.name = dto.name;

    if (dto.password) {
      const hash = await bcrypt.hash(dto.password, 10);
      data.password = hash;
    }

    if (file) {
      const url = await this.storageService.upload(file, id);
      data.avatarUrl = url;
    }

    return this.prisma.user.update({
      where: { id },
      data: data,
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
