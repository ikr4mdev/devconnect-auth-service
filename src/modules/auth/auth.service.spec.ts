import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import * as argon2 from 'argon2';

import { PrismaService } from '../../infrastructure/database/prisma.service';
import { EmailVerificationService } from '../email-verification/email-verification.service';

import { AuthService } from './auth.service';
import { authConfig } from '../../core/config/auth.config';

jest.mock('argon2', () => ({
  hash: jest.fn(),
  verify: jest.fn(),
}));

describe('AuthService', () => {
  // we defined real auth service
  let authService: AuthService;

  // we create fake/mock version of each service we use inside authservice constructor
  let prismaMock: {
    user: {
      findUnique: jest.Mock;
      create: jest.Mock;
    };
    emailVerificationToken: {
      findUnique: jest.Mock;
    };
  };

  let jwtServiceMock: {
    signAsync: jest.Mock;
  };

  let emailVerificationServiceMock: {
    createVerificationToken: jest.Mock;
    verifyEmail: jest.Mock;
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
    };

    jwtServiceMock = {
      signAsync: jest.fn(),
    };

    emailVerificationServiceMock = {
      createVerificationToken: jest.fn(),
      verifyEmail: jest.fn(),
    };

    jest.clearAllMocks();

    // then we make test module for each service inside auth instead call actual one call fake/mock one
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: PrismaService,
          useValue: prismaMock,
        },
        {
          provide: JwtService,
          useValue: jwtServiceMock,
        },
        {
          provide: EmailVerificationService,
          useValue: emailVerificationServiceMock,
        },
      ],
    }).compile();

    authService = module.get<AuthService>(AuthService);
  });

  it('should register a new user successfully', async () => {
    // then we create what we need for register
    const dto = {
      email: 'master@example.com',
      password: 'StrongPassword123!',
    };

    const userId = 'user-123';

    const createdAt = new Date('2026-01-01T00:00:00.000Z');

    const hashPassword = 'hashed-password';

    // when call argon2 give him 'hashed-password' instead create actual hash password
    (argon2.hash as jest.Mock).mockResolvedValueOnce('hashed-password');

    // when call findUnique give him null it mean no user register with same email
    prismaMock.user.findUnique.mockResolvedValueOnce(null);

    // when call findUnique give him this mock data
    prismaMock.user.create.mockResolvedValueOnce({
      id: userId,
      email: dto.email,
      isEmailVerified: false,
      createdAt,
    });

    // when call emailVerificationService it return promise<void> it mean undefined
    emailVerificationServiceMock.createVerificationToken.mockResolvedValueOnce(
      undefined,
    );

    // call register
    const result = await authService.register(dto);

    // it should call and use where { email: dto.email } as we created in register
    expect(prismaMock.user.findUnique).toHaveBeenCalledWith({
      where: { email: dto.email },
    });

    // it should call and use dto.password and some options as we created in register
    expect(argon2.hash).toHaveBeenCalledWith(dto.password, {
      type: argon2.argon2id,
      memoryCost: 65536,
      timeCost: 2,
      parallelism: 1,
    });

    // it should call and use data + select
    expect(prismaMock.user.create).toHaveBeenCalledWith({
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

    // it should call and send user id for it
    expect(
      emailVerificationServiceMock.createVerificationToken,
    ).toHaveBeenCalledWith(userId);

    // it should result equal the return of our register
    expect(result).toEqual({
      user: {
        id: userId,
        email: dto.email,
        isEmailVerified: false,
        createdAt: createdAt,
      },
      message: 'Registration successful. Email verification is required.',
    });
  });

  it('should throw ConflictException if email already exists', async () => {
    // Arrange
    const dto = {
      email: 'master@example.com',
      password: 'StrongPassword123!',
    };

    // TODO 1: Make findUnique return an existing user.
    prismaMock.user.findUnique.mockResolvedValueOnce({
      id: 'user-123',
      email: dto.email,
    });

    // TODO 2: Call authService.register(dto) and expect ConflictException
    await expect(authService.register(dto)).rejects.toThrow(
      new ConflictException('Email is already registered.'),
    );

    // TODO 3: Check that user.create was never called.
    expect(prismaMock.user.create).not.toHaveBeenCalled();

    // TODO 4: Check that argon2.hash was never called.
    expect(argon2.hash).not.toHaveBeenCalled();
  });

  it('should propagate an error if user creation fails', async () => {
    // Arrange
    const dto = {
      email: 'master@example.com',
      password: 'StrongPassword123!',
    };

    const databaseError = new Error('Database unavailable');

    // TODO 1: Make findUnique return null (no existing user).
    prismaMock.user.findUnique.mockResolvedValueOnce(null);

    // TODO 2: Make argon2.hash return a fake password hash.
    (argon2.hash as jest.Mock).mockResolvedValueOnce('hashed-password');

    // TODO 3: Make prisma.user.create reject with an Error.
    prismaMock.user.create.mockRejectedValueOnce(databaseError);

    // TODO 4: Expect authService.register(dto) to reject with that error.
    await expect(authService.register(dto)).rejects.toThrow(
      'Database unavailable',
    );

    // TODO 5: Verify the verification-token service was not called.
    expect(
      emailVerificationServiceMock.createVerificationToken,
    ).not.toHaveBeenCalled();
  });

  it('should throw UnauthorizedException if user does not exist', async () => {
    // Arrange
    const dto = {
      email: 'unknown@example.com',
      password: 'StrongPassword123!',
    };

    // TODO 1: Make findUnique return null.
    prismaMock.user.findUnique.mockResolvedValueOnce(null);

    // TODO 2: Expect authService.login(dto) to reject with UnauthorizedException.
    const promise = authService.login(dto);

    expect(prismaMock.user.findUnique).toHaveBeenCalledWith({
      where: { email: dto.email },
    });

    await expect(promise).rejects.toThrow(
      new UnauthorizedException('Invalid email or password.'),
    );

    // TODO 3: Verify argon2.verify was never called.
    expect(argon2.verify).not.toHaveBeenCalled();

    // TODO 4: Verify jwtService.signAsync was never called.
    expect(jwtServiceMock.signAsync).not.toHaveBeenCalled();
  });

  it('should throw UnauthorizedException if password is incorrect', async () => {
    // Arrange
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

    // TODO 1: Make findUnique return the user.
    prismaMock.user.findUnique.mockResolvedValueOnce(user);

    // TODO 2: Make argon2.verify return false.
    (argon2.verify as jest.Mock).mockResolvedValueOnce(false);

    // TODO 3: Expect login() to throw UnauthorizedException
    const promise = authService.login(dto);

    expect(prismaMock.user.findUnique).toHaveBeenCalledWith({
      where: { email: dto.email },
    });

    await expect(promise).rejects.toThrow(
      new UnauthorizedException('Invalid email or password.'),
    );

    // TODO 4: Verify argon2.verify received the stored hash and the password supplied in dto.
    expect(argon2.verify).toHaveBeenCalledWith(
      'stored-hashed-password',
      dto.password,
    );

    expect(argon2.verify).toHaveBeenCalledTimes(1);

    // TODO 5: Verify jwtServiceMock.signAsync was never called.
    expect(jwtServiceMock.signAsync).not.toHaveBeenCalled();
  });

  it('should throw UnauthorizedException if email is not verified', async () => {
    // Arrange
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

    // TODO 1: Make findUnique return the user.
    prismaMock.user.findUnique.mockResolvedValueOnce(user);

    // TODO 2: Make argon2.verify return true.
    (argon2.verify as jest.Mock).mockResolvedValueOnce(true);

    // TODO 3: Expect login() to throw UnauthorizedException with "Please verify your email before logging in."
    const promise = authService.login(dto);

    expect(prismaMock.user.findUnique).toHaveBeenCalledWith({
      where: { email: dto.email },
    });

    await expect(promise).rejects.toThrow(
      new UnauthorizedException('Please verify your email before logging in.'),
    );

    // TODO 4: Verify argon2.verify was called exactly once.
    expect(argon2.verify).toHaveBeenCalledTimes(1);

    expect(argon2.verify).toHaveBeenCalledWith(
      'stored-hashed-password',
      dto.password,
    );

    // TODO 5: Verify jwtServiceMock.signAsync was never called.
    expect(jwtServiceMock.signAsync).not.toHaveBeenCalled();
  });

  it('should log in a verified user successfully', async () => {
    // Arrange
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

    // TODO 1: Make findUnique return the user.
    prismaMock.user.findUnique.mockResolvedValueOnce(user);

    // TODO 2: Make argon2.verify return true.
    (argon2.verify as jest.Mock).mockResolvedValueOnce(true);

    // TODO 3: Make jwtServiceMock.signAsync return 'fake-access-token'.
    jwtServiceMock.signAsync.mockResolvedValueOnce('fake-access-token');

    // TODO 4: Call authService.login(dto).
    const promise = authService.login(dto);

    await expect(promise).resolves.toBeDefined();

    expect(prismaMock.user.findUnique).toHaveBeenCalledTimes(1);
    expect(argon2.verify).toHaveBeenCalledTimes(1);
    expect(jwtServiceMock.signAsync).toHaveBeenCalledTimes(1);

    expect(prismaMock.user.findUnique).toHaveBeenCalledWith({
      where: { email: dto.email },
    });

    expect(argon2.verify).toHaveBeenCalledWith(user.passwordHash, dto.password);

    // TODO 5: Verify signAsync receives:
    //   payload: { sub: user.id, email: user.email }
    //   options: algorithm 'RS256', authConfig.audience,
    //            authConfig.issuer, and expiresIn.

    expect(jwtServiceMock.signAsync).toHaveBeenCalledWith(
      {
        sub: user.id,
        email: user.email,
      },
      {
        algorithm: 'RS256',
        audience: authConfig.audience,
        issuer: authConfig.issuer,
        expiresIn: authConfig.expiresIn,
      },
    );

    // TODO 6: Verify the returned result contains the expected
    //         user details and accessToken.
    expect(promise).resolves.toMatchObject({
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
    // Arrange
    const email = 'unknown@example.com';

    // TODO 1: Make findUnique return null.
    prismaMock.user.findUnique.mockResolvedValueOnce(null);

    const message =
      'If the account exists and needs verification, an email will be sent.';

    // TODO 2: Call authService.resendVerification(email).
    const promise = authService.resendVerification(email);

    // TODO 3: Check the generic message:
    // "If the account exists and needs verification, an email will be sent."
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

    // TODO 4: Verify createVerificationToken was never called.
    expect(
      emailVerificationServiceMock.createVerificationToken,
    ).not.toHaveBeenCalled();
  });

  it('should return a generic message when the user is already verified', async () => {
    // Arrange
    const email = 'master@example.com';

    const user = {
      id: 'user-123',
      email,
      isEmailVerified: true,
    };

    const message =
      'If the account exists and needs verification, an email will be sent.';

    // TODO 1: Make findUnique return this user.
    prismaMock.user.findUnique.mockResolvedValueOnce(user);

    // TODO 2: Call authService.resendVerification(email).
    const promise = authService.resendVerification(email);

    // TODO 3: Expect the same generic message as the previous test.
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

    // TODO 4: Verify createVerificationToken was never called.
    expect(
      emailVerificationServiceMock.createVerificationToken,
    ).not.toHaveBeenCalled();
  });

  it('should resend verification for an existing unverified user', async () => {
    // Arrange
    const email = 'master@example.com';

    const user = {
      id: 'user-123',
      email,
      isEmailVerified: false,
    };

    const message =
      'If the account exists and needs verification, an email will be sent.';

    // TODO 1: Make findUnique return this user.
    prismaMock.user.findUnique.mockResolvedValueOnce(user);

    // TODO 2: Make createVerificationToken resolve successfully.
    emailVerificationServiceMock.createVerificationToken.mockResolvedValueOnce(
      undefined,
    );

    // TODO 3: Call authService.resendVerification(email).
    const promise = authService.resendVerification(email);

    // TODO 4: Expect the generic message.
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

    // TODO 5: Verify createVerificationToken was called exactly once
    //         with user.id.
    expect(
      emailVerificationServiceMock.createVerificationToken,
    ).toHaveBeenCalledTimes(1);

    expect(
      emailVerificationServiceMock.createVerificationToken,
    ).toHaveBeenCalledWith(user.id);
  });

  it('should verify email successfully', async () => {
    // Arrange
    const token = 'valid-verification-token';

    const message = 'Email verified successfully. You can now sign in.';

    // TODO 1: Make emailVerificationServiceMock.verifyEmail
    //         resolve successfully.
    emailVerificationServiceMock.verifyEmail.mockResolvedValueOnce(undefined);

    // TODO 2: Call authService.verifyEmail(token).
    const promise = authService.verifyEmail(token);

    // TODO 3: Expect the result:
    // {
    //   message: 'Email verified successfully. You can now sign in.'
    // }
    await expect(promise).resolves.toEqual({ message });

    // TODO 4: Verify verifyEmail was called exactly once
    //         with the supplied token.
    expect(emailVerificationServiceMock.verifyEmail).toHaveBeenCalledTimes(1);
    expect(emailVerificationServiceMock.verifyEmail).toHaveBeenCalledWith(
      token,
    );
  });

  it('should propagate an error when email verification fails', async () => {
    // Arrange
    const token = 'invalid-verification-token';
    const verificationError = new Error('Invalid verification token');

    emailVerificationServiceMock.verifyEmail.mockRejectedValueOnce(
      verificationError,
    );

    // TODO 1: Make emailVerificationServiceMock.verifyEmail reject
    //         with verificationError.
    const promise = authService.verifyEmail(token);

    // TODO 2: Expect authService.verifyEmail(token) to reject
    //         with the same error message.
    await expect(promise).rejects.toThrow(verificationError);

    // TODO 3: Verify verifyEmail was called exactly once
    //         with token.
    expect(emailVerificationServiceMock.verifyEmail).toHaveBeenCalledTimes(1);
    expect(emailVerificationServiceMock.verifyEmail).toHaveBeenCalledWith(
      token,
    );
  });
});
