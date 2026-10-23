import { Module } from '@nestjs/common';
import { AccessTokenModule } from './modules/access-token/access-token.module';

@Module({
  imports: [AccessTokenModule],
  exports: [AccessTokenModule],
})
export class CoreModule {}
