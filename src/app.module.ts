import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';

@Module({
  imports: [],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}

// ========================================================================
// imports: Other modules this module depends on.
// controllers: Classes that handle incoming requests.
// providers: Services and other injectable dependencies managed by NestJS.
// @Module(): Metadata NestJS uses to assemble the application.
// ========================================================================
