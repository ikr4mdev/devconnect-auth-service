import { Test } from '@nestjs/testing';
import { Transport, MicroserviceOptions } from '@nestjs/microservices';
import { ConflictException, INestApplication } from '@nestjs/common';
import { join } from 'node:path';
import { createServer } from 'node:net';

import {
  Client,
  credentials,
  loadPackageDefinition,
  ServiceClientConstructor,
  status,
} from '@grpc/grpc-js';
import { loadSync } from '@grpc/proto-loader';

import { AuthGrpcController } from '@/modules/auth/auth.grpc.controller';
import { AuthService } from '@/modules/auth/auth.service';
import { APP_FILTER } from '@nestjs/core';
import { GrpcExceptionFilter } from '../src/core/filters/grpc-exception.filter';

// --- Types ---------------------------------------------------------------

interface RegisterRequest {
  email: string;
  password: string;
}

interface RegisterResponse {
  user: {
    id: string;
    email: string;
    isEmailVerified: boolean;
    createdAt: { seconds: number; nanos: number };
  };
  message: string;
  requiresVerification: boolean;
}

type UnaryCallback<TRes> = (err: Error | null, res: TRes) => void;

interface AuthServiceClient extends Client {
  Register(req: RegisterRequest, cb: UnaryCallback<RegisterResponse>): void;
}

// --- Helpers -------------------------------------------------------------

async function getAvailablePort(): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address && typeof address === 'object') {
        const { port } = address;
        server.close((err) => {
          if (err) reject(err);
          else resolve(port);
        });
      } else {
        server.close(() => reject(new Error('Failed to read assigned port')));
      }
    });
  });
}

function callUnary<TRequest, TResponse>(
  method: (req: TRequest, cb: UnaryCallback<TResponse>) => void,
  request: TRequest,
): Promise<TResponse> {
  return new Promise<TResponse>((resolve, reject) => {
    method(request, (err, res) => {
      if (err) reject(err);
      else resolve(res);
    });
  });
}

// --- Tests ---------------------------------------------------------------

describe('AuthGrpcController (e2e)', () => {
  let app: INestApplication;
  let grpcPort: number;
  let client: AuthServiceClient;

  const protoPath = join(
    process.cwd(),
    'node_modules/@devconnect-microservices/devconnect-contracts/proto/auth.proto',
  );

  const loaderOptions = {
    keepCase: false,
    longs: Number,
    enums: String,
    defaults: true,
    oneofs: true,
  } as const;

  const authServiceMock = {
    register: jest.fn(),
    login: jest.fn(),
    forgotPassword: jest.fn(),
    resetPassword: jest.fn(),
    resendVerification: jest.fn(),
    verifyEmail: jest.fn(),
  };

  beforeAll(async () => {
    grpcPort = await getAvailablePort();

    const moduleFixture = await Test.createTestingModule({
      controllers: [AuthGrpcController],
      providers: [
        {
          provide: AuthService,
          useValue: authServiceMock,
        },
        {
          provide: APP_FILTER,
          useClass: GrpcExceptionFilter,
        },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();

    app.connectMicroservice<MicroserviceOptions>(
      {
        transport: Transport.GRPC,
        options: {
          package: 'auth',
          protoPath,
          url: `127.0.0.1:${grpcPort}`,
          loader: loaderOptions,
        },
      },
      { inheritAppConfig: true },
    );

    await app.init();
    await app.startAllMicroservices();

    const packageDefinition = loadSync(protoPath, loaderOptions);
    const proto = loadPackageDefinition(packageDefinition) as {
      auth: { AuthService: ServiceClientConstructor };
    };

    client = new proto.auth.AuthService(
      `127.0.0.1:${grpcPort}`,
      credentials.createInsecure(),
    ) as unknown as AuthServiceClient;
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterAll(async () => {
    if (client) {
      client.close();
    }
    if (app) {
      await app.close();
    }
  });

  it('Register returns the service response for a test email and password', async () => {
    const request: RegisterRequest = {
      email: 'test@example.com',
      password: 'Password123!',
    };

    const createdAt = { seconds: 1_700_000_000, nanos: 0 };

    const expectedResponse: RegisterResponse = {
      user: {
        id: 'user-1',
        email: request.email,
        isEmailVerified: false,
        createdAt,
      },
      message: 'Registration successful. Email verification is required.',
      requiresVerification: true,
    };

    authServiceMock.register.mockResolvedValueOnce(expectedResponse);

    const response = await callUnary<RegisterRequest, RegisterResponse>(
      client.Register.bind(client),
      request,
    );

    expect(authServiceMock.register).toHaveBeenCalledWith(
      expect.objectContaining({
        email: request.email,
        password: request.password,
      }),
    );

    expect(response).toMatchObject(expectedResponse);
  });

  it('Register rejects with ALREADY_EXISTS when the email is taken', async () => {
    const request: RegisterRequest = {
      email: 'taken@example.com',
      password: 'Password123!',
    };

    authServiceMock.register.mockRejectedValueOnce(
      new ConflictException({
        code: status.ALREADY_EXISTS,
        message: 'Email is already registered.',
      }),
    );

    const promise = callUnary<RegisterRequest, RegisterResponse>(
      client.Register.bind(client),
      request,
    );

    await expect(promise).rejects.toMatchObject({
      code: status.ALREADY_EXISTS,
      details: expect.stringContaining('already registered'),
    });

    expect(authServiceMock.register).toHaveBeenCalledWith(
      expect.objectContaining({
        email: request.email,
        password: request.password,
      }),
    );
  });

  it('does not leak sensitive error details to the gRPC client', async () => {
    const request: RegisterRequest = {
      email: 'test@example.com',
      password: 'Password123!',
    };

    const sensitiveMessage = 'Database connection details must not leak.';

    authServiceMock.register.mockRejectedValueOnce(new Error(sensitiveMessage));

    const promise = callUnary<RegisterRequest, RegisterResponse>(
      client.Register.bind(client),
      request,
    );

    const error = await promise.then(
      () => {
        throw new Error('Expected Register to reject, but it resolved');
      },
      (err) => err as { code: number; details: string },
    );

    expect(error.code).toBe(status.INTERNAL);
    expect(error.details).toContain('Internal server error');
    expect(error.details).not.toContain(sensitiveMessage);
  });
});
