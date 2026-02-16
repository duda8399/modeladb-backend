import { Module } from '@nestjs/common';
import { PrismaService } from 'src/database/prisma.service';
import { DiagramController } from './diagram.controller';
import { DiagramService } from './diagram.service';
import { UserModule } from 'src/users/user.module';

@Module({
  imports: [UserModule],
  providers: [PrismaService, DiagramService],
  controllers: [DiagramController],
  exports: [PrismaService, DiagramService],
})
export class DiagramModule {}
