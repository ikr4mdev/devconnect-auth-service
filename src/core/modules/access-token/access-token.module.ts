import { Module } from '@nestjs/common';
import { AccessTokenService } from './access-token.service';
import { JwtModule } from '@nestjs/jwt';
import { authConfig } from '@/core/config';
import { StringValue } from 'ms';

@Module({
  imports: [
    JwtModule.register({
      privateKey: authConfig.privateKey,
      publicKey: authConfig.publicKey,
      signOptions: {
        algorithm: 'RS256',
        audience: authConfig.audience,
        issuer: authConfig.issuer,
        expiresIn: authConfig.expiresIn as StringValue,
      },
    }),
  ],
  providers: [AccessTokenService],
  exports: [AccessTokenService],
})
export class AccessTokenModule {}
