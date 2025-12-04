import { config } from './config.js';

/**
 * Simple logger for settlement service
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

class Logger {
  private level: number;

  constructor(level: LogLevel = 'info') {
    this.level = LOG_LEVELS[level];
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVELS[level] >= this.level;
  }

  private format(level: LogLevel, message: string): string {
    const timestamp = new Date().toISOString();
    return `[${timestamp}] [${level.toUpperCase()}] ${message}`;
  }

  debug(message: string) {
    if (this.shouldLog('debug')) {
      console.log(this.format('debug', message));
    }
  }

  info(message: string) {
    if (this.shouldLog('info')) {
      console.log(this.format('info', message));
    }
  }

  warn(message: string) {
    if (this.shouldLog('warn')) {
      console.warn(this.format('warn', message));
    }
  }

  error(message: string) {
    if (this.shouldLog('error')) {
      console.error(this.format('error', message));
    }
  }
}

export const logger = new Logger(config.logging.level as LogLevel);
