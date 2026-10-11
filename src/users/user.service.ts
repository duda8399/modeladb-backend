import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, User } from '@prisma/client';
import { PrismaService } from 'src/database/prisma.service';
import { UserDto } from './dto/user.dto';
import * as bcrypt from 'bcrypt';
import { StorageService } from 'src/storage/storage.service';
import {
  decryptSecret,
  encryptSecret,
  isEncrypted,
} from 'src/common/secret-box';
import { sanitizeImage } from 'src/common/image-upload';

export type PublicUser = {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  hasOpenaiToken: boolean;
  openaiTokenHint: string | null;
  createdAt: Date;
  updatedAt: Date;
};

@Injectable()
export class UserService {
  constructor(
    private prisma: PrismaService,
    private storageService: StorageService,
  ) {}

  toPublic(user: User): PublicUser {
    const key = user.openaiToken ? decryptSecret(user.openaiToken) : null;

    return {
      id: user.id,
      name: user.name,
      email: user.email,
      avatarUrl: user.avatarUrl ?? null,
      hasOpenaiToken: Boolean(key),
      openaiTokenHint: key ? `…${key.slice(-4)}` : null,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }

  async create(name: string, email: string, password: string) {
    try {
      return await this.prisma.user.create({
        data: { name, email, password },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('E-mail já cadastrado.');
      }
      throw error;
    }
  }

  async update(id: string, dto: UserDto, file?: Express.Multer.File) {
    const data: Prisma.UserUpdateInput = {};

    if (dto.name?.trim()) data.name = dto.name.trim();

    if (dto.password) {
      data.password = await bcrypt.hash(dto.password, 10);
    }

    if (file) {
      const image = sanitizeImage(file, 'avatar');
      data.avatarUrl = await this.storageService.upload(image, id);
    } else if (dto.avatarUrl === '') {
      data.avatarUrl = null;
    }

    if (dto.openaiToken !== undefined) {
      const token = dto.openaiToken.trim();
      data.openaiToken = token ? encryptSecret(token) : null;
    }

    const user = await this.prisma.user.update({
      where: { id },
      data,
    });

    if (dto.password) {
      await this.revokeAllSessions(id);
    }

    return user;
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

  async findPublicById(id: string): Promise<PublicUser> {
    const user = await this.findById(id);

    if (!user) {
      throw new NotFoundException('Usuário não encontrado.');
    }

    return this.toPublic(user);
  }

  async getOpenAIKey(userId: string): Promise<string | null> {
    const user = await this.findById(userId);

    if (!user?.openaiToken) return null;

    const key = decryptSecret(user.openaiToken);

    if (key && !isEncrypted(user.openaiToken)) {
      await this.prisma.user.update({
        where: { id: userId },
        data: { openaiToken: encryptSecret(key) },
      });
    }

    return key;
  }

  async updatePassword(userId: string, password: string) {
    return this.prisma.user.update({
      where: { id: userId },
      data: { password },
    });
  }

  async revokeAllSessions(userId: string) {
    await this.prisma.refreshSession.deleteMany({ where: { userId } });
  }
}
