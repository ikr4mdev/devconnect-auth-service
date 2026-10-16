import { Module } from '@nestjs/common';
import { EmailVerificationService } from './email-verification.service';
import { PrismaModule } from '../../infrastructure/database/prisma.module';
import { EmailModule } from '../../infrastructure/email/email.module';

@Module({
  imports: [PrismaModule, EmailModule],
  providers: [EmailVerificationService],
  exports: [EmailVerificationService],
})
export class EmailVerificationModule {}
