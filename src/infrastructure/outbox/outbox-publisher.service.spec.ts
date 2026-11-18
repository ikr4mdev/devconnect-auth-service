import { OutboxPublisherService } from './outbox-publisher.service';
import { PrismaService } from '../database/prisma.service';
import { RabbitMqService } from '../rabbitmq/rabbitmq-connection.service';

describe('OutboxPublisherService', () => {
  let service: OutboxPublisherService;
  let returnListener: ((message: any) => void) | undefined;
  let prismaMock: {
    outboxEvent: {
      findMany: jest.Mock;
      update: jest.Mock;
    };
  };
  let rabbitMqServiceMock: {
    isReady: boolean;
    getChannel: jest.Mock;
    getExchange: jest.Mock;
  };
  let channelMock: {
    publish: jest.Mock;
    on: jest.Mock;
    removeListener: jest.Mock;
  };

  beforeEach(() => {
    returnListener = undefined;

    prismaMock = {
      outboxEvent: {
        findMany: jest.fn(),
        update: jest.fn(),
      },
    };

    rabbitMqServiceMock = {
      isReady: true,
      getChannel: jest.fn(),
      getExchange: jest.fn(),
    };

    channelMock = {
      publish: jest.fn(),
      on: jest.fn(),
      removeListener: jest.fn(),
    };

    channelMock.on.mockImplementation((event, listener) => {
      if (event === 'return') {
        returnListener = listener;
      }
    });

    rabbitMqServiceMock.getChannel.mockReturnValue(channelMock);
    rabbitMqServiceMock.getExchange.mockReturnValue('events');

    service = new OutboxPublisherService(
      prismaMock as unknown as PrismaService,
      rabbitMqServiceMock as unknown as RabbitMqService,
    );
  });

  it('should publish a pending USER_REGISTERED event successfully', async () => {
    const event = {
      id: 'event-123',
      eventType: 'USER_REGISTERED',
      payload: {
        userId: 'user-123',
        email: 'master@example.com',
        displayName: 'Master User',
      },
    };

    prismaMock.outboxEvent.findMany.mockResolvedValueOnce([event]);
    prismaMock.outboxEvent.update.mockResolvedValueOnce({ ...event });

    channelMock.publish.mockImplementationOnce(
      (_exchange, _routingKey, _message, _options, callback) => {
        callback(null);
        return true;
      },
    );

    await service['processPendingEvents']();

    expect(prismaMock.outboxEvent.findMany).toHaveBeenCalledTimes(1);

    expect(channelMock.publish).toHaveBeenCalledTimes(1);
    expect(channelMock.publish).toHaveBeenCalledWith(
      'events',
      'user.registered',
      expect.any(Buffer),
      expect.objectContaining({
        mandatory: true,
        persistent: true,
        messageId: event.id,
      }),
      expect.any(Function),
    );

    const [, , messageBuffer] = channelMock.publish.mock.calls[0];
    expect(JSON.parse(messageBuffer.toString())).toEqual(event.payload);

    expect(prismaMock.outboxEvent.update).toHaveBeenCalledWith({
      where: { id: event.id },
      data: {
        publishedAt: expect.any(Date),
      },
    });

    expect(prismaMock.outboxEvent.update).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          attempts: expect.anything(),
          lastError: expect.anything(),
        }),
      }),
    );
  });

  it('should record an error when RabbitMQ returns an unroutable message', async () => {
    const event = {
      id: 'event-456',
      eventType: 'USER_REGISTERED',
      payload: {
        userId: 'user-456',
        email: 'user@example.com',
        displayName: 'Test User',
      },
    };

    prismaMock.outboxEvent.findMany.mockResolvedValueOnce([event]);

    channelMock.publish.mockImplementationOnce(
      (_exchange, _routingKey, _message, _options, callback) => {
        returnListener?.({
          properties: { messageId: event.id },
          fields: {
            exchange: 'events',
            routingKey: 'user.registered',
          },
        });

        callback(null);
        return true;
      },
    );

    await service['processPendingEvents']();

    expect(prismaMock.outboxEvent.update).toHaveBeenCalledTimes(1);
    expect(prismaMock.outboxEvent.update).toHaveBeenCalledWith({
      where: { id: event.id },
      data: {
        attempts: { increment: 1 },
        lastError: expect.stringContaining('unroutable message'),
      },
    });
  });

  it('should not process events when RabbitMQ is not ready', async () => {
    rabbitMqServiceMock.isReady = false;

    await service['processPendingEvents']();

    expect(prismaMock.outboxEvent.findMany).not.toHaveBeenCalled();
    expect(channelMock.publish).not.toHaveBeenCalled();
    expect(prismaMock.outboxEvent.update).not.toHaveBeenCalled();
  });

  it('should record an error for an unknown event type', async () => {
    const event = {
      id: 'event-789',
      eventType: 'UNKNOWN_EVENT',
      payload: {},
    };

    prismaMock.outboxEvent.findMany.mockResolvedValueOnce([event]);

    await service['processPendingEvents']();

    expect(channelMock.publish).not.toHaveBeenCalled();

    expect(prismaMock.outboxEvent.update).toHaveBeenCalledWith({
      where: { id: event.id },
      data: {
        attempts: { increment: 1 },
        lastError: expect.stringContaining('Unknown event type'),
      },
    });
  });

  it('should prevent concurrent processing cycles', async () => {
    let resolveFindMany!: (events: any[]) => void;

    prismaMock.outboxEvent.findMany.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFindMany = resolve;
        }),
    );

    const firstProcessing = service['processPendingEvents']();

    await Promise.resolve();

    await service['processPendingEvents']();

    expect(prismaMock.outboxEvent.findMany).toHaveBeenCalledTimes(1);

    resolveFindMany([]);
    await firstProcessing;
  });

  it('should release the processing lock when fetching events fails', async () => {
    prismaMock.outboxEvent.findMany.mockRejectedValueOnce(
      new Error('Database connection failed'),
    );

    await expect(service['processPendingEvents']()).rejects.toThrow(
      'Database connection failed',
    );

    prismaMock.outboxEvent.findMany.mockResolvedValueOnce([]);

    await expect(service['processPendingEvents']()).resolves.toBeUndefined();

    expect(prismaMock.outboxEvent.findMany).toHaveBeenCalledTimes(2);
  });

  it('should clean up resources on module destroy', async () => {
    jest.useFakeTimers();

    const event = {
      id: 'event-cleanup',
      eventType: 'USER_REGISTERED',
      payload: {
        userId: 'user-cleanup',
        email: 'cleanup@example.com',
        displayName: 'Cleanup User',
      },
    };

    prismaMock.outboxEvent.findMany.mockResolvedValueOnce([event]);

    channelMock.publish.mockImplementationOnce(
      (_exchange, _routingKey, _message, _options, callback) => {
        callback(null);
        return true;
      },
    );

    await service['processPendingEvents']();

    const listener = returnListener;

    expect(listener).toBeDefined();

    listener?.({
      properties: { messageId: event.id },
      fields: {
        exchange: 'events',
        routingKey: 'user.registered',
      },
    });

    service.onModuleInit();

    expect(jest.getTimerCount()).toBe(1);

    service.onModuleDestroy();

    expect(jest.getTimerCount()).toBe(0);
    expect(channelMock.removeListener).toHaveBeenCalledWith('return', listener);
    expect(service['returnChannel']).toBeNull();
    expect(service['returnListener']).toBeNull();
    expect(service['returnedMessages'].size).toBe(0);

    jest.useRealTimers();
  });

  it('should record an error when RabbitMQ publisher confirmation fails', async () => {
    const event = {
      id: 'event-confirm-failure',
      eventType: 'USER_REGISTERED',
      payload: {
        userId: 'user-confirm-failure',
        email: 'failure@example.com',
        displayName: 'Failure User',
      },
    };

    prismaMock.outboxEvent.findMany.mockResolvedValueOnce([event]);

    channelMock.publish.mockImplementationOnce(
      (_exchange, _routingKey, _message, _options, callback) => {
        callback(new Error('Publisher confirmation failed'));
        return true;
      },
    );

    await service['processPendingEvents']();

    expect(channelMock.publish).toHaveBeenCalledTimes(1);

    expect(prismaMock.outboxEvent.update).toHaveBeenCalledWith({
      where: { id: event.id },
      data: {
        attempts: { increment: 1 },
        lastError: 'Publisher confirmation failed',
      },
    });
  });
});
