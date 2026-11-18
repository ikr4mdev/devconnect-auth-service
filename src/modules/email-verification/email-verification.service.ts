import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';

import { createHash } from 'node:crypto';
import { EmailService } from '../../infrastructure/email/email.service';
import { ConfigService } from '@nestjs/config';
import { AppException } from '../../core';
import { AppErrorCode } from '@ikr4mdev/devconnect-contracts';
import { generateToken } from '@/core/utils';
import { Prisma } from '@prisma/client';

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

    const { token, tokenHash } = generateToken();

    const { id } = await this.prisma.$transaction(async (tx) => {
      return this.createEmailVerificationToken(user.id, tokenHash, tx);
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
          where: { id },
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
        const current = await tx.emailVerificationToken.findUnique({
          where: { id: findMatch.id },
          select: { usedAt: true, expireAt: true },
        });

        if (!current) {
          throw new AppException(
            AppErrorCode.VERIFICATION_TOKEN_NOT_FOUND,
            '…',
          );
        }
        if (current.usedAt !== null) {
          throw new AppException(
            AppErrorCode.VERIFICATION_TOKEN_ALREADY_USED,
            '…',
          );
        }
        throw new AppException(AppErrorCode.VERIFICATION_TOKEN_EXPIRED, '…');
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

  async sendVerificationEmail(email: string, rawToken: string): Promise<void> {
    const verificationUrl = new URL('/verify-email', this.frontEndUrl);
    verificationUrl.searchParams.set('token', rawToken);

    await this.emailService.sendVerificationEmail(
      email,
      verificationUrl.toString(),
    );
  }

  async persistVerificationToken(
    userId: string,
    tokenHash: string,
    tx: Prisma.TransactionClient,
  ): Promise<{ id: string }> {
    return this.createEmailVerificationToken(userId, tokenHash, tx);
  }

  private async createEmailVerificationToken(
    userId: string,
    tokenHash: string,
    tx: Prisma.TransactionClient,
  ): Promise<{
    id: string;
  }> {
    const ttlMs = 15 * 60 * 1000;
    const expireAt = new Date(Date.now() + ttlMs);

    await tx.emailVerificationToken.updateMany({
      where: {
        userId,
        usedAt: null,
      },
      data: {
        usedAt: new Date(),
      },
    });

    const newToken = await tx.emailVerificationToken.create({
      data: {
        userId,
        tokenHash,
        expireAt,
      },
      select: {
        id: true,
      },
    });

    return newToken;
  }
}
