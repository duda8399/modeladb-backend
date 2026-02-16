import { Module } from '@nestjs/common';
import { PrismaService } from 'src/database/prisma.service';
import { UserService } from './user.service';
import { UserController } from './user.controller';
import { StorageModule } from 'src/storage/storage.module';

@Module({
  imports: [StorageModule],
  providers: [PrismaService, UserService],
  controllers: [UserController],
  exports: [PrismaService, UserService],
})
export class UserModule {}
