import { Module } from '@nestjs/common';
import { PrismaService } from 'src/database/prisma.service';
import { DiagramController } from './diagram.controller';
import { DiagramService } from './diagram.service';
import { UserModule } from 'src/users/user.module';
import { StorageModule } from 'src/storage/storage.module';
import { DiagramVersionController } from './diagram-version.controller';
import { DiagramVersionService } from './diagram-version.service';
import { DiagramEvents } from './diagram-events';

@Module({
  imports: [UserModule, StorageModule],
  providers: [
    PrismaService,
    DiagramService,
    DiagramVersionService,
    DiagramEvents,
  ],
  controllers: [DiagramController, DiagramVersionController],
  exports: [PrismaService, DiagramService, DiagramEvents],
})
export class DiagramModule {}
