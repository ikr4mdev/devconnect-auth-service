import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { RegisterDto } from './dto/register.dto';
import * as argon2 from 'argon2';
import { LoginDto } from './dto/login.dto';
import { JwtService } from '@nestjs/jwt';
import { authConfig } from '../../core/config/auth.config';
import { StringValue } from 'ms';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  async register(dto: RegisterDto) {
    const { email, password } = dto;

    const existingUser = await this.prisma.user.findUnique({
      where: { email },
    });

    if (existingUser)
      throw new ConflictException('Email is already registered.');

    const passwordHash = await argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: 65536,
      timeCost: 2,
      parallelism: 1,
    });

    const user = await this.prisma.user.create({
      data: {
        email,
        passwordHash,
      },
      select: {
        id: true,
        email: true,
        isEmailVerified: true,
        createdAt: true,
      },
    });

    const accessToken = await this.jwtService.signAsync(
      {
        sub: user.id,
        email: user.email,
      },
      {
        algorithm: 'RS256',
        audience: authConfig.audience,
        issuer: authConfig.issuer,
        expiresIn: authConfig.expiresIn as StringValue,
      },
    );

    return {
      user: {
        id: user.id,
        email: user.email,
        isEmailVerified: user.isEmailVerified,
        createdAt: user.createdAt,
      },
      accessToken,
    };
  }

  async login(dto: LoginDto) {
    const { email, password } = dto;

    const findUser = await this.prisma.user.findUnique({
      where: { email },
    });

    if (!findUser)
      throw new UnauthorizedException('Invalid email or password.');

    const isPasswordMatch = await argon2.verify(
      findUser.passwordHash,
      password,
    );

    if (!isPasswordMatch)
      throw new UnauthorizedException('Invalid email or password.');

    const accessToken = await this.jwtService.signAsync(
      {
        sub: findUser.id,
        email: findUser.email,
      },
      {
        algorithm: 'RS256',
        audience: authConfig.audience,
        issuer: authConfig.issuer,
        expiresIn: authConfig.expiresIn as StringValue,
      },
    );

    return {
      user: {
        id: findUser.id,
        email: findUser.email,
        isEmailVerified: findUser.isEmailVerified,
        createdAt: findUser.createdAt,
      },
      accessToken,
    };
  }
}
