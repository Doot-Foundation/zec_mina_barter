/**
 * Test fixture addresses for integration tests
 * These are realistic-looking addresses for testing purposes
 */

export const FIXTURE_ADDRESSES = {
  alice: {
    mina: 'B62qkDepositor1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZabcd',
    zec: 't1Alice1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZabcd',
    privateKey: 'EKEo6xfJePfpzqYCsB8BUwENsHbMGK1jFZGmLHKqLQPRwHTEEJH5',
  },
  bob: {
    mina: 'B62qkClaimant1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZabcd',
    zec: 't1Bob1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefgh',
    privateKey: 'EKFHtzKvGhST9bDtN1FuHj9gkT8azAmfF4nqcjB3yPJr2UyVvXjr',
  },
  operator: {
    mina: 'B62qkoGddv1djrxNY7CAdrNWkkjrU72BKCoAfdKxWUqYV5bWk5kej27',
    privateKey: 'EKFHtzKvGhST9bDtN1FuHj9gkT8azAmfF4nqcjB3yPJr2UyVvXjq',
  },
  deployer: {
    mina: 'B62qod2DugDjy9Jxhzd56gFS7npN8pWhanxxb36MLPzDDqtzzDyBy5z',
    privateKey: 'EKEQBfN8gYZdMJfJm1f1vJjZVPJz1WbYXQKZ1UQ9J7vqH7KqH7Kq',
  },
  zkApp: {
    mina: 'B62qrbDCjDYEypocUpG3m6eL62zcvexsaRjhSJp5JWUQeny1qVEKbyP',
    privateKey: 'EKFcEkKNVJQDLxGzPqW1F1F1F1F1F1F1F1F1F1F1F1F1F1F1F1F1',
  },
};

/**
 * Test keypair mappings for database tests
 */
export const FIXTURE_KEYPAIR_MAPPINGS = [
  {
    id: 1,
    zec_address: FIXTURE_ADDRESSES.alice.zec,
    mina_address: FIXTURE_ADDRESSES.alice.mina,
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
  },
  {
    id: 2,
    zec_address: FIXTURE_ADDRESSES.bob.zec,
    mina_address: FIXTURE_ADDRESSES.bob.mina,
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
  },
];
