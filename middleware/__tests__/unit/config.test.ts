import { describe, it, expect, beforeAll } from '@jest/globals';

describe('config', () => {
  beforeAll(() => {
    process.env.OPERATOR_PRIVATE_KEY =
      'EKFHtzKvGhST9bDtN1FuHj9gkT8azAmfF4nqcjB3yPJr2UyVvXjq';
    process.env.MINA_GRAPHQL_ENDPOINT = 'https://example.com/graphql';
    process.env.MINA_POOL_ADDRESS =
      'B62qqyR2krDKXTVVkUKToQjXeFm1WbVTadLc9XmZZkupG9YecCyWM44';
    process.env.ESCROWD_OPERATOR_TOKEN = 'token';
    process.env.SUPABASE_URL = 'https://supabase.example';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'supabase-key';
    process.env.ORACLE_API_KEY = 'oracle-key';
    process.env.ORACLE_SLIPPAGE_BPS = '500'; // 5%
  });

  it('loads required env and calculates deterministic port', async () => {
    const { config, getEscrowdPort } = await import('../../src/config.js');
    const tradeId = '550e8400-e29b-41d4-a716-446655440000';

    const port1 = getEscrowdPort(tradeId);
    const port2 = getEscrowdPort(tradeId);

    expect(port1).toBe(port2);
    expect(port1).toBeGreaterThanOrEqual(config.escrowd.basePort);
    expect(port1).toBeLessThan(config.escrowd.basePort + config.escrowd.portRange);
    expect(config.oracle.slippageBps).toBe(500);
  });
});
