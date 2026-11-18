import { AppException } from '@/core';
import { PrismaService } from '@/infrastructure/database/prisma.service';
import { EmailService } from '@/infrastructure/email/email.service';
import { AppErrorCode } from '@ikr4mdev/devconnect-contracts';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import * as argon2 from 'argon2';
import { generateToken } from '@/core/utils';

@Injectable()
export class PasswordResetService {
  private readonly frontEndUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly emailService: EmailService,
  ) {
    const frontEndUrl = this.configService.get<string>('FRONTEND_URL');

    if (!frontEndUrl) {
      throw new Error('FRONT-END Url must be configured.');
    }

    this.frontEndUrl = frontEndUrl;
  }

  async createPasswordResetToken(email: string): Promise<void> {
    const findUser = await this.prisma.user.findUnique({
      where: { email },
    });

    if (!findUser) {
      return;
    }

    const { token, tokenHash } = generateToken();
    const created = await this.generatePasswordResetToken(
      findUser.id,
      tokenHash,
    );

    const resetPasswordUrl = new URL('/reset-password', this.frontEndUrl);
    resetPasswordUrl.searchParams.set('token', token);

    try {
      await this.emailService.sendPasswordResetEmail(
        findUser.email,
        resetPasswordUrl.toString(),
      );
    } catch {
      await this.prisma.passwordResetToken
        .deleteMany({
          where: { id: created.id, usedAt: null },
        })
        .catch();

      throw new AppException(
        AppErrorCode.EMAIL_SEND_FAILED,
        'Unable to send password reset email.',
      );
    }
  }

  async resetPassword(token: string, newPassword: string): Promise<void> {
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const now = new Date();

    const record = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash },
    });

    if (!record) {
      throw new AppException(
        AppErrorCode.VERIFICATION_TOKEN_NOT_FOUND,
        'Invalid or unknown password reset token.',
      );
    }

    if (now.getTime() >= record.expireAt.getTime()) {
      throw new AppException(
        AppErrorCode.VERIFICATION_TOKEN_EXPIRED,
        'This password reset link is invalid or has expired.',
      );
    }

    if (record.usedAt !== null) {
      throw new AppException(
        AppErrorCode.VERIFICATION_TOKEN_ALREADY_USED,
        'This password reset token has already been used.',
      );
    }

    const passwordHash = await argon2.hash(newPassword, {
      type: argon2.argon2id,
      memoryCost: 65536,
      timeCost: 2,
      parallelism: 1,
    });

    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.passwordResetToken.updateMany({
        where: { id: record.id, usedAt: null, expireAt: { gt: now } },
        data: { usedAt: now },
      });

      if (claimed.count === 0) {
        throw new AppException(
          AppErrorCode.VERIFICATION_TOKEN_EXPIRED,
          'This password reset link is invalid or has expired.',
        );
      }

      const updated = await tx.user.updateMany({
        where: { id: record.userId },
        data: { passwordHash },
      });

      if (updated.count === 0) {
        throw new AppException(
          AppErrorCode.VERIFICATION_TOKEN_EXPIRED,
          'Unable to reset the password because the account no longer exists.',
        );
      }

      await tx.passwordResetToken.updateMany({
        where: { userId: record.userId, usedAt: null },
        data: { usedAt: now },
      });
    });
  }

  private async generatePasswordResetToken(
    userId: string,
    tokenHash: string,
  ): Promise<{
    id: string;
  }> {
    const expireAt = new Date(Date.now() + 15 * 60 * 1000);

    return this.prisma.$transaction(async (tx) => {
      await tx.passwordResetToken.updateMany({
        where: { userId: userId, usedAt: null },
        data: {
          usedAt: new Date(),
        },
      });

      return tx.passwordResetToken.create({
        data: {
          userId: userId,
          tokenHash,
          expireAt,
        },
        select: { id: true },
      });
    });
  }
}
