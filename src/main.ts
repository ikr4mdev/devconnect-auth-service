import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ServerCredentials } from '@grpc/grpc-js';

import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { Transport, type MicroserviceOptions } from '@nestjs/microservices';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const grpcCredentials = ServerCredentials.createSsl(
    readFileSync(join(process.cwd(), '.keys/ca.crt')),
    [
      {
        cert_chain: readFileSync(join(process.cwd(), '.keys/auth-server.crt')),
        private_key: readFileSync(join(process.cwd(), '.keys/auth-server.key')),
      },
    ],
    true,
  );

  app.connectMicroservice<MicroserviceOptions>(
    {
      transport: Transport.GRPC,
      options: {
        package: 'auth',
        protoPath: join(
          process.cwd(),
          'node_modules/@ikr4mdev/devconnect-contracts/proto/auth.proto',
        ),
        url: '127.0.0.1:50051',
        credentials: grpcCredentials,
        loader: {
          keepCase: false,
        },
      },
    },
    { inheritAppConfig: true },
  );

  app.enableShutdownHooks();

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  await app.startAllMicroservices();
  await app.listen(process.env.PORT ?? 3001);
}
void bootstrap();
