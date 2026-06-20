import { Module } from '@nestjs/common';
import { OpenAIService } from './openai.service';
import { OpenAIController } from './openai.controller';
import { UserModule } from 'src/users/user.module';

@Module({
  imports: [UserModule],
  providers: [OpenAIService],
  exports: [OpenAIService],
  controllers: [OpenAIController],
})
export class OpenAIModule {}
