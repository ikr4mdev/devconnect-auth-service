import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as argon2 from 'argon2';

import { PrismaService } from '../../infrastructure/database/prisma.service';
import { EmailVerificationService } from '../email-verification/email-verification.service';

import { AuthService } from './auth.service';
import { AccessTokenService } from '@/core/modules/access-token/access-token.service';
import { PasswordResetService } from '../password-reset/password-reset.service';

import { EventType, Prisma } from '@prisma/client';

jest.mock('argon2', () => ({
  hash: jest.fn(),
  verify: jest.fn(),
}));

describe('AuthService', () => {
  let authService: AuthService;
  let module: TestingModule;

  let prismaMock: {
    $transaction: jest.Mock;
    user: {
      findUnique: jest.Mock;
      create: jest.Mock;
    };
    outboxEvent: {
      create: jest.Mock;
    };
    emailVerificationToken: {
      findUnique: jest.Mock;
    };
  };

  let accessTokenServiceMock: {
    signAccessToken: jest.Mock;
  };

  let passwordResetServiceMock: {
    createPasswordResetToken: jest.Mock;
    resetPassword: jest.Mock;
  };

  let emailVerificationServiceMock: {
    createVerificationToken: jest.Mock;
    verifyEmail: jest.Mock;
    persistVerificationToken: jest.Mock;
    sendVerificationEmail: jest.Mock;
  };

  beforeEach(async () => {
    prismaMock = {
      user: {
        findUnique: jest.fn(),
        create: jest.fn(),
      },
      emailVerificationToken: {
        findUnique: jest.fn(),
      },
      outboxEvent: {
        create: jest.fn(),
      },
      $transaction: jest.fn((callback) => callback(prismaMock)),
    };

    emailVerificationServiceMock = {
      createVerificationToken: jest.fn(),
      verifyEmail: jest.fn(),
      persistVerificationToken: jest
        .fn()
        .mockResolvedValue({ id: 'token-123' }),
      sendVerificationEmail: jest.fn().mockResolvedValue(undefined),
    };
    accessTokenServiceMock = {
      signAccessToken: jest.fn(),
    };

    passwordResetServiceMock = {
      createPasswordResetToken: jest.fn(),
      resetPassword: jest.fn(),
    };

    module = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: PrismaService,
          useValue: prismaMock,
        },
        {
          provide: PasswordResetService,
          useValue: passwordResetServiceMock,
        },
        {
          provide: AccessTokenService,
          useValue: accessTokenServiceMock,
        },
        {
          provide: EmailVerificationService,
          useValue: emailVerificationServiceMock,
        },
      ],
    }).compile();

    authService = module.get<AuthService>(AuthService);
  });

  afterEach(async () => {
    jest.resetAllMocks();
  });

  it('should register a new user successfully', async () => {
    const dto = {
      displayName: 'Master User',
      email: 'master@example.com',
      password: 'StrongPassword123!',
    };

    const userId = 'user-123';
    const createdAt = new Date('2026-01-01T00:00:00.000Z');
    const hashPassword = 'hashed-password';

    (argon2.hash as jest.Mock).mockResolvedValueOnce(hashPassword);

    const txMock = {
      user: {
        create: jest.fn().mockResolvedValueOnce({
          id: userId,
          email: dto.email,
          isEmailVerified: false,
          createdAt,
        }),
      },
      outboxEvent: {
        create: jest.fn().mockResolvedValueOnce({
          id: 'event-123',
        }),
      },
    };

    prismaMock.$transaction.mockImplementationOnce(async (cb) => cb(txMock));

    emailVerificationServiceMock.persistVerificationToken.mockResolvedValueOnce(
      undefined,
    );
    emailVerificationServiceMock.sendVerificationEmail.mockResolvedValueOnce(
      undefined,
    );

    const result = await authService.register(dto);

    expect(argon2.hash).toHaveBeenCalledWith(dto.password, {
      type: argon2.argon2id,
      memoryCost: 65536,
      timeCost: 2,
      parallelism: 1,
    });

    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    expect(txMock.user.create).toHaveBeenCalledWith({
      data: {
        email: dto.email,
        passwordHash: hashPassword,
      },
      select: {
        id: true,
        email: true,
        isEmailVerified: true,
        createdAt: true,
      },
    });

    expect(
      emailVerificationServiceMock.persistVerificationToken,
    ).toHaveBeenCalledWith(userId, expect.any(String), txMock);

    expect(txMock.outboxEvent.create).toHaveBeenCalledWith({
      data: {
        eventType: EventType.USER_REGISTERED,
        payload: {
          userId,
          email: dto.email,
          displayName: dto.displayName,
        },
      },
    });

    expect(
      emailVerificationServiceMock.sendVerificationEmail,
    ).toHaveBeenCalledWith(dto.email, expect.any(String));

    expect(result).toEqual({
      user: {
        id: userId,
        email: dto.email,
        isEmailVerified: false,
        createdAt,
      },
      message: 'Registration successful. Email verification is required.',
      requiresVerification: true,
    });
  });

  it('should throw ConflictException if email already exists', async () => {
    const dto = {
      displayName: 'Master User',
      email: 'master@example.com',
      password: 'StrongPassword123!',
    };

    const databaseError = new Prisma.PrismaClientKnownRequestError(
      'Unique constraint failed',
      {
        code: 'P2002',
        clientVersion: '6.19.3',
      },
    );

    prismaMock.$transaction.mockRejectedValueOnce(databaseError);

    (argon2.hash as jest.Mock).mockResolvedValueOnce('hashed-password');

    await expect(authService.register(dto)).rejects.toThrow(
      new ConflictException('Email is already registered.'),
    );

    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    expect(
      emailVerificationServiceMock.sendVerificationEmail,
    ).not.toHaveBeenCalled();
    expect(
      emailVerificationServiceMock.persistVerificationToken,
    ).not.toHaveBeenCalled();
  });

  it('should propagate an error if user creation fails', async () => {
    const dto = {
      displayName: 'Master User',
      email: 'master@example.com',
      password: 'StrongPassword123!',
    };

    const databaseError = new Error('Database unavailable');

    (argon2.hash as jest.Mock).mockResolvedValueOnce('hashed-password');
    prismaMock.$transaction.mockRejectedValueOnce(databaseError);

    await expect(authService.register(dto)).rejects.toThrow(
      'Database unavailable',
    );

    expect(
      emailVerificationServiceMock.persistVerificationToken,
    ).not.toHaveBeenCalled();
    expect(
      emailVerificationServiceMock.sendVerificationEmail,
    ).not.toHaveBeenCalled();
  });

  it('should throw UnauthorizedException if user does not exist', async () => {
    const dto = {
      email: 'unknown@example.com',
      password: 'StrongPassword123!',
    };

    prismaMock.user.findUnique.mockResolvedValueOnce(null);

    const promise = authService.login(dto);

    expect(prismaMock.user.findUnique).toHaveBeenCalledWith({
      where: { email: dto.email },
    });

    await expect(promise).rejects.toThrow(
      new UnauthorizedException('Invalid email or password.'),
    );

    expect(argon2.verify).not.toHaveBeenCalled();

    expect(accessTokenServiceMock.signAccessToken).not.toHaveBeenCalled();
  });

  it('should throw UnauthorizedException if password is incorrect', async () => {
    const dto = {
      email: 'master@example.com',
      password: 'WrongPassword123!',
    };

    const user = {
      id: 'user-123',
      email: dto.email,
      passwordHash: 'stored-hashed-password',
      isEmailVerified: true,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    };

    prismaMock.user.findUnique.mockResolvedValueOnce(user);

    (argon2.verify as jest.Mock).mockResolvedValueOnce(false);

    const promise = authService.login(dto);

    expect(prismaMock.user.findUnique).toHaveBeenCalledWith({
      where: { email: dto.email },
    });

    await expect(promise).rejects.toThrow(
      new UnauthorizedException('Invalid email or password.'),
    );

    expect(argon2.verify).toHaveBeenCalledWith(
      'stored-hashed-password',
      dto.password,
    );

    expect(argon2.verify).toHaveBeenCalledTimes(1);

    expect(accessTokenServiceMock.signAccessToken).not.toHaveBeenCalled();
  });

  it('should throw UnauthorizedException if email is not verified', async () => {
    const dto = {
      email: 'master@example.com',
      password: 'CorrectPassword123!',
    };

    const user = {
      id: 'user-123',
      email: dto.email,
      passwordHash: 'stored-hashed-password',
      isEmailVerified: false,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    };

    prismaMock.user.findUnique.mockResolvedValueOnce(user);

    (argon2.verify as jest.Mock).mockResolvedValueOnce(true);

    const promise = authService.login(dto);

    expect(prismaMock.user.findUnique).toHaveBeenCalledWith({
      where: { email: dto.email },
    });

    await expect(promise).rejects.toThrow(
      new UnauthorizedException('Please verify your email before logging in.'),
    );

    expect(argon2.verify).toHaveBeenCalledTimes(1);

    expect(argon2.verify).toHaveBeenCalledWith(
      'stored-hashed-password',
      dto.password,
    );

    expect(accessTokenServiceMock.signAccessToken).not.toHaveBeenCalled();
  });

  it('should log in a verified user successfully', async () => {
    const dto = {
      email: 'master@example.com',
      password: 'CorrectPassword123!',
    };

    const createdAt = new Date('2026-01-01T00:00:00.000Z');

    const user = {
      id: 'user-123',
      email: dto.email,
      passwordHash: 'stored-hashed-password',
      isEmailVerified: true,
      createdAt,
      updatedAt: createdAt,
    };

    prismaMock.user.findUnique.mockResolvedValueOnce(user);

    (argon2.verify as jest.Mock).mockResolvedValueOnce(true);

    accessTokenServiceMock.signAccessToken.mockResolvedValueOnce(
      'fake-access-token',
    );

    const promise = authService.login(dto);

    await expect(promise).resolves.toBeDefined();

    expect(prismaMock.user.findUnique).toHaveBeenCalledTimes(1);
    expect(argon2.verify).toHaveBeenCalledTimes(1);
    expect(accessTokenServiceMock.signAccessToken).toHaveBeenCalledTimes(1);

    expect(prismaMock.user.findUnique).toHaveBeenCalledWith({
      where: { email: dto.email },
    });

    expect(argon2.verify).toHaveBeenCalledWith(user.passwordHash, dto.password);

    expect(accessTokenServiceMock.signAccessToken).toHaveBeenCalledWith(
      user.id,
      user.email,
    );

    await expect(promise).resolves.toMatchObject({
      user: {
        id: user.id,
        email: user.email,
        isEmailVerified: user.isEmailVerified,
        createdAt: user.createdAt,
      },
      accessToken: 'fake-access-token',
    });
  });

  it('should return a generic message when resending verification for an unknown email', async () => {
    const email = 'unknown@example.com';

    prismaMock.user.findUnique.mockResolvedValueOnce(null);

    const message =
      'If the account exists and needs verification, an email will be sent.';

    const promise = authService.resendVerification(email);

    await expect(promise).resolves.toEqual({ message });

    expect(prismaMock.user.findUnique).toHaveBeenCalledTimes(1);
    expect(prismaMock.user.findUnique).toHaveBeenCalledWith({
      where: { email: email },
      select: {
        id: true,
        email: true,
        isEmailVerified: true,
      },
    });

    expect(
      emailVerificationServiceMock.createVerificationToken,
    ).not.toHaveBeenCalled();
  });

  it('should return a generic message when the user is already verified', async () => {
    const email = 'master@example.com';

    const user = {
      id: 'user-123',
      email,
      isEmailVerified: true,
    };

    const message =
      'If the account exists and needs verification, an email will be sent.';

    prismaMock.user.findUnique.mockResolvedValueOnce(user);

    const promise = authService.resendVerification(email);

    await expect(promise).resolves.toEqual({ message });

    expect(prismaMock.user.findUnique).toHaveBeenCalledTimes(1);
    expect(prismaMock.user.findUnique).toHaveBeenCalledWith({
      where: { email: email },
      select: {
        id: true,
        email: true,
        isEmailVerified: true,
      },
    });

    expect(
      emailVerificationServiceMock.createVerificationToken,
    ).not.toHaveBeenCalled();
  });

  it('should resend verification for an existing unverified user', async () => {
    const email = 'master@example.com';

    const user = {
      id: 'user-123',
      email,
      isEmailVerified: false,
    };

    const message =
      'If the account exists and needs verification, an email will be sent.';

    prismaMock.user.findUnique.mockResolvedValueOnce(user);

    emailVerificationServiceMock.createVerificationToken.mockResolvedValueOnce(
      undefined,
    );

    const promise = authService.resendVerification(email);

    await expect(promise).resolves.toEqual({ message });

    expect(prismaMock.user.findUnique).toHaveBeenCalledTimes(1);
    expect(prismaMock.user.findUnique).toHaveBeenCalledWith({
      where: { email: email },
      select: {
        id: true,
        email: true,
        isEmailVerified: true,
      },
    });

    expect(
      emailVerificationServiceMock.createVerificationToken,
    ).toHaveBeenCalledTimes(1);

    expect(
      emailVerificationServiceMock.createVerificationToken,
    ).toHaveBeenCalledWith(user.id);
  });

  it('should verify email successfully', async () => {
    const token = 'valid-verification-token';

    const message = 'Email verified successfully. You can now sign in.';

    emailVerificationServiceMock.verifyEmail.mockResolvedValueOnce(undefined);

    const promise = authService.verifyEmail(token);

    await expect(promise).resolves.toEqual({ message });

    expect(emailVerificationServiceMock.verifyEmail).toHaveBeenCalledTimes(1);
    expect(emailVerificationServiceMock.verifyEmail).toHaveBeenCalledWith(
      token,
    );
  });

  it('should propagate an error when email verification fails', async () => {
    const token = 'invalid-verification-token';
    const verificationError = new Error('Invalid verification token');

    emailVerificationServiceMock.verifyEmail.mockRejectedValueOnce(
      verificationError,
    );

    const promise = authService.verifyEmail(token);

    await expect(promise).rejects.toThrow(verificationError);

    expect(emailVerificationServiceMock.verifyEmail).toHaveBeenCalledTimes(1);
    expect(emailVerificationServiceMock.verifyEmail).toHaveBeenCalledWith(
      token,
    );
  });
});
