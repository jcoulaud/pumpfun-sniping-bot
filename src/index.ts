import { Connection } from '@solana/web3.js';
import dotenv from 'dotenv';
import fs from 'node:fs';
import { botConfig, WALLET_DIRECTORY } from './config/botConfig.js';
import { BotManager } from './services/botManager.js';
import logger from './utils/logger.js';

// Load environment variables
dotenv.config();

/**
 * Main application entry point
 */
async function main(): Promise<void> {
  try {
    // Validate configuration
    logger.info('Starting PumpFun Bot...');
    logger.info(`RPC URL: ${botConfig.connection.rpcUrl.replace(/api-key=[^&]+/, 'api-key=***')}`);
    logger.info(`Trading Strategy: 70-80% of wallet balance (max 2 SOL per trade)`);
    logger.info(`Sell Timeout: ${botConfig.trading.sellTimeoutMs / 1000}s`);
    logger.info(`Slippage: ${botConfig.trading.slippageBasisPoints / 100}%`);

    // Create wallet directory if it doesn't exist
    if (!fs.existsSync(WALLET_DIRECTORY)) {
      fs.mkdirSync(WALLET_DIRECTORY, { recursive: true });
      logger.info(`Created wallet directory: ${WALLET_DIRECTORY}`);
    }

    // Initialize Solana connection
    const connection = new Connection(botConfig.connection.rpcUrl, botConfig.connection.commitment);

    // Test connection
    const slot = await connection.getSlot();
    logger.info(`Connected to Solana RPC at slot: ${slot}`);

    // Create and start bot manager
    const botManager = new BotManager(connection);

    // Set up event listeners for monitoring
    botManager.on('stateChange', (state) => {
      logger.debug(`Bot state changed to: ${state}`);
    });

    botManager.on('profit', (data) => {
      logger.debug(`Profit calculated for cycle ${data.cycleId}: ${data.profit} SOL`);
    });

    botManager.on('cycleEnd', (cycleId) => {
      logger.debug(`Cycle ${cycleId} completed`);
    });

    // Start the first trading cycle
    await botManager.startCycle();
  } catch (error) {
    logger.error('Failed to start bot:', error);

    // Check for common configuration issues
    if (error instanceof Error) {
      if (error.message.includes('Missing required environment variables')) {
        logger.error('Please check your .env file and ensure all required variables are set');
        logger.error('Required: HELIUS_API_KEY, PINATA_JWT, OPENAI_API_KEY');
      } else if (error.message.includes('network')) {
        logger.error(
          'Network connection issue. Please check your internet connection and RPC endpoint',
        );
      } else if (error.message.includes('wallet')) {
        logger.error(
          'Wallet initialization failed. Please ensure you have a funded wallet or previous wallet files',
        );
      }
    }

    process.exit(1);
  }
}

// Handle unhandled promise rejections
process.on('unhandledRejection', (error: Error | unknown) => {
  logger.error('Unhandled promise rejection:', error);
  process.exit(1);
});

// Handle uncaught exceptions
process.on('uncaughtException', (error: Error) => {
  logger.error('Uncaught exception:', error);
  process.exit(1);
});

// Start the application
main().catch((error) => {
  logger.error('Unhandled error in main:', error);
  process.exit(1);
});
