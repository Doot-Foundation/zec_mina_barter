import { Field, Poseidon } from 'o1js';

/**
 * Converts UUID string to Field using Poseidon hash
 * UUID format: "550e8400-e29b-41d4-a716-446655440000"
 *
 * @param uuid - UUID string (with or without hyphens)
 * @returns Field representation of UUID
 */
export function uuidToField(uuid: string): Field {
  // Remove hyphens and convert to lowercase
  const normalized = uuid.replace(/-/g, '').toLowerCase();

  // Split into chunks and convert to Fields
  // UUID is 32 hex chars = 128 bits, split into 4 chunks of 8 chars (32 bits each)
  const chunks: Field[] = [];
  for (let i = 0; i < normalized.length; i += 8) {
    const chunk = normalized.slice(i, i + 8);
    const value = BigInt('0x' + chunk);
    chunks.push(Field(value));
  }

  // Hash all chunks together to get single Field
  return Poseidon.hash(chunks);
}

/**
 * Generates a deterministic port number from trade UUID
 * Used to determine which escrowd instance port to query
 *
 * @param tradeId - Trade UUID as string
 * @param basePort - Base port number (default: 8000)
 * @param portRange - Number of ports available (default: 10000)
 * @returns Port number between basePort and basePort + portRange
 */
export function tradeIdToPort(
  tradeId: string,
  basePort: number = 8000,
  portRange: number = 10000
): number {
  const field = uuidToField(tradeId);
  const hash = field.toBigInt();
  const port = Number(hash % BigInt(portRange)) + basePort;
  return port;
}

/**
 * Converts MINA amount from decimal to nanomina (10^9)
 *
 * @param mina - MINA amount as number or string
 * @returns Nanomina as bigint
 */
export function minaToNanomina(mina: number | string): bigint {
  const amount = typeof mina === 'string' ? parseFloat(mina) : mina;
  return BigInt(Math.floor(amount * 1e9));
}

/**
 * Converts nanomina to MINA decimal amount
 *
 * @param nanomina - Nanomina amount as bigint or string
 * @returns MINA as number
 */
export function nanominaToMina(nanomina: bigint | string): number {
  const amount = typeof nanomina === 'string' ? BigInt(nanomina) : nanomina;
  return Number(amount) / 1e9;
}

/**
 * Validates UUID format
 *
 * @param uuid - UUID string to validate
 * @returns true if valid UUID format
 */
export function isValidUUID(uuid: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(uuid);
}

/**
 * Generates a random UUID v4
 * Note: In production middleware, use crypto.randomUUID() instead
 *
 * @returns UUID string
 */
export function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
