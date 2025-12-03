// @ts-nocheck - Test file with complex mocks
import {
  describe,
  it,
  expect,
  beforeEach,
  jest,
  afterEach,
} from '@jest/globals';

// Mock dependencies
const mockGetEscrowdUrl = jest.fn() as any;
const mockGetEscrowdPort = jest.fn() as any;

jest.unstable_mockModule('../../src/config.js', () => ({
  config: {
    escrowd: {
      basePort: 15000,
      portRange: 10000,
    },
  },
  getEscrowdUrl: mockGetEscrowdUrl,
  getEscrowdPort: mockGetEscrowdPort,
}));

// Mock logger
const mockLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
};
jest.unstable_mockModule('../../src/logger.js', () => ({
  logger: mockLogger,
}));

// Mock global fetch
const mockFetch = jest.fn() as any;
global.fetch = mockFetch;

describe('PortManager', () => {
  let PortManager: any;
  let portManager: any;

  beforeEach(async () => {
    jest.clearAllMocks();

    // Clear all timers
    jest.clearAllTimers();

    // Import after mocks are set up
    const module = await import('../../src/port-manager.js');
    PortManager = module.PortManager;

    // Create new instance
    portManager = new PortManager();

    // Reset all mocks
    mockGetEscrowdUrl.mockReset();
    mockGetEscrowdPort.mockReset();
    mockFetch.mockReset();
    mockLogger.info.mockReset();
    mockLogger.warn.mockReset();
    mockLogger.error.mockReset();
    mockLogger.debug.mockReset();
  });

  describe('isPortAvailable() - port occupied scenarios', () => {
    it('should return false when port responds with HTTP 200', async () => {
      const tradeId = '550e8400-e29b-41d4-a716-446655440000';
      mockGetEscrowdUrl.mockReturnValue('http://localhost:15234/status');

      mockFetch.mockResolvedValue({
        status: 200,
        ok: true,
      });

      const isAvailable = await portManager.isPortAvailable(tradeId);

      expect(isAvailable).toBe(false);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:15234/status',
        expect.objectContaining({
          method: 'GET',
          headers: { 'Content-Type': 'application/json' },
        })
      );
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining(`Port for trade ${tradeId} is occupied`)
      );
    });

    it('should return false when port responds with HTTP 404', async () => {
      const tradeId = '550e8400-e29b-41d4-a716-446655440001';
      mockGetEscrowdUrl.mockReturnValue('http://localhost:15235/status');

      mockFetch.mockResolvedValue({
        status: 404,
        ok: false,
      });

      const isAvailable = await portManager.isPortAvailable(tradeId);

      expect(isAvailable).toBe(false);
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining('is occupied (HTTP 404)')
      );
    });

    it('should return false when port responds with HTTP 500', async () => {
      const tradeId = '550e8400-e29b-41d4-a716-446655440002';
      mockGetEscrowdUrl.mockReturnValue('http://localhost:15236/status');

      mockFetch.mockResolvedValue({
        status: 500,
        ok: false,
      });

      const isAvailable = await portManager.isPortAvailable(tradeId);

      expect(isAvailable).toBe(false);
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining('is occupied (HTTP 500)')
      );
    });
  });

  describe('isPortAvailable() - port available scenarios', () => {
    it('should return true when fetch is aborted (timeout)', async () => {
      const tradeId = '550e8400-e29b-41d4-a716-446655440003';
      mockGetEscrowdUrl.mockReturnValue('http://localhost:15237/status');

      const abortError = new Error('The operation was aborted');
      abortError.name = 'AbortError';
      mockFetch.mockRejectedValue(abortError);

      const isAvailable = await portManager.isPortAvailable(tradeId);

      expect(isAvailable).toBe(true);
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining(`Port for trade ${tradeId} is available`)
      );
    });

    it('should return true when connection is refused (ECONNREFUSED)', async () => {
      const tradeId = '550e8400-e29b-41d4-a716-446655440004';
      mockGetEscrowdUrl.mockReturnValue('http://localhost:15238/status');

      const connError = new Error('connect ECONNREFUSED 127.0.0.1:15238');
      connError.code = 'ECONNREFUSED';
      mockFetch.mockRejectedValue(connError);

      const isAvailable = await portManager.isPortAvailable(tradeId);

      expect(isAvailable).toBe(true);
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining('is available')
      );
    });

    it('should return true when network is unreachable', async () => {
      const tradeId = '550e8400-e29b-41d4-a716-446655440005';
      mockGetEscrowdUrl.mockReturnValue('http://localhost:15239/status');

      const networkError = new Error('Network unreachable');
      mockFetch.mockRejectedValue(networkError);

      const isAvailable = await portManager.isPortAvailable(tradeId);

      expect(isAvailable).toBe(true);
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining('is available')
      );
    });

    it('should return true on unexpected errors in outer catch', async () => {
      const tradeId = '550e8400-e29b-41d4-a716-446655440006';
      // Cause getEscrowdUrl to throw an error
      mockGetEscrowdUrl.mockImplementation(() => {
        throw new Error('Unexpected error in getEscrowdUrl');
      });

      const isAvailable = await portManager.isPortAvailable(tradeId);

      expect(isAvailable).toBe(true);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining(`Port check failed for ${tradeId}`)
      );
    });
  });

  describe('logCollision()', () => {
    it('should log warning message with collision details', () => {
      const tradeId = '550e8400-e29b-41d4-a716-446655440007';
      const port = 15240;

      portManager.logCollision(tradeId, port);

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('PORT COLLISION')
      );
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining(tradeId)
      );
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining(`port ${port}`)
      );
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Trade will be skipped')
      );
    });
  });

  describe('Integration tests', () => {
    it('should properly clear timeout on successful fetch', async () => {
      const tradeId = '550e8400-e29b-41d4-a716-446655440008';
      mockGetEscrowdUrl.mockReturnValue('http://localhost:15241/status');

      let timeoutCleared = false;
      const originalClearTimeout = global.clearTimeout;
      global.clearTimeout = jest.fn((id) => {
        timeoutCleared = true;
        originalClearTimeout(id);
      });

      mockFetch.mockResolvedValue({
        status: 200,
        ok: true,
      });

      await portManager.isPortAvailable(tradeId);

      expect(global.clearTimeout).toHaveBeenCalled();
      expect(timeoutCleared).toBe(true);

      // Restore
      global.clearTimeout = originalClearTimeout;
    });

    it('should properly clear timeout on failed fetch', async () => {
      const tradeId = '550e8400-e29b-41d4-a716-446655440009';
      mockGetEscrowdUrl.mockReturnValue('http://localhost:15242/status');

      let timeoutCleared = false;
      const originalClearTimeout = global.clearTimeout;
      global.clearTimeout = jest.fn((id) => {
        timeoutCleared = true;
        originalClearTimeout(id);
      });

      mockFetch.mockRejectedValue(new Error('Connection refused'));

      await portManager.isPortAvailable(tradeId);

      expect(global.clearTimeout).toHaveBeenCalled();
      expect(timeoutCleared).toBe(true);

      // Restore
      global.clearTimeout = originalClearTimeout;
    });
  });
});
