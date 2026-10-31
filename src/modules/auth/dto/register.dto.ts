import { Transform } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsString, Length } from 'class-validator';

export const Trim = () =>
  Transform(({ value }) => (typeof value === 'string' ? value.trim() : value));

export class RegisterDto {
  @Trim()
  @IsNotEmpty({ message: 'Please enter a display name.' })
  @IsString({ message: 'Display name must be text.' })
  @Length(2, 50, {
    message: 'Display name must be between 2 and 50 characters.',
  })
  displayName!: string;

  @Trim()
  @IsNotEmpty({ message: 'Please enter a email.' })
  @IsEmail({}, { message: 'The provided email address is not valid.' })
  email!: string;

  @IsString({ message: 'Password must be string' })
  @Length(8, 64, { message: 'Password must be between 8 and 64 characters.' })
  password!: string;
}
