import { Module } from '@nestjs/common';
import { DiagramModule } from 'src/diagrams/diagram.module';
import { RealtimeGateway } from './realtime.gateway';

@Module({
  imports: [DiagramModule],
  providers: [RealtimeGateway],
})
export class RealtimeModule {}
