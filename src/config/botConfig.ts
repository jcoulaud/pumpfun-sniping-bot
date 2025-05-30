import { clusterApiUrl } from '@solana/web3.js';
import dotenv from 'dotenv';
import { BotConfig } from '../types/index.js';

// Load environment variables
dotenv.config();

/**
 * Validates and creates the bot configuration
 */
export function createBotConfig(): BotConfig {
  // Validate required environment variables
  const requiredEnvVars = ['HELIUS_API_KEY', 'PINATA_JWT', 'PINATA_GATEWAY', 'OPENAI_API_KEY'];
  const missingVars = requiredEnvVars.filter((varName) => !process.env[varName]);

  if (missingVars.length > 0) {
    throw new Error(`Missing required environment variables: ${missingVars.join(', ')}`);
  }

  const rpcUrl = process.env.HELIUS_API_KEY
    ? `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`
    : clusterApiUrl('mainnet-beta');

  return {
    connection: {
      rpcUrl,
      commitment: 'confirmed',
    },
    trading: {
      minSolAmount: parseFloat(process.env.MIN_SOL_AMOUNT || '0.1'),
      maxSolAmount: parseFloat(process.env.MAX_SOL_AMOUNT || '0.5'),
      slippageBasisPoints: parseInt(process.env.SLIPPAGE_BASIS_POINTS || '500', 10),
      sellTimeoutMs: parseInt(process.env.SELL_TIMEOUT_SECONDS || '20', 10) * 1000,
      transactionFeeBuffer: parseFloat(process.env.TRANSACTION_FEE_BUFFER || '0.01'),
    },
    monitoring: {
      maxTransactionAge: parseInt(process.env.MAX_TRANSACTION_AGE_SECONDS || '30', 10),
      confirmationTimeout: parseInt(process.env.CONFIRMATION_TIMEOUT_MS || '30000', 10),
      retryAttempts: parseInt(process.env.RETRY_ATTEMPTS || '3', 10),
      retryDelay: parseInt(process.env.RETRY_DELAY_MS || '1000', 10),
    },
  };
}

/**
 * Validates the bot configuration
 */
export function validateBotConfig(config: BotConfig): void {
  const { trading, monitoring } = config;

  // Keep these for backwards compatibility, but they're not used in main logic anymore
  if (trading.minSolAmount <= 0 || trading.maxSolAmount <= 0) {
    throw new Error('SOL amounts must be positive numbers');
  }

  if (trading.slippageBasisPoints < 0 || trading.slippageBasisPoints > 10000) {
    throw new Error('Slippage basis points must be between 0 and 10000');
  }

  if (trading.sellTimeoutMs < 1000) {
    throw new Error('Sell timeout must be at least 1 second');
  }

  if (monitoring.retryAttempts < 1 || monitoring.retryAttempts > 10) {
    throw new Error('Retry attempts must be between 1 and 10');
  }

  if (monitoring.retryDelay < 100) {
    throw new Error('Retry delay must be at least 100ms');
  }
}

// Create and validate configuration
export const botConfig = (() => {
  const config = createBotConfig();
  validateBotConfig(config);
  return config;
})();

// Constants
export const WALLET_DIRECTORY = './wallets';
export const PUMPFUN_FEE_PERCENTAGE = 0.01;
