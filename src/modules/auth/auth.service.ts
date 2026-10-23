import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { RegisterDto } from './dto/register.dto';
import * as argon2 from 'argon2';
import { LoginDto } from './dto/login.dto';
import { EmailVerificationService } from '../email-verification/email-verification.service';
import { AccessTokenService } from '@/core/modules/access-token/access-token.service';
import { PasswordResetService } from '../password-reset/password-reset.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly emailVerification: EmailVerificationService,
    private readonly accessTokenService: AccessTokenService,
    private readonly passwordResetService: PasswordResetService,
  ) {}

  async register(dto: RegisterDto) {
    const { email, password } = dto;

    const existingUser = await this.prisma.user.findUnique({
      where: { email },
    });

    if (existingUser)
      throw new ConflictException('Email is already registered.');

    const passwordHash = await argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: 65536,
      timeCost: 2,
      parallelism: 1,
    });

    const user = await this.prisma.user.create({
      data: {
        email,
        passwordHash,
      },
      select: {
        id: true,
        email: true,
        isEmailVerified: true,
        createdAt: true,
      },
    });

    await this.emailVerification.createVerificationToken(user.id);

    return {
      user: {
        id: user.id,
        email: user.email,
        isEmailVerified: user.isEmailVerified,
        createdAt: user.createdAt,
      },
      message: 'Registration successful. Email verification is required.',
      requiresVerification: true,
    };
  }

  async login(dto: LoginDto) {
    const { email, password } = dto;

    const findUser = await this.prisma.user.findUnique({
      where: { email },
    });

    if (!findUser)
      throw new UnauthorizedException('Invalid email or password.');

    const isPasswordMatch = await argon2.verify(
      findUser.passwordHash,
      password,
    );

    if (!isPasswordMatch)
      throw new UnauthorizedException('Invalid email or password.');

    if (!findUser.isEmailVerified) {
      throw new UnauthorizedException(
        'Please verify your email before logging in.',
      );
    }

    const accessToken = await this.accessTokenService.signAccessToken(
      findUser.id,
      findUser.email,
    );

    return {
      user: {
        id: findUser.id,
        email: findUser.email,
        isEmailVerified: findUser.isEmailVerified,
        createdAt: findUser.createdAt,
      },
      accessToken,
    };
  }

  async forgotPassword(email: string) {
    await this.passwordResetService.createPasswordResetToken(email);

    return {
      message:
        'If the account exists, instructions to reset the password will be sent.',
    };
  }

  async resetPassword(
    token: string,
    newPassword: string,
  ): Promise<{ message: string }> {
    await this.passwordResetService.resetPassword(token, newPassword);

    return {
      message: 'Password reset successfully. You can now sign in.',
    };
  }

  async resendVerification(email: string): Promise<{ message: string }> {
    const user = await this.prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        isEmailVerified: true,
      },
    });

    const message =
      'If the account exists and needs verification, an email will be sent.';

    if (!user || user.isEmailVerified) {
      return { message };
    }

    await this.emailVerification.createVerificationToken(user.id);

    return { message };
  }

  async verifyEmail(token: string): Promise<{ message: string }> {
    await this.emailVerification.verifyEmail(token);

    return {
      message: 'Email verified successfully. You can now sign in.',
    };
  }
}
