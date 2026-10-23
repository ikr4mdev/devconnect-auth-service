import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';

@Injectable()
export class EmailService {
  private readonly resend: Resend;
  private readonly emailFrom: string;

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.get<string>('RESEND_API_KEY');
    const emailFrom = this.configService.get<string>('EMAIL_FROM');

    if (!apiKey || !emailFrom) {
      throw new Error('RESEND_API_KEY and EMAIL_FROM must be configured.');
    }

    this.resend = new Resend(apiKey);
    this.emailFrom = emailFrom;
  }

  async sendVerificationEmail(
    email: string,
    verificationUrl: string,
  ): Promise<void> {
    const { error } = await this.resend.emails.send({
      from: this.emailFrom,
      to: email,
      subject: 'Verify your DevConnect email address',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto;">
            <h2>Welcome to DevConnect!</h2>
            <p>Please verify your email address by clicking the button below.</p>
            <a
            href="${verificationUrl}"
            style="
                display: inline-block;
                padding: 12px 20px;
                background-color: #2563eb;
                color: #ffffff;
                text-decoration: none;
                border-radius: 6px;
            "
            >
            Verify email
            </a>
            <p>This link expires in 15 minutes.</p>
            <p>If you didn't create a DevConnect account, you can ignore this email.</p>
        </div>
        `,
    });

    if (error) {
      throw new InternalServerErrorException(
        'Failed to send verification email.',
      );
    }
  }

  async sendPasswordResetEmail(email: string, resetUrl: string): Promise<void> {
    const { error } = await this.resend.emails.send({
      from: this.emailFrom,
      to: email,
      subject: 'Reset your DevConnect password',
      html: `
       <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto;">
            <h2>Reset your DevConnect password</h2>
            <p>We received a request to reset the password for your DevConnect account. Click the button below to choose a new password.</p>
            <a
            href="${resetUrl}"
            style="
                display: inline-block;
                padding: 12px 20px;
                background-color: #2563eb;
                color: #ffffff;
                text-decoration: none;
                border-radius: 6px;
            "
            >
            Reset password
            </a>
            <p>This link expires in 15 minutes.</p>
            <p>If you didn't request a password reset, you can safely ignore this email — your password will not change.</p>
        </div>
        `,
    });

    if (error) {
      throw new InternalServerErrorException('Failed to send reset email.');
    }
  }
}
