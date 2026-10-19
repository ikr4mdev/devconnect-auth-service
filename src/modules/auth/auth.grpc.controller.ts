import { Controller } from '@nestjs/common';
import { GrpcMethod } from '@nestjs/microservices';
import { AuthService } from './auth.service';
import {
  LoginRequest,
  RegisterRequest,
  ResendVerificationRequest,
  VerifyEmailRequest,
} from '@devconnect-microservices/devconnect-contracts';

@Controller()
export class AuthGrpcController {
  constructor(private readonly authService: AuthService) {}

  @GrpcMethod('AuthService', 'Register')
  async register(data: RegisterRequest) {
    return this.authService.register(data);
  }

  @GrpcMethod('AuthService', 'Login')
  async login(data: LoginRequest) {
    const result = await this.authService.login(data);

    return {
      accessToken: result.accessToken,
      tokenType: 'Bearer',
      expiresIn: 900,
      userId: result.user.id,
    };
  }

  @GrpcMethod('AuthService', 'ResendVerification')
  async resendVerification(data: ResendVerificationRequest) {
    return await this.authService.resendVerification(data.email);
  }

  @GrpcMethod('AuthService', 'VerifyEmail')
  async verifyEmail(data: VerifyEmailRequest) {
    return this.authService.verifyEmail(data.token);
  }
}
