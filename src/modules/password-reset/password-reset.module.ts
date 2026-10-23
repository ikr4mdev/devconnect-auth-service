import { Module } from '@nestjs/common';
import { PasswordResetService } from './password-reset.service';
import { EmailModule } from '@/infrastructure/email/email.module';
import { PrismaModule } from '@/infrastructure/database/prisma.module';

@Module({
  imports: [PrismaModule, EmailModule],
  providers: [PasswordResetService],
  exports: [PasswordResetService],
})
export class PasswordResetModule {}
