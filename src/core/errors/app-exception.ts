import { AppErrorCode } from '@ikr4mdev/devconnect-contracts';

export class AppException extends Error {
  public readonly code: AppErrorCode;
  public readonly isAppException = true;

  constructor(code: AppErrorCode, message?: string) {
    super(message ?? 'Internal server error.');

    this.name = 'AppException';
    this.code = code;

    Object.setPrototypeOf(this, AppException.prototype);
  }
}
