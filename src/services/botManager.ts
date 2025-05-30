import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import EventEmitter from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { botConfig, PUMPFUN_FEE_PERCENTAGE, WALLET_DIRECTORY } from '../config/botConfig.js';
import { BotState, BotStatus, TokenCreationResult } from '../types/index.js';
import logger from '../utils/logger.js';
import { withRetry } from '../utils/retry.js';
import {
  createWallet,
  getBalance,
  getTokenBalance,
  getTotalProfit,
  loadWallet,
  saveProfitData,
  saveWallet,
  transferAllSol,
} from '../utils/wallet.js';
import { generateTokenImage, generateTokenMetadata, uploadToIPFS } from './metadataGenerator.js';
import { createToken, sellTokens } from './tokenService.js';
import { monitorTokenTransactionsWebsocket, TransactionType } from './transactionMonitor.js';

export class BotManager extends EventEmitter {
  private connection: Connection;
  private status: BotStatus;
  private wallet?: Keypair;
  private previousWallet?: Keypair;
  private currentMint?: PublicKey;
  private sellTimer?: NodeJS.Timeout;
  private stopMonitoringFn?: () => void;
  private isShuttingDown = false;
  private someoneBought = false;
  private isSellingTokens = false;
  private initialBalance = 0; // Track initial balance for profit calculation

  constructor(connection: Connection) {
    super();
    this.connection = connection;
    this.status = {
      state: BotState.INITIALIZING,
      cycleId: 0,
      walletAddress: '',
      balance: 0,
      startTime: Date.now(),
      lastActivity: Date.now(),
    };

    // Setup graceful shutdown handlers
    process.on('SIGINT', () => this.shutdown('SIGINT'));
    process.on('SIGTERM', () => this.shutdown('SIGTERM'));
  }

  /**
   * Gets the current bot status
   */
  getStatus(): BotStatus {
    return { ...this.status };
  }

  /**
   * Starts a new trading cycle
   */
  async startCycle(): Promise<void> {
    if (this.isShuttingDown) {
      logger.warning('Bot is shutting down, cannot start new cycle');
      return;
    }

    try {
      this.updateState(BotState.INITIALIZING);
      logger.startCycle();

      this.status.cycleId = logger.getCurrentCycleId();
      this.status.startTime = Date.now();

      logger.info('Starting new trading cycle...');

      // Initialize wallet
      await this.initializeWallet();

      // Create token
      this.updateState(BotState.CREATING_TOKEN);
      const tokenResult = await this.createNewToken();

      // Start monitoring
      this.updateState(BotState.MONITORING);
      await this.startMonitoring(tokenResult);
    } catch (error) {
      this.updateState(BotState.ERROR);
      logger.error('Error in trading cycle:', error);
      await this.cleanup();

      // Restart after delay if not shutting down
      if (!this.isShuttingDown) {
        setTimeout(() => this.startCycle(), 5000);
      }
    }
  }

  /**
   * Initialize wallet and transfer funds from previous wallet
   */
  private async initializeWallet(): Promise<void> {
    // Create new wallet
    this.wallet = createWallet();
    const walletPath = saveWallet(this.wallet);

    this.status.walletAddress = this.wallet.publicKey.toBase58();
    logger.info(`Created new wallet: ${logger.formatWallet(this.wallet.publicKey)}`);

    // Find and transfer from previous wallet
    const previousWallets = this.findPreviousWallets(walletPath);

    if (previousWallets.length > 0) {
      this.previousWallet = loadWallet(previousWallets[0]);
      logger.info(`Found previous wallet: ${logger.formatWallet(this.previousWallet.publicKey)}`);

      const balance = await withRetry(() =>
        getBalance(this.connection, this.previousWallet!.publicKey),
      );

      const minRequiredBalance = this.calculateMinRequiredBalance();

      if (balance >= minRequiredBalance) {
        logger.info(`Transferring ${balance} SOL to new wallet...`);

        const signature = await withRetry(() =>
          transferAllSol(this.connection, this.previousWallet!, this.wallet!.publicKey),
        );

        logger.success(`Transfer complete. Signature: ${logger.formatTx(signature)}`);
        await this.connection.confirmTransaction(signature);

        this.status.balance = await getBalance(this.connection, this.wallet.publicKey);
      } else {
        throw new Error(
          `Insufficient balance: ${balance} SOL. Required: ${minRequiredBalance} SOL`,
        );
      }
    } else {
      throw new Error('No previous wallet found. Please fund the wallet manually.');
    }

    // Store initial balance for profit calculation
    this.initialBalance = await getBalance(this.connection, this.wallet.publicKey);
    logger.debug(`Initial balance for cycle: ${this.initialBalance.toFixed(6)} SOL`);
  }

