import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { UserModule } from './users/user.module';
import { DiagramModule } from './diagrams/diagram.module';

@Module({
  imports: [
    AuthModule,
    UserModule,
    DiagramModule,
    JwtModule.register({
      global: true,
      secret: process.env.JWT_SECRET || 'teste',
    }),
    ConfigModule.forRoot({
      isGlobal: true,
    }),
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
