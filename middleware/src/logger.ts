import { config } from './config.js';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const currentLevel = LOG_LEVELS[config.logging.level as LogLevel] ?? LOG_LEVELS.info;

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= currentLevel;
}

function timestamp(): string {
  return new Date().toISOString();
}

// ANSI color codes for better log visibility (lighter/softer tones)
export const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',

  // Component colors (lighter variations)
  settlement: '\x1b[35m',      // Magenta (Pink) - Settlement operations
  locking: '\x1b[32m',         // Green - Trade locking
  mina: '\x1b[34m',            // Blue - MINA blockchain operations
  zec: '\x1b[36m',             // Cyan - ZEC/Escrowdv2 operations
  oracle: '\x1b[33m',          // Yellow - Oracle price feeds
  port: '\x1b[90m',            // Gray - Port management
  api: '\x1b[35m',             // Magenta - API server
  coordinator: '\x1b[37m',     // White - Coordinator

  // Status colors
  success: '\x1b[32m',         // Green
  error: '\x1b[31m',           // Red
  warn: '\x1b[33m',            // Yellow
  info: '\x1b[36m',            // Cyan
};

export const logger = {
  debug(message: string, ...args: any[]) {
    if (shouldLog('debug')) {
      console.log(`[${timestamp()}] [DEBUG] ${message}${colors.reset}`, ...args);
    }
  },

  info(message: string, ...args: any[]) {
    if (shouldLog('info')) {
      console.log(`[${timestamp()}] [INFO] ${message}${colors.reset}`, ...args);
    }
  },

  warn(message: string, ...args: any[]) {
    if (shouldLog('warn')) {
      console.warn(`[${timestamp()}] [WARN] ${message}${colors.reset}`, ...args);
    }
  },

  error(message: string, ...args: any[]) {
    if (shouldLog('error')) {
      console.error(`[${timestamp()}] [ERROR] ${message}${colors.reset}`, ...args);
    }
  },
};
