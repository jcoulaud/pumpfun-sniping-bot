import { PublicKey } from '@solana/web3.js';
import chalk from 'chalk';

// Solscan base URLs
const SOLSCAN_BASE_URL = 'https://solscan.io';
const SOLSCAN_TX_URL = `${SOLSCAN_BASE_URL}/tx`;
const SOLSCAN_ACCOUNT_URL = `${SOLSCAN_BASE_URL}/account`;
const SOLSCAN_TOKEN_URL = `${SOLSCAN_BASE_URL}/token`;

// Cycle tracking
let currentCycleId = 0;
let cycleStartTime = Date.now();

/**
 * Logger levels
 */
export enum LogLevel {
  INFO = 'info',
  SUCCESS = 'success',
  WARNING = 'warning',
  ERROR = 'error',
  DEBUG = 'debug',
  CYCLE = 'cycle',
}

/**
 * Start a new cycle with a unique ID
 */
export function startCycle(): number {
  currentCycleId++;
  cycleStartTime = Date.now();

  const divider = chalk.cyan('='.repeat(80));
  console.log('\n' + divider);
  console.log(chalk.cyan.bold(`🔄 STARTING CYCLE #${currentCycleId}`));
  console.log(divider + '\n');

  return currentCycleId;
}

/**
 * End the current cycle and log the duration
 */
export function endCycle(): void {
  const duration = ((Date.now() - cycleStartTime) / 1000).toFixed(2);

  const divider = chalk.cyan('='.repeat(80));
  console.log('\n' + divider);
  console.log(chalk.cyan.bold(`✅ COMPLETED CYCLE #${currentCycleId} (${duration}s)`));
  console.log(divider + '\n');
}

/**
 * Format a wallet address with Solscan link
 */
export function formatWallet(wallet: string | PublicKey): string {
  const address = typeof wallet === 'string' ? wallet : wallet.toString();
  const shortAddress = `${address.slice(0, 4)}...${address.slice(-4)}`;
  return `${chalk.yellow(shortAddress)} ${chalk.blue(`(${SOLSCAN_ACCOUNT_URL}/${address})`)}`;
}

/**
 * Format a token address with Solscan link
 */
export function formatToken(token: string | PublicKey): string {
  const address = typeof token === 'string' ? token : token.toString();
  const shortAddress = `${address.slice(0, 4)}...${address.slice(-4)}`;
  return `${chalk.magenta(shortAddress)} ${chalk.blue(`(${SOLSCAN_TOKEN_URL}/${address})`)}`;
}

/**
 * Format a transaction signature with Solscan link
 */
export function formatTx(signature: string): string {
  const shortSig = `${signature.slice(0, 4)}...${signature.slice(-4)}`;
  return `${chalk.green(shortSig)} ${chalk.blue(`(${SOLSCAN_TX_URL}/${signature})`)}`;
}

/**
 * Log a message with the specified level
 */
export function log(level: LogLevel, message: string, data?: any): void {
  const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
  const cycleInfo = `[Cycle #${currentCycleId}]`;

  let formattedLevel: string;

  switch (level) {
    case LogLevel.INFO:
      formattedLevel = chalk.blue('INFO');
      break;
    case LogLevel.SUCCESS:
      formattedLevel = chalk.green('SUCCESS');
      break;
    case LogLevel.WARNING:
      formattedLevel = chalk.yellow('WARNING');
      break;
    case LogLevel.ERROR:
      formattedLevel = chalk.red('ERROR');
      break;
    case LogLevel.DEBUG:
      formattedLevel = chalk.gray('DEBUG');
      break;
    case LogLevel.CYCLE:
      formattedLevel = chalk.cyan('CYCLE');
      break;
    default:
      formattedLevel = chalk.white('LOG');
  }

  const prefix = `${chalk.gray(timestamp)} ${chalk.cyan(cycleInfo)} ${formattedLevel}`;
  console.log(`${prefix}: ${message}`);

  if (data) {
    console.log(chalk.gray('  Data:'), data);
  }
}

/**
 * Shorthand for info logs
 */
export function info(message: string, data?: any): void {
  log(LogLevel.INFO, message, data);
}

/**
 * Shorthand for success logs
 */
export function success(message: string, data?: any): void {
  log(LogLevel.SUCCESS, message, data);
}

/**
 * Shorthand for warning logs
 */
export function warning(message: string, data?: any): void {
  log(LogLevel.WARNING, message, data);
}

/**
 * Shorthand for error logs
 */
export function error(message: string, data?: any): void {
  log(LogLevel.ERROR, message, data);
}

/**
 * Shorthand for debug logs
 */
export function debug(message: string, data?: any): void {
  log(LogLevel.DEBUG, message, data);
}

/**
 * Shorthand for cycle-related logs
 */
export function cycle(message: string, data?: any): void {
  log(LogLevel.CYCLE, message, data);
}

export default {
  startCycle,
  endCycle,
  formatWallet,
  formatToken,
  formatTx,
  log,
  info,
  success,
  warning,
  error,
  debug,
  cycle,
};
