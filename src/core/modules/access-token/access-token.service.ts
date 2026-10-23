import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';


@Injectable()
export class AccessTokenService {
  constructor(private readonly jwtService: JwtService) {}

  async signAccessToken(userId: string, email: string): Promise<string> {
    const accessToken: string = await this.jwtService.signAsync({
      sub: userId,
      email,
    });

    return accessToken;
  }
}
