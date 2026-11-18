import { Metadata, status, type ServiceError } from '@grpc/grpc-js';
import {
  Catch,
  ConflictException,
  RpcExceptionFilter,
  UnauthorizedException,
} from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import {
  AppErrorCode,
  GrpcStatusMap,
} from '@ikr4mdev/devconnect-contracts';
import { AppException } from '../../core';
import { Observable, throwError } from 'rxjs';

@Catch()
export class GrpcExceptionFilter implements RpcExceptionFilter<unknown> {
  catch(exception: unknown): Observable<never> {
    if (exception instanceof RpcException) {
      return throwError(() => exception);
    }

    let appCode: AppErrorCode = AppErrorCode.INTERNAL_ERROR;
    let code: number = status.INTERNAL;
    let message = 'Internal server error.';

    if (exception instanceof AppException) {
      appCode = exception.code;
      code = GrpcStatusMap[appCode];
      message = exception.message;
    } else if (exception instanceof ConflictException) {
      appCode = AppErrorCode.EMAIL_ALREADY_REGISTERED;
      code = status.ALREADY_EXISTS;
      message = exception.message;
    } else if (exception instanceof UnauthorizedException) {
      appCode = AppErrorCode.INVALID_CREDENTIALS;
      code = status.UNAUTHENTICATED;
      message = exception.message;
    }

    const metadata = new Metadata();
    metadata.set('app-error-code', appCode);

    const grpcError = Object.assign(new Error(message), {
      code,
      details: message,
      metadata,
    }) as ServiceError;

    return throwError(() => grpcError);
  }
}
