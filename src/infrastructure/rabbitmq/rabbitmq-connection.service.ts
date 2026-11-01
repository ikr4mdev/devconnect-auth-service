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

  private reconnectTimer: NodeJS.Timeout | null = null;
  private isConnecting = false;
  private isShuttingDown = false;

  private rabbitMqUrl: string | null = null;
  private configuredExchange = 'devconnect.events';

  constructor(private readonly configService: ConfigService) {}

  async onModuleInit(): Promise<void> {
    const url = this.configService.get<string>('RABBITMQ_URL');

    if (!url) {
      throw new Error(
        'RABBITMQ_URL is not configured. Set it in your environment or .env file.',
      );
    }

    this.rabbitMqUrl = url;

    this.configuredExchange =
      this.configService.get<string>('RABBITMQ_EXCHANGE') ??
      'devconnect.events';

    await this.connect();
  }

  private async connect(): Promise<void> {
    if (
      this.isShuttingDown ||
      this.isConnecting ||
      this.connection ||
      this.channel
    ) {
      return;
    }

    this.isConnecting = true;

    let connection: amqp.ChannelModel | undefined;
    let channel: amqp.ConfirmChannel | undefined;

    try {
      if (!this.rabbitMqUrl) {
        throw new Error('RabbitMQ URL is not configured.');
      }

      connection = await amqp.connect(this.rabbitMqUrl);
      channel = await connection.createConfirmChannel();

      await channel.assertExchange(this.configuredExchange, 'topic', {
        durable: true,
      });

      if (this.isShuttingDown) {
        this.logger.warn(
          'RabbitMQ connection attempt completed during shutdown; closing new resources.',
        );
        try {
          await channel.close();
        } catch {}
        try {
          await connection.close();
        } catch {}
        return;
      }

      this.connection = connection;
      this.channel = channel;
      this.exchange = this.configuredExchange;

      const activeConnection = connection;
      const activeChannel = channel;

      connection.on('error', (error: Error) => {
        this.logger.error(`RabbitMQ connection error: ${error.message}`);
      });

      connection.on('close', () => {
        this.handleConnectionClose(activeConnection);
      });

      channel.on('error', (error: Error) => {
        this.logger.error(`RabbitMQ channel error: ${error.message}`);
      });

      channel.on('close', () => {
        this.handleChannelClose(activeChannel);
      });

      this.cancelReconnect();
      this.logger.log(
        'RabbitMQ connection, channel, and exchange successfully created',
      );
    } catch (error) {
      this.logger.error(
        `Failed to create RabbitMQ connection/channel/exchange: ${(error as Error)?.message}`,
        error instanceof Error ? error.stack : undefined,
      );

      if (channel) {
        try {
          await channel.close();
        } catch {}
      }

      if (connection) {
        try {
          await connection.close();
        } catch {}
      }

      this.scheduleReconnect();
    } finally {
      this.isConnecting = false;
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.isShuttingDown = true;

    this.cancelReconnect();

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

  private scheduleReconnect(): void {
    if (
      this.isShuttingDown ||
      this.reconnectTimer ||
      this.connection ||
      this.channel
    ) {
      return;
    }

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect().catch((err) =>
        this.logger.error('Unexpected error in reconnect loop', err),
      );
    }, 5000);
  }

  private cancelReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private handleConnectionClose(connection: amqp.ChannelModel): void {
    if (this.isShuttingDown || this.connection !== connection) {
      return;
    }

    this.logger.warn('RabbitMQ connection closed.');

    this.connection = null;
    this.channel = null;
    this.exchange = null;

    this.scheduleReconnect();
  }

  private handleChannelClose(channel: amqp.ConfirmChannel): void {
    if (this.isShuttingDown || this.channel !== channel) {
      return;
    }

    this.logger.warn('RabbitMQ channel closed.');

    this.channel = null;
    this.exchange = null;

    if (this.connection) {
      void this.connection.close().catch((error) => {
        this.logger.warn(
          'Failed to close connection after channel closure',
          error,
        );
      });
    } else {
      this.scheduleReconnect();
    }
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

  get isReady(): boolean {
    return !!(this.connection && this.channel && this.exchange);
  }
}
