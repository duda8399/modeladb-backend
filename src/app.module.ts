import { Module, ValidationPipe } from '@nestjs/common';
import { APP_PIPE } from '@nestjs/core';
import { AuthModule } from './auth/auth.module';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { UserModule } from './users/user.module';
import { DiagramModule } from './diagrams/diagram.module';
import { OpenAIModule } from './openai/openai.module';
import { RealtimeModule } from './realtime/realtime.module';
import { accessTokenSecret } from './auth/jwt-secrets';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    JwtModule.registerAsync({
      global: true,
      useFactory: () => ({ secret: accessTokenSecret() }),
    }),
    AuthModule,
    UserModule,
    OpenAIModule,
    DiagramModule,
    RealtimeModule,
  ],
  providers: [
    {
      provide: APP_PIPE,
      useValue: new ValidationPipe({ whitelist: true, transform: true }),
    },
  ],
})
export class AppModule {}
