import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from '../src/infrastructure/database/prisma.service';
import { EmailService } from '../src/infrastructure/email/email.service';

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue({})
      .overrideProvider(EmailService)
      .useValue({
        sendVerificationEmail: jest.fn(),
      })
      .compile();

    app = moduleFixture.createNestApplication();

    await app.init();
  });

  it('/ (GET)', async () => {
    const response = await request(app.getHttpServer()).get('/');
    expect(response.status).toBe(404);
  });

  afterEach(async () => {
    await app.close();
  });
});
