import { Controller, ConflictException } from '@nestjs/common';
import {
  GrpcMethod,
  RpcException,
  GrpcUnauthenticatedException,
} from '@nestjs/microservices';
import { AuthService } from './auth.service';
import { status } from '@grpc/grpc-js';

interface LoginRequest {
  email: string;
  password: string;
}

interface RegisterRequest {
  email: string;
  password: string;
}

@Controller()
export class AuthGrpcController {
  constructor(private readonly authService: AuthService) {}

  @GrpcMethod('AuthService', 'Register')
  async register(data: RegisterRequest) {
    try {
      return await this.authService.register(data);
    } catch (error) {
      if (error instanceof ConflictException) {
        throw new RpcException({
          code: status.ALREADY_EXISTS,
          message: 'Email is already registered.',
        });
      }

      throw error;
    }
  }

  @GrpcMethod('AuthService', 'Login')
  async login(data: LoginRequest) {
    try {
      const result = await this.authService.login(data);

      return {
        accessToken: result.accessToken,
        tokenType: 'Bearer',
        expiresIn: 900,
      };
    } catch (error) {
      if (error instanceof GrpcUnauthenticatedException) {
        throw new RpcException({
          code: status.UNAUTHENTICATED,
          message: 'Invalid email or password.',
        });
      }

      throw error;
    }
  }
}
