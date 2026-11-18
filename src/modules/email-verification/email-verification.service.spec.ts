import { Test, TestingModule } from '@nestjs/testing';
import { EmailVerificationService } from './email-verification.service';

import { PrismaService } from '../../infrastructure/database/prisma.service';
import { EmailService } from '../../infrastructure/email/email.service';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { AppErrorCode } from '@ikr4mdev/devconnect-contracts';

const hashToken = (token: string) =>
  createHash('sha256').update(token).digest('hex');

describe('EmailVerificationService', () => {
  let emailVerification: EmailVerificationService;

  let prismaMock: {
    user: {
      findUnique: jest.Mock;
      updateMany: jest.Mock;
    };
    emailVerificationToken: {
      findUnique: jest.Mock;
      create: jest.Mock;
      delete: jest.Mock;
      updateMany: jest.Mock;
    };
    $transaction: jest.Mock;
  };

  let emailServiceMock: {
    sendVerificationEmail: jest.Mock;
  };

  let configServiceMock: {
    get: jest.Mock;
  };

  beforeEach(async () => {
    prismaMock = {
      user: {
        findUnique: jest.fn(),
        updateMany: jest.fn(),
      },
      emailVerificationToken: {
        findUnique: jest.fn(),
        create: jest.fn(),
        delete: jest.fn(),
        updateMany: jest.fn(),
      },
      $transaction: jest.fn(),
    };

    emailServiceMock = {
      sendVerificationEmail: jest.fn(),
    };

    configServiceMock = {
      get: jest.fn(),
    };

    configServiceMock.get.mockImplementation((key: string) => {
      if (key === 'FRONTEND_URL') return 'https://app.example.com';
      return undefined;
    });

    prismaMock.$transaction.mockImplementation(async (cb: any) =>
      cb(prismaMock),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmailVerificationService,
        {
          provide: PrismaService,
          useValue: prismaMock,
        },
        {
          provide: EmailService,
          useValue: emailServiceMock,
        },
        {
          provide: ConfigService,
          useValue: configServiceMock,
        },
      ],
    }).compile();

    emailVerification = module.get<EmailVerificationService>(
      EmailVerificationService,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  //   =================================================================
  //   Verify Email
  //   =================================================================

  it('should throw an error for an unknown verification token', async () => {
    // Arrange
    const rawToken = 'unknown-token';
    prismaMock.emailVerificationToken.findUnique.mockResolvedValueOnce(null);

    // Act
    const promise = emailVerification.verifyEmail(rawToken);

    // Assert
    await expect(promise).rejects.toMatchObject({
      code: AppErrorCode.VERIFICATION_TOKEN_NOT_FOUND,
    });

    expect(prismaMock.emailVerificationToken.findUnique).toHaveBeenCalledTimes(
      1,
    );
    expect(prismaMock.emailVerificationToken.findUnique).toHaveBeenCalledWith({
      where: { tokenHash: hashToken(rawToken) },
    });
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('should throw an error for expired verification token', async () => {
    // Arrange
    const rawToken = 'expired-verification-token';
    const token = {
      id: 'token-1',
      userId: 'user-1',
      expireAt: new Date('2026-01-01T00:00:00.000Z'),
      usedAt: null,
    };

    prismaMock.emailVerificationToken.findUnique.mockResolvedValueOnce(token);

    // Act
    const promise = emailVerification.verifyEmail(rawToken);

    // Assert
    await expect(promise).rejects.toMatchObject({
      code: AppErrorCode.VERIFICATION_TOKEN_EXPIRED,
    });

    expect(prismaMock.emailVerificationToken.findUnique).toHaveBeenCalledTimes(
      1,
    );
    expect(prismaMock.emailVerificationToken.findUnique).toHaveBeenCalledWith({
      where: { tokenHash: hashToken(rawToken) },
    });
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('should throw an error for already-used token', async () => {
    // Arrange
    const rawToken = 'already-used-token';
    const token = {
      id: 'token-1',
      userId: 'user-1',
      expireAt: new Date(Date.now() + 15 * 60 * 1000),
      usedAt: new Date(Date.now() - 15 * 60 * 1000),
    };

    prismaMock.emailVerificationToken.findUnique.mockResolvedValueOnce(token);

    // Act
    const promise = emailVerification.verifyEmail(rawToken);

    // Assert
    await expect(promise).rejects.toMatchObject({
      code: AppErrorCode.VERIFICATION_TOKEN_ALREADY_USED,
    });

    expect(prismaMock.emailVerificationToken.findUnique).toHaveBeenCalledTimes(
      1,
    );
    expect(prismaMock.emailVerificationToken.findUnique).toHaveBeenCalledWith({
      where: { tokenHash: hashToken(rawToken) },
    });
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('should mark token used and verify email in a transaction', async () => {
    // Arrange
    const rawToken = 'valid-raw-token';
    const token = {
      id: 'token-1',
      userId: 'user-1',
      expireAt: new Date(Date.now() + 15 * 60 * 1000),
      usedAt: null,
    };

    prismaMock.emailVerificationToken.findUnique.mockResolvedValueOnce(token);
    prismaMock.emailVerificationToken.updateMany.mockResolvedValueOnce({
      count: 1,
    });
    prismaMock.user.updateMany.mockResolvedValueOnce({
      count: 1,
    });

    // Act
    const promise = emailVerification.verifyEmail(rawToken);

    // Assert
    await expect(promise).resolves.toBeUndefined();

    expect(prismaMock.emailVerificationToken.findUnique).toHaveBeenCalledTimes(
      1,
    );
    expect(prismaMock.emailVerificationToken.findUnique).toHaveBeenCalledWith({
      where: { tokenHash: hashToken(rawToken) },
    });

    expect(prismaMock.emailVerificationToken.updateMany).toHaveBeenCalledTimes(
      1,
    );
    expect(prismaMock.emailVerificationToken.updateMany).toHaveBeenCalledWith({
      where: {
        id: token.id,
        usedAt: null,
        expireAt: { gt: expect.any(Date) },
      },
      data: {
        usedAt: expect.any(Date),
      },
    });

    expect(prismaMock.user.updateMany).toHaveBeenCalledTimes(1);
    expect(prismaMock.user.updateMany).toHaveBeenCalledWith({
      where: { id: token.userId, isEmailVerified: false },
      data: { isEmailVerified: true },
    });

    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
  });

  it('should throw an error for user already verified', async () => {
    // Arrange
    const rawToken = 'valid-raw-token';
    const token = {
      id: 'token-1',
      userId: 'user-1',
      expireAt: new Date(Date.now() + 15 * 60 * 1000),
      usedAt: null,
    };

    prismaMock.emailVerificationToken.findUnique.mockResolvedValueOnce(token);
    prismaMock.emailVerificationToken.updateMany.mockResolvedValueOnce({
      count: 1,
    });
    prismaMock.user.updateMany.mockResolvedValueOnce({
      count: 0,
    });

    // Act
    const promise = emailVerification.verifyEmail(rawToken);

    // Assert
    await expect(promise).rejects.toMatchObject({
      code: AppErrorCode.EMAIL_ALREADY_VERIFIED,
    });

    expect(prismaMock.emailVerificationToken.findUnique).toHaveBeenCalledTimes(
      1,
    );
    expect(prismaMock.emailVerificationToken.findUnique).toHaveBeenCalledWith({
      where: { tokenHash: hashToken(rawToken) },
    });

    expect(prismaMock.emailVerificationToken.updateMany).toHaveBeenCalledTimes(
      1,
    );
    expect(prismaMock.emailVerificationToken.updateMany).toHaveBeenCalledWith({
      where: {
        id: token.id,
        usedAt: null,
        expireAt: { gt: expect.any(Date) },
      },
      data: {
        usedAt: expect.any(Date),
      },
    });

    expect(prismaMock.user.updateMany).toHaveBeenCalledTimes(1);
    expect(prismaMock.user.updateMany).toHaveBeenCalledWith({
      where: { id: token.userId, isEmailVerified: false },
      data: { isEmailVerified: true },
    });

    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
  });

  //   =================================================================
  //   Create Verification Token
  //   =================================================================

  it('should throw an error when the user does not exist', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce(null);

    const promise = emailVerification.createVerificationToken('missing-user');

    await expect(promise).rejects.toMatchObject({
      code: AppErrorCode.USER_NOT_FOUND,
      message: 'User not found.',
    });

    expect(prismaMock.emailVerificationToken.create).not.toHaveBeenCalled();
    expect(emailServiceMock.sendVerificationEmail).not.toHaveBeenCalled();
  });

  it('should throw an error when the email is already verified', async () => {
    const user = {
      id: 'user-id',
      email: 'master@example.com',
      isEmailVerified: true,
    };
    prismaMock.user.findUnique.mockResolvedValueOnce(user);

    const promise = emailVerification.createVerificationToken('user-id');

    await expect(promise).rejects.toMatchObject({
      code: AppErrorCode.EMAIL_ALREADY_VERIFIED,
      message: 'Email is already verified.',
    });

    expect(prismaMock.emailVerificationToken.create).not.toHaveBeenCalled();
    expect(emailServiceMock.sendVerificationEmail).not.toHaveBeenCalled();
  });

  it('should create a verification token and send the email successfully', async () => {
    // Arrange
    const userId = 'user-id';
    const user = {
      id: userId,
      email: 'master@example.com',
      isEmailVerified: false,
    };

    prismaMock.user.findUnique.mockResolvedValueOnce(user);

    prismaMock.emailVerificationToken.create.mockResolvedValueOnce({
      id: 'token-record-id',
    });

    emailServiceMock.sendVerificationEmail.mockResolvedValueOnce(undefined);

    const promise = emailVerification.createVerificationToken(userId);

    await expect(promise).resolves.toBeUndefined();

    expect(prismaMock.user.findUnique).toHaveBeenCalledTimes(1);
    expect(prismaMock.user.findUnique).toHaveBeenCalledWith({
      where: { id: userId },
      select: { id: true, email: true, isEmailVerified: true },
    });

    expect(prismaMock.emailVerificationToken.create).toHaveBeenCalledTimes(1);

    const createArg = prismaMock.emailVerificationToken.create.mock.calls[0][0];

    expect(createArg).toMatchObject({
      data: {
        userId,
        tokenHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        expireAt: expect.any(Date),
      },
      select: { id: true },
    });

    // expireAt ≈ now + 15 minutes
    const expiresInMs = createArg.data.expireAt.getTime() - Date.now();
    const fifteenMinutes = 15 * 60 * 1000;
    expect(expiresInMs).toBeGreaterThan(fifteenMinutes - 5000);
    expect(expiresInMs).toBeLessThanOrEqual(fifteenMinutes + 5000);

    expect(emailServiceMock.sendVerificationEmail).toHaveBeenCalledTimes(1);

    const [to, url] = emailServiceMock.sendVerificationEmail.mock.calls[0];

    expect(to).toBe(user.email);

    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe(
      'https://app.example.com/verify-email',
    );

    const rawToken = parsed.searchParams.get('token');
    expect(rawToken).toMatch(/^[a-f0-9]{64}$/);
    expect(rawToken).not.toBe(createArg.data.tokenHash);
  });

  it('should delete the created token when sending the email fails', async () => {
    // Arrange
    const userId = 'user-id';
    const TOKEN_RECORD_ID = 'token-record-id';
    const user = {
      id: userId,
      email: 'master@example.com',
      isEmailVerified: false,
    };

    prismaMock.user.findUnique.mockResolvedValueOnce(user);

    prismaMock.emailVerificationToken.create.mockResolvedValueOnce({
      id: TOKEN_RECORD_ID,
    });

    emailServiceMock.sendVerificationEmail.mockRejectedValueOnce(
      new Error('Failed to send verification email.'),
    );
    prismaMock.emailVerificationToken.delete.mockResolvedValueOnce({});

    const promise = emailVerification.createVerificationToken(userId);

    await expect(promise).rejects.toMatchObject({
      code: AppErrorCode.EMAIL_SEND_FAILED,
      message: 'Unable to send verification email.',
    });

    expect(emailServiceMock.sendVerificationEmail).toHaveBeenCalledTimes(1);
    expect(prismaMock.emailVerificationToken.create).toHaveBeenCalledTimes(1);

    const createArg = prismaMock.emailVerificationToken.create.mock.calls[0][0];
    expect(createArg).toMatchObject({
      data: {
        userId,
        tokenHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        expireAt: expect.any(Date),
      },
      select: { id: true },
    });

    expect(prismaMock.emailVerificationToken.delete).toHaveBeenCalledTimes(1);
    expect(prismaMock.emailVerificationToken.delete).toHaveBeenCalledWith({
      where: { id: TOKEN_RECORD_ID },
    });
  });

  // 1. The user exists and is not verified.
  // 2. Token creation succeeds.
  // 3. Sending the email rejects.
  // 4. Deleting the token also rejects.
  // 5. The final error is still EMAIL_SEND_FAILED, with message Unable to send verification email.

  it('should preserve the email error when token deletion fails', async () => {
    // Arrange
    const userId = 'user-id';
    const TOKEN_RECORD_ID = 'token-record-id';
    const user = {
      id: userId,
      email: 'master@example.com',
      isEmailVerified: false,
    };

    prismaMock.user.findUnique.mockResolvedValueOnce(user);

    prismaMock.emailVerificationToken.create.mockResolvedValueOnce({
      id: TOKEN_RECORD_ID,
    });

    emailServiceMock.sendVerificationEmail.mockRejectedValueOnce(
      new Error('Failed to send verification email.'),
    );
    prismaMock.emailVerificationToken.delete.mockRejectedValueOnce(
      new Error('Failed to delete verification token.'),
    );

    const promise = emailVerification.createVerificationToken(userId);

    await expect(promise).rejects.toMatchObject({
      code: AppErrorCode.EMAIL_SEND_FAILED,
      message: 'Unable to send verification email.',
    });

    expect(emailServiceMock.sendVerificationEmail).toHaveBeenCalledTimes(1);
    expect(prismaMock.emailVerificationToken.create).toHaveBeenCalledTimes(1);

    expect(prismaMock.emailVerificationToken.delete).toHaveBeenCalledTimes(1);
    expect(prismaMock.emailVerificationToken.delete).toHaveBeenCalledWith({
      where: { id: TOKEN_RECORD_ID },
    });
  });

  it('should propagate token creation errors without sending email', async () => {
    const userId = 'user-id';

    const user = {
      id: userId,
      email: 'master@example.com',
      isEmailVerified: false,
    };

    prismaMock.user.findUnique.mockResolvedValueOnce(user);
    prismaMock.emailVerificationToken.create.mockRejectedValueOnce(
      new Error('Database unavailable.'),
    );

    const promise = emailVerification.createVerificationToken(userId);

    await expect(promise).rejects.toThrow('Database unavailable.');

    expect(prismaMock.user.findUnique).toHaveBeenCalledTimes(1);
    expect(prismaMock.emailVerificationToken.create).toHaveBeenCalledTimes(1);

    expect(emailServiceMock.sendVerificationEmail).not.toHaveBeenCalled();
    expect(prismaMock.emailVerificationToken.delete).not.toHaveBeenCalled();
  });

  it('should throw when FRONTEND_URL is missing', async () => {
    configServiceMock.get.mockImplementation((key: string) => {
      if (key === 'FRONTEND_URL') return undefined;
      return undefined;
    });

    expect(
      () =>
        new EmailVerificationService(
          prismaMock as unknown as PrismaService,
          emailServiceMock as unknown as EmailService,
          configServiceMock as unknown as ConfigService,
        ),
    ).toThrow('FRONT-END Url must be configured.');
  });
});
