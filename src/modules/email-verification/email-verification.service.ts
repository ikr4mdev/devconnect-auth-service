import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';

import { createHash, randomBytes } from 'node:crypto';
import { EmailService } from '../../infrastructure/email/email.service';
import { ConfigService } from '@nestjs/config';
import { AppException } from '../../core';
import { AppErrorCode } from '@devconnect-microservices/devconnect-contracts';

@Injectable()
export class EmailVerificationService {
  private readonly frontEndUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
    private readonly configService: ConfigService,
  ) {
    const frontEndUrl = this.configService.get<string>('FRONTEND_URL');

    if (!frontEndUrl) {
      throw new Error('FRONT-END Url must be configured.');
    }

    this.frontEndUrl = frontEndUrl;
  }

  async createVerificationToken(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        isEmailVerified: true,
      },
    });

    if (!user) {
      throw new AppException(AppErrorCode.USER_NOT_FOUND, 'User not found.');
    }

    if (user.isEmailVerified) {
      throw new AppException(
        AppErrorCode.EMAIL_ALREADY_VERIFIED,
        'Email is already verified.',
      );
    }

    const { token, tokenHash } = this.generateVerificationToken();
    const expireAt = new Date(Date.now() + 15 * 60 * 1000);

    const created = await this.prisma.emailVerificationToken.create({
      data: {
        userId: user.id,
        expireAt,
        tokenHash,
      },
      select: {
        id: true,
      },
    });

    const verificationUrl = new URL('/verify-email', this.frontEndUrl);
    verificationUrl.searchParams.set('token', token);

    try {
      await this.emailService.sendVerificationEmail(
        user.email,
        verificationUrl.toString(),
      );
    } catch {
      await this.prisma.emailVerificationToken
        .delete({
          where: { id: created.id },
        })
        .catch(() => {});

      throw new AppException(
        AppErrorCode.EMAIL_SEND_FAILED,
        'Unable to send verification email.',
      );
    }
  }

  async verifyEmail(token: string): Promise<void> {
    const hashToken = createHash('sha256').update(token).digest('hex');

    const findMatch = await this.prisma.emailVerificationToken.findUnique({
      where: {
        tokenHash: hashToken,
      },
    });

    if (!findMatch) {
      throw new AppException(
        AppErrorCode.VERIFICATION_TOKEN_NOT_FOUND,
        'Invalid or unknown verification token.',
      );
    }

    if (Date.now() >= findMatch.expireAt.getTime()) {
      throw new AppException(
        AppErrorCode.VERIFICATION_TOKEN_EXPIRED,
        'This verification token is no longer valid. Please request a new one.',
      );
    }

    if (findMatch.usedAt !== null) {
      throw new AppException(
        AppErrorCode.VERIFICATION_TOKEN_ALREADY_USED,
        'This verification token has already been used.',
      );
    }

    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.emailVerificationToken.updateMany({
        where: {
          id: findMatch.id,
          usedAt: null,
          expireAt: { gt: new Date() },
        },
        data: {
          usedAt: new Date(),
        },
      });

      if (claimed.count === 0) {
        throw new AppException(
          AppErrorCode.VERIFICATION_TOKEN_ALREADY_USED,
          'This verification token is invalid or has already been used.',
        );
      }

      const verified = await tx.user.updateMany({
        where: { id: findMatch.userId, isEmailVerified: false },
        data: { isEmailVerified: true },
      });

      if (verified.count === 0) {
        throw new AppException(
          AppErrorCode.EMAIL_ALREADY_VERIFIED,
          'This email address has already been verified.',
        );
      }
    });
  }

  private generateVerificationToken(): {
    token: string;
    tokenHash: string;
  } {
    const token = randomBytes(32).toString('hex');
    const tokenHash = createHash('sha256').update(token).digest('hex');

    return {
      token,
      tokenHash,
    };
  }
}
