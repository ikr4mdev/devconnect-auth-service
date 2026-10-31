import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as amqp from 'amqplib';

@Injectable()
export class RabbitMqService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RabbitMqService.name);

  private connection: amqp.ChannelModel | null = null;
  private channel: amqp.ConfirmChannel | null = null;
  private exchange: string | null = null;

  constructor(private readonly configService: ConfigService) {}

  async onModuleInit(): Promise<void> {
    const url = this.configService.get<string>('RABBITMQ_URL');

    if (!url) {
      throw new Error(
        'RABBITMQ_URL is not configured. Set it in your environment or .env file.',
      );
    }

    const exchange =
      this.configService.get<string>('RABBITMQ_EXCHANGE') ??
      'devconnect.events';

    try {
      this.connection = await amqp.connect(url);
      this.channel = await this.connection.createConfirmChannel();

      await this.channel.assertExchange(exchange, 'topic', { durable: true });

      this.exchange = exchange;

      this.logger.log(
        `Connected to RabbitMQ, confirm channel ready, exchange "${exchange}" asserted`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      this.logger.error(`Failed to connect to RabbitMQ: ${message}`);

      throw error;
    }
  }

  async onModuleDestroy(): Promise<void> {
    try {
      if (this.channel) {
        await this.channel.close();
      }
    } catch (error) {
      this.logger.warn(
        'Error closing RabbitMQ channel (may already be closed)',
        error,
      );
    }

    try {
      if (this.connection) {
        await this.connection.close();
      }
    } catch (error) {
      this.logger.warn(
        'Error closing RabbitMQ connection (may already be closed)',
        error,
      );
    }

    this.channel = null;
    this.connection = null;
    this.exchange = null;
  }

  getChannel(): amqp.ConfirmChannel {
    if (!this.channel) {
      throw new Error(
        'RabbitMQ confirm channel is not available. Was the service initialized?',
      );
    }
    return this.channel;
  }

  getConnection(): amqp.ChannelModel {
    if (!this.connection) {
      throw new Error('RabbitMQ connection is not available.');
    }

    return this.connection;
  }

  getExchange(): string {
    if (!this.exchange) {
      throw new Error(
        'RabbitMQ exchange is not available. Was the service initialized?',
      );
    }
    return this.exchange;
  }
}
