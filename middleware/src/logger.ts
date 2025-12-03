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

export const logger = {
  debug(message: string, ...args: any[]) {
    if (shouldLog('debug')) {
      console.log(`[${timestamp()}] [DEBUG] ${message}`, ...args);
    }
  },

  info(message: string, ...args: any[]) {
    if (shouldLog('info')) {
      console.log(`[${timestamp()}] [INFO] ${message}`, ...args);
    }
  },

  warn(message: string, ...args: any[]) {
    if (shouldLog('warn')) {
      console.warn(`[${timestamp()}] [WARN] ${message}`, ...args);
    }
  },

  error(message: string, ...args: any[]) {
    if (shouldLog('error')) {
      console.error(`[${timestamp()}] [ERROR] ${message}`, ...args);
    }
  },
};
