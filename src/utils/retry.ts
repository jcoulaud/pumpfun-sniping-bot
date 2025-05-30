import { botConfig } from '../config/botConfig.js';
import logger from './logger.js';

export interface RetryOptions {
  maxAttempts?: number;
  baseDelay?: number;
  maxDelay?: number;
  exponentialBase?: number;
  onRetry?: (error: Error, attempt: number) => void;
}

/**
 * Executes a function with retry logic and exponential backoff
 */
export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const {
    maxAttempts = botConfig.monitoring.retryAttempts,
    baseDelay = botConfig.monitoring.retryDelay,
    maxDelay = 30000,
    exponentialBase = 2,
    onRetry,
  } = options;

  let lastError: Error;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;

      if (attempt === maxAttempts) {
        logger.error(`Failed after ${maxAttempts} attempts:`, lastError);
        throw lastError;
      }

      const delay = Math.min(baseDelay * Math.pow(exponentialBase, attempt - 1), maxDelay);

      logger.warning(
        `Attempt ${attempt}/${maxAttempts} failed: ${lastError.message}. Retrying in ${delay}ms...`,
      );

      if (onRetry) {
        onRetry(lastError, attempt);
      }

      await sleep(delay);
    }
  }

  throw lastError!;
}

/**
 * Sleep utility function
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retry wrapper specifically for Solana transactions
 */
export async function withTransactionRetry<T>(fn: () => Promise<T>, context: string): Promise<T> {
  return withRetry(fn, {
    onRetry: (error, attempt) => {
      logger.warning(`${context} - Attempt ${attempt} failed: ${error.message}`);
    },
  });
}

/**
 * Checks if an error is retryable
 */
export function isRetryableError(error: Error): boolean {
  const retryableMessages = [
    'network error',
    'timeout',
    'connection',
    'temporary failure',
    'rate limit',
    'too many requests',
    '429',
    '502',
    '503',
    '504',
  ];

  const errorMessage = error.message.toLowerCase();
  return retryableMessages.some((msg) => errorMessage.includes(msg));
}

/**
 * Conditional retry - only retries if error is retryable
 */
export async function withConditionalRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const {
    maxAttempts = botConfig.monitoring.retryAttempts,
    baseDelay = botConfig.monitoring.retryDelay,
    onRetry,
  } = options;

  let lastError: Error;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;

      // Don't retry if error is not retryable or if this is the last attempt
      if (!isRetryableError(lastError) || attempt === maxAttempts) {
        throw lastError;
      }

      const delay = baseDelay * Math.pow(2, attempt - 1);

      logger.warning(
        `Retryable error on attempt ${attempt}/${maxAttempts}: ${lastError.message}. Retrying in ${delay}ms...`,
      );

      if (onRetry) {
        onRetry(lastError, attempt);
      }

      await sleep(delay);
    }
  }

  throw lastError!;
}
