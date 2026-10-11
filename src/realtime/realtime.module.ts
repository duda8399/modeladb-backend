import { Module } from '@nestjs/common';
import { DiagramModule } from 'src/diagrams/diagram.module';
import { RealtimeGateway } from './realtime.gateway';
import { OperationLog } from './operation-log';

@Module({
  imports: [DiagramModule],
  providers: [
    RealtimeGateway,
    { provide: OperationLog, useFactory: () => new OperationLog() },
  ],
})
export class RealtimeModule {}
