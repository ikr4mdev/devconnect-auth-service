import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { RabbitMqService } from '../rabbitmq/rabbitmq-connection.service';

@Injectable()
export class OutboxPublisherService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutboxPublisherService.name);

  // checks for pending events every 5 seconds.
  private readonly pollIntervalMs = 5000;

  // processes at most 10 events per batch.
  private readonly batchSize = 10;

  // lets us stop the scheduled polling when the service shuts down.
  private interval: NodeJS.Timeout | null = null;

  // prevents a new polling run from starting while the previous one is still running.
  private isProcessing = false;

  constructor(
    private readonly prismaService: PrismaService,
    private readonly rabbitMqService: RabbitMqService,
  ) {}

  onModuleInit(): void {
    this.interval = setInterval(() => {
      this.processPendingEvents().catch((error) => {
        const errorMessage =
          error instanceof Error ? error.message : String(error);

        this.logger.error(`Outbox polling failed: ${errorMessage}`);
      });
    }, this.pollIntervalMs);
  }

  onModuleDestroy(): void {
    if (this.interval) {
      clearInterval(this.interval);
    }

    this.interval = null;
  }

  private async processPendingEvents(): Promise<void> {
    if (this.isProcessing) {
      return;
    }

    this.isProcessing = true;
    try {
      const events = await this.prismaService.outboxEvent.findMany({
        where: {
          publishedAt: null,
        },
        orderBy: { createdAt: 'asc' },
        take: this.batchSize,
      });

      if (events.length === 0) {
        return;
      }

      for (const event of events) {
        try {
          // - JSON.stringify() converts the object into JSON text.
          // - Buffer.from() converts that text into bytes that RabbitMQ can send.
          const message = Buffer.from(JSON.stringify(event.payload));

          const channel = this.rabbitMqService.getChannel();
          const exchange = this.rabbitMqService.getExchange();

          const routingKey =
            event.eventType === 'USER_REGISTERED' ? 'user.registered' : null;

          if (!routingKey) {
            throw new Error(
              `Unknown event type: ${event.eventType} (event id: ${event.id})`,
            );
          }

          await new Promise<void>((resolve, reject) => {
            channel.publish(
              exchange,
              routingKey,
              message,
              {
                persistent: true,
                messageId: event.id,
                contentType: 'application/json',
              },
              (error) => {
                if (error) {
                  reject(error);
                  return;
                }

                resolve();
              },
            );
          });

          await this.prismaService.outboxEvent.update({
            where: { id: event.id },
            data: { publishedAt: new Date() },
          });
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);

          this.logger.error(
            `Failed to publish outbox event ${event.id}: ${errorMessage}`,
          );

          try {
            await this.prismaService.outboxEvent.update({
              where: { id: event.id },
              data: {
                attempts: { increment: 1 },
                lastError: errorMessage,
              },
            });
          } catch (recordError) {
            const recordErrorMessage =
              recordError instanceof Error
                ? recordError.message
                : String(recordError);

            this.logger.error(
              `Failed to record failure for outbox event ${event.id}: ` +
                `original error: ${errorMessage}; ` +
                `recording error: ${recordErrorMessage}`,
            );
          }
        }
      }
    } finally {
      this.isProcessing = false;
    }
  }
}