  /**
   * Create a new token with metadata
   */
  private async createNewToken(): Promise<TokenCreationResult> {
    if (!this.wallet) {
      throw new Error('Wallet not initialized');
    }

    logger.info('Generating token metadata and image...');

    const [metadata, mint] = await Promise.all([
      generateTokenMetadata(),
      Promise.resolve(Keypair.generate()),
    ]);

    const imageUrl = await generateTokenImage(metadata.name, metadata.symbol);
    const metadataUri = await uploadToIPFS(
      {
        ...metadata,
        showName: true,
        createdOn: 'https://pump.fun',
      },
      imageUrl,
    );

    logger.info(`Creating token: ${metadata.name} (${metadata.symbol})`);
    logger.info(`Mint address: ${logger.formatToken(mint.publicKey)}`);

    const signature = await withRetry(() =>
      createToken(this.connection, this.wallet!, mint, metadata.name, metadata.symbol, metadataUri),
    );

    this.currentMint = mint.publicKey;
    this.status.currentToken = mint.publicKey.toBase58();

    logger.success(`Token created! Signature: ${logger.formatTx(signature)}`);

    return {
      signature,
      mintAddress: mint.publicKey.toBase58(),
      metadataUri,
    };
  }

  /**
   * Start monitoring for token transactions
   */
  private async startMonitoring(tokenResult: TokenCreationResult): Promise<void> {
    if (!this.wallet || !this.currentMint) {
      throw new Error('Wallet or mint not initialized');
    }

    this.someoneBought = false;
    this.isSellingTokens = false;

    // Set sell timeout
    this.sellTimer = setTimeout(() => {
      this.handleSellTimeout();
    }, botConfig.trading.sellTimeoutMs);

    // Start monitoring for external purchases
    logger.info(`Monitoring token transactions for ${botConfig.trading.sellTimeoutMs / 1000}s...`);
    this.stopMonitoringFn = monitorTokenTransactionsWebsocket(
      this.connection,
      this.currentMint,
      (transaction) => {
        // Check transaction age
        const currentTime = Date.now() / 1000;
        const transactionAge = currentTime - transaction.timestamp;

        if (transactionAge > botConfig.monitoring.maxTransactionAge) {
          return; // Skip old transactions
        }

        logger.success(
          `External buy detected! Transaction age: ${transactionAge.toFixed(
            2,
          )}s. Selling tokens...`,
        );
        this.sellAllTokens('external_buy');
      },
      this.wallet.publicKey, // Exclude our own transactions
    );
  }

  /**
   * Handle incoming transactions
   */
  private async handleTransaction(transaction: any): Promise<void> {
    if (this.isSellingTokens || this.someoneBought || this.isShuttingDown) {
      return;
    }

    if (
      transaction.type === TransactionType.BUY &&
      transaction.buyer &&
      !transaction.buyer.equals(this.wallet!.publicKey)
    ) {
      const transactionAge = Date.now() / 1000 - transaction.timestamp;

      if (transactionAge <= botConfig.monitoring.maxTransactionAge) {
        logger.success(
          `External buy detected! Transaction age: ${transactionAge.toFixed(
            2,
          )}s. Selling tokens...`,
        );
        await this.sellAllTokens('external_buy');
      } else {
        logger.warning(`Ignoring old transaction (${transactionAge.toFixed(2)}s old)`);
      }
    }
  }

  /**
   * Handle sell timeout
   */
  private async handleSellTimeout(): Promise<void> {
    if (!this.someoneBought && !this.isSellingTokens) {
      logger.cycle(
        `Sell timeout reached (${botConfig.trading.sellTimeoutMs / 1000}s). Selling tokens...`,
      );
      await this.sellAllTokens('timeout');
    }
  }

  /**
   * Sell all tokens and calculate profit
   */
  private async sellAllTokens(reason: string): Promise<void> {
    if (this.isSellingTokens || !this.wallet || !this.currentMint) {
      return;
    }

    try {
      this.updateState(BotState.SELLING);
      this.isSellingTokens = true;
      this.someoneBought = true;

      // Clear sell timer
      if (this.sellTimer) {
        clearTimeout(this.sellTimer);
        this.sellTimer = undefined;
      }

      // Track balance before selling
      const balanceBeforeSell = await getBalance(this.connection, this.wallet.publicKey);
      logger.debug(`Balance before selling: ${balanceBeforeSell.toFixed(6)} SOL`);

      // Get token balance
      const tokenBalance = await withRetry(() =>
        getTokenBalance(this.connection, this.currentMint!, this.wallet!.publicKey),
      );

      logger.debug(`Token balance to sell: ${tokenBalance.toFixed(6)} tokens`);

      if (tokenBalance > 0) {
        const signature = await withRetry(() =>
          sellTokens(this.connection, this.wallet!, this.currentMint!.toBase58(), tokenBalance),
        );

        logger.success(`Tokens sold! Signature: ${logger.formatTx(signature)}`);

        // Wait for transaction to settle and check balance after selling
        await new Promise((resolve) => setTimeout(resolve, 3000));
        const balanceAfterSell = await getBalance(this.connection, this.wallet.publicKey);
        const solReceived = balanceAfterSell - balanceBeforeSell;

        logger.debug(
          `Balance after selling: ${balanceAfterSell.toFixed(
            6,
          )} SOL (received ${solReceived.toFixed(6)} SOL from sale)`,
        );
      } else {
        logger.warning('No tokens to sell');
      }

      // Calculate profit
      this.updateState(BotState.CALCULATING_PROFIT);
      await this.calculateProfit();

      // Clean up and start next cycle
      await this.cleanup();

      if (!this.isShuttingDown) {
        setTimeout(() => this.startCycle(), 5000);
      }
    } catch (error) {
      logger.error('Error selling tokens:', error);
      await this.cleanup();
    }
  }

