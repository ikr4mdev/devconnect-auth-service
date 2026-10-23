import { Controller } from '@nestjs/common';
import { GrpcMethod } from '@nestjs/microservices';
import { AuthService } from './auth.service';
import {
  AuthResponse,
  ForgotPasswordRequest,
  LoginRequest,
  OperationResponse,
  RegisterRequest,
  RegisterResponse,
  ResendVerificationRequest,
  ResetPasswordRequest,
  VerifyEmailRequest,
} from '@devconnect-microservices/devconnect-contracts';

@Controller()
export class AuthGrpcController {
  constructor(private readonly authService: AuthService) {}

  @GrpcMethod('AuthService', 'Register')
  async register(data: RegisterRequest): Promise<RegisterResponse> {
    return this.authService.register(data);
  }

  @GrpcMethod('AuthService', 'Login')
  async login(data: LoginRequest): Promise<AuthResponse> {
    const result = await this.authService.login(data);

    return {
      accessToken: result.accessToken,
      tokenType: 'Bearer',
      expiresIn: 900,
      userId: result.user.id,
    };
  }

  @GrpcMethod('AuthService', 'ForgotPassword')
  async forgotPassword(
    data: ForgotPasswordRequest,
  ): Promise<OperationResponse> {
    return this.authService.forgotPassword(data.email);
  }

  @GrpcMethod('AuthService', 'ResetPassword')
  async resetPassword(data: ResetPasswordRequest): Promise<OperationResponse> {
    return this.authService.resetPassword(data.token, data.newPassword);
  }

  @GrpcMethod('AuthService', 'ResendVerification')
  async resendVerification(
    data: ResendVerificationRequest,
  ): Promise<OperationResponse> {
    return this.authService.resendVerification(data.email);
  }

  @GrpcMethod('AuthService', 'VerifyEmail')
  async verifyEmail(data: VerifyEmailRequest): Promise<OperationResponse> {
    return this.authService.verifyEmail(data.token);
  }
}
