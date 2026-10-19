import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infrastructure/database/prisma.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtModule } from '@nestjs/jwt';
import { authConfig } from '../../core/config/auth.config';
import type { StringValue } from 'ms';
import { AuthGrpcController } from './auth.grpc.controller';
import { EmailVerificationModule } from '../email-verification/email-verification.module';

@Module({
  imports: [
    PrismaModule,
    EmailVerificationModule,
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
})
export class AuthModule {}