  /**
   * Calculate and log profit for the cycle
   */
  private async calculateProfit(): Promise<void> {
    if (!this.wallet) {
      return;
    }

    try {
      // Wait a moment for any pending transactions to settle
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Get final balance after selling
      const finalBalance = await getBalance(this.connection, this.wallet.publicKey);

      logger.debug(
        `Balance tracking: Initial=${this.initialBalance.toFixed(
          6,
        )} SOL, Final=${finalBalance.toFixed(6)} SOL`,
      );

      // Calculate profit = final - initial
      const profit = finalBalance - this.initialBalance;

      // Validate the profit calculation
      if (Math.abs(profit) > this.initialBalance * 0.5) {
        logger.warning(
          `Suspicious profit calculation detected! ` +
            `Loss of ${Math.abs(profit).toFixed(6)} SOL (${(
              (Math.abs(profit) / this.initialBalance) *
              100
            ).toFixed(1)}%) seems too high. ` +
            `Initial: ${this.initialBalance.toFixed(6)} SOL, Final: ${finalBalance.toFixed(6)} SOL`,
        );
      }

      // Save profit data
      saveProfitData(
        this.status.cycleId,
        profit,
        this.currentMint?.toString(),
        this.initialBalance,
        finalBalance,
      );

      // Get total profit
      const { totalProfit, cycleCount } = getTotalProfit();

      // Log profit information
      const percentageChange = this.initialBalance > 0 ? (profit / this.initialBalance) * 100 : 0;
      const percentageInfo = ` (${percentageChange >= 0 ? '+' : ''}${percentageChange.toFixed(
        2,
      )}%)`;

      logger.profit(
        `Cycle #${this.status.cycleId} ${profit >= 0 ? 'PROFIT' : 'LOSS'}: ${profit.toFixed(
          6,
        )} SOL${percentageInfo}`,
      );
      logger.profit(
        `Initial: ${this.initialBalance.toFixed(6)} SOL → Final: ${finalBalance.toFixed(6)} SOL`,
      );
      logger.profit(
        `Total ${
          totalProfit >= 0 ? 'PROFIT' : 'LOSS'
        } across ${cycleCount} cycles: ${totalProfit.toFixed(6)} SOL`,
      );

      this.emit('profit', {
        cycleId: this.status.cycleId,
        profit,
        totalProfit,
        cycleCount,
      });
    } catch (error) {
      logger.error('Error calculating profit:', error);
    }
  }

  /**
   * Clean up resources
   */
  private async cleanup(): Promise<void> {
    this.updateState(BotState.CLEANING_UP);

    if (this.sellTimer) {
      clearTimeout(this.sellTimer);
      this.sellTimer = undefined;
    }

    if (this.stopMonitoringFn) {
      this.stopMonitoringFn();
      this.stopMonitoringFn = undefined;
    }

    logger.endCycle();
    this.emit('cycleEnd', this.status.cycleId);
  }

  /**
   * Graceful shutdown
   */
  private async shutdown(signal: string): Promise<void> {
    if (this.isShuttingDown) {
      return;
    }

    this.isShuttingDown = true;
    logger.warning(`Received ${signal}. Initiating graceful shutdown...`);

    await this.cleanup();
    logger.info('Bot shutdown complete');
    process.exit(0);
  }

  /**
   * Helper methods
   */
  private updateState(state: BotState): void {
    this.status.state = state;
    this.status.lastActivity = Date.now();
    this.emit('stateChange', state);
  }

  private findPreviousWallets(currentWalletPath: string): string[] {
    if (!fs.existsSync(WALLET_DIRECTORY)) {
      return [];
    }

    return fs
      .readdirSync(WALLET_DIRECTORY)
      .filter((file) => file.endsWith('.json') && file !== path.basename(currentWalletPath))
      .map((file) => path.join(WALLET_DIRECTORY, file))
      .sort((a, b) => fs.statSync(b).mtime.getTime() - fs.statSync(a).mtime.getTime());
  }

  private calculateMinRequiredBalance(): number {
    const pumpfunFee = botConfig.trading.minSolAmount * PUMPFUN_FEE_PERCENTAGE;
    return botConfig.trading.minSolAmount + pumpfunFee + botConfig.trading.transactionFeeBuffer;
  }
}
