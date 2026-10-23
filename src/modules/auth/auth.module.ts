import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infrastructure/database/prisma.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthGrpcController } from './auth.grpc.controller';
import { EmailVerificationModule } from '../email-verification/email-verification.module';
import { CoreModule } from '@/core/core.module';
import { PasswordResetModule } from '../password-reset/password-reset.module';

@Module({
  imports: [
    PrismaModule,
    EmailVerificationModule,
    PasswordResetModule,
    CoreModule,
  ],
  controllers: [AuthController, AuthGrpcController],
  providers: [AuthService],
})
export class AuthModule {}
