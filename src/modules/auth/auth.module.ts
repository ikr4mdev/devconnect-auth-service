import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infrastructure/database/prisma.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtModule } from '@nestjs/jwt';
import { authConfig } from '../../core/config/auth.config';
import type { StringValue } from 'ms';
import { AuthGrpcController } from './auth.grpc.controller';

@Module({
  imports: [
    PrismaModule,
    JwtModule.register({
      privateKey: authConfig.privateKey,
      publicKey: authConfig.publicKey,
      signOptions: {
        algorithm: 'RS256',
        expiresIn: authConfig.expiresIn as StringValue,
      },
    }),
  ],
  controllers: [AuthController, AuthGrpcController],
  providers: [AuthService],
  exports: [AuthModule],
})
export class AuthModule {}
