import { Module } from '@nestjs/common';
import { PrismaService } from 'src/database/prisma.service';
import { UserService } from './user.service';
import { UserController } from './user.controller';

@Module({
  providers: [PrismaService, UserService],
  controllers: [UserController],
  exports: [PrismaService, UserService],
})
export class UserModule {}
