import { IsEmail, IsString, Length } from 'class-validator';

export class RegisterDto {
  @IsEmail({}, { message: 'The provided email address is not valid.' })
  email!: string;

  @IsString({ message: 'Password must be string' })
  @Length(8, 64, { message: 'Password must be between 8 and 64 characters.' })
  password!: string;
}
