import { describe, it, expect, beforeEach, jest } from '@jest/globals';

describe('logger', () => {
  const now = new Date('2024-01-01T00:00:00Z');

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(now);
    process.env.OPERATOR_PRIVATE_KEY =
      'EKFHtzKvGhST9bDtN1FuHj9gkT8azAmfF4nqcjB3yPJr2UyVvXjq';
    process.env.MINA_GRAPHQL_ENDPOINT = 'https://example.com/graphql';
    process.env.MINA_POOL_ADDRESS =
      'B62qqyR2krDKXTVVkUKToQjXeFm1WbVTadLc9XmZZkupG9YecCyWM44';
    process.env.ESCROWD_OPERATOR_TOKEN = 'token';
    process.env.SUPABASE_URL = 'https://supabase.example';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'supabase-key';
    process.env.ORACLE_API_KEY = 'oracle-key';
  });

  it('respects log level filtering', async () => {
    process.env.LOG_LEVEL = 'warn';
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const { logger } = await import('../../src/logger.js');

    logger.debug('debug-msg'); // should not print
    logger.info('info-msg'); // should not print
    logger.warn('warn-msg');
    logger.error('error-msg');

    expect(consoleSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledTimes(1);

    consoleSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });
});
