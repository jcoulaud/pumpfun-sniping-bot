import { getAccount, getAssociatedTokenAddressSync } from '@solana/spl-token';
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
} from '@solana/web3.js';
import bs58 from 'bs58';
import fs from 'node:fs';
import path from 'node:path';
import { WALLET_DIRECTORY } from '../config/botConfig.js';
import { CycleData, ProfitData, WalletData } from '../types/index.js';
import logger from './logger.js';

// Path for storing profit/loss data
const PNL_DIRECTORY = 'pnl';
const PROFIT_LOG_PATH = path.join(PNL_DIRECTORY, 'profit_log.json');

const DEFAULT_TOKEN_DECIMALS = 6;

/**
 * Creates a new Solana wallet
 */
export function createWallet(): Keypair {
  return Keypair.generate();
}

/**
 * Saves a wallet's keypair to a local file
 */
export function saveWallet(keypair: Keypair, filename?: string): string {
  // Create wallet directory if it doesn't exist
  if (!fs.existsSync(WALLET_DIRECTORY)) {
    fs.mkdirSync(WALLET_DIRECTORY, { recursive: true });
  }

  const walletName = filename || `wallet-${Date.now()}.json`;
  const walletPath = path.join(WALLET_DIRECTORY, walletName);

  // Save the keypair as a JSON file with both array and base58 formats
  const keyData: WalletData = {
    publicKey: keypair.publicKey.toString(),
    secretKey: Array.from(keypair.secretKey),
    secretKeyBase58: bs58.encode(keypair.secretKey),
  };

  try {
    fs.writeFileSync(walletPath, JSON.stringify(keyData, null, 2));
    return walletPath;
  } catch (error) {
    logger.error('Failed to save wallet:', error);
    throw new Error(`Failed to save wallet to ${walletPath}: ${error}`);
  }
}

/**
 * Loads a wallet from a local file
 */
export function loadWallet(filePath: string): Keypair {
  try {
    if (!fs.existsSync(filePath)) {
      throw new Error(`Wallet file not found: ${filePath}`);
    }

    const walletData = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

    // Try to load from secretKey array first
    if (Array.isArray(walletData.secretKey)) {
      return Keypair.fromSecretKey(Uint8Array.from(walletData.secretKey));
    }

    // If array not available, try to load from base58 string
    if (walletData.secretKeyBase58) {
      return Keypair.fromSecretKey(bs58.decode(walletData.secretKeyBase58));
    }

    throw new Error('Invalid wallet format: no valid secret key found');
  } catch (error) {
    logger.error(`Failed to load wallet from ${filePath}:`, error);
    throw error;
  }
}

/**
 * Transfers SOL from one wallet to another
 */
export async function transferSol(
  connection: Connection,
  fromWallet: Keypair,
  toWallet: PublicKey,
  amountSol: number,
): Promise<string> {
  if (amountSol <= 0) {
    throw new Error('Transfer amount must be positive');
  }

  try {
    // Get the recent blockhash
    const { blockhash } = await connection.getLatestBlockhash();

    // Create a transfer transaction
    const transaction = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: fromWallet.publicKey,
        toPubkey: toWallet,
        lamports: Math.floor(amountSol * LAMPORTS_PER_SOL),
      }),
    );

    // Set the transaction properties
    transaction.feePayer = fromWallet.publicKey;
    transaction.recentBlockhash = blockhash;

    // Sign and send the transaction
    transaction.sign(fromWallet);
    const signature = await connection.sendRawTransaction(transaction.serialize(), {
      skipPreflight: false,
      preflightCommitment: 'confirmed',
    });

    return signature;
  } catch (error) {
    logger.error('Failed to transfer SOL:', error);
    throw error;
  }
}

/**
 * Gets the SOL balance of a wallet
 */
export async function getBalance(connection: Connection, publicKey: PublicKey): Promise<number> {
  try {
    const balance = await connection.getBalance(publicKey);
    return balance / LAMPORTS_PER_SOL;
  } catch (error) {
    logger.error('Failed to get balance:', error);
    throw error;
  }
}

/**
 * Gets the token balance of a wallet for a specific mint
 */
export async function getTokenBalance(
  connection: Connection,
  mint: PublicKey,
  owner: PublicKey,
): Promise<number> {
  try {
    const associatedTokenAddress = getAssociatedTokenAddressSync(mint, owner, true);
    const tokenAccount = await getAccount(connection, associatedTokenAddress);
    return Number(tokenAccount.amount) / Math.pow(10, DEFAULT_TOKEN_DECIMALS);
  } catch (error) {
    // If account doesn't exist or has no tokens, return 0
    logger.debug('Token account not found or has no balance, returning 0');
    return 0;
  }
}

/**
 * Transfers all SOL from one wallet to another, minus fees
 */
export async function transferAllSol(
  connection: Connection,
  fromWallet: Keypair,
  toWallet: PublicKey,
): Promise<string> {
  try {
    // Get the balance of the source wallet
    const balance = await connection.getBalance(fromWallet.publicKey);

    // Calculate the amount to transfer (balance - fee)
    // Estimate the fee as 5000 lamports (0.000005 SOL)
    const fee = 5000;
    const transferAmount = balance - fee;

    if (transferAmount <= 0) {
      throw new Error('Insufficient balance to transfer after accounting for fees');
    }

    // Create and send the transfer transaction
    const { blockhash } = await connection.getLatestBlockhash();
    const transaction = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: fromWallet.publicKey,
        toPubkey: toWallet,
        lamports: transferAmount,
      }),
    );

    transaction.feePayer = fromWallet.publicKey;
    transaction.recentBlockhash = blockhash;

    transaction.sign(fromWallet);
    const signature = await connection.sendRawTransaction(transaction.serialize(), {
      skipPreflight: false,
      preflightCommitment: 'confirmed',
    });

    return signature;
  } catch (error) {
    logger.error('Failed to transfer all SOL:', error);
    throw error;
  }
}

/**
 * Calculates the profit/loss from a cycle
 */
export async function calculateCycleProfit(
  connection: Connection,
  initialBalance: number,
  finalBalance: number,
): Promise<number> {
  return finalBalance - initialBalance;
}

/**
 * Save profit/loss data to a persistent file
 */
export function saveProfitData(
  cycleId: number,
  profit: number,
  tokenAddress?: string,
  initialBalance?: number,
  finalBalance?: number,
): void {
  try {
    // Validate profit data
    if (Math.abs(profit) > 100) {
      logger.warning(`Suspicious profit value: ${profit} SOL - this seems too high/low`);
    }

    if (
      initialBalance &&
      finalBalance &&
      Math.abs(finalBalance - initialBalance - profit) > 0.001
    ) {
      logger.warning(
        `Profit calculation mismatch: ` +
          `Expected: ${(finalBalance - initialBalance).toFixed(6)}, ` +
          `Got: ${profit.toFixed(6)}`,
      );
    }

    // Create PnL directory if it doesn't exist
    if (!fs.existsSync(PNL_DIRECTORY)) {
      fs.mkdirSync(PNL_DIRECTORY, { recursive: true });
    }

    // Load existing data or create new data structure
    let profitData: ProfitData;

    try {
      if (fs.existsSync(PROFIT_LOG_PATH)) {
        profitData = JSON.parse(fs.readFileSync(PROFIT_LOG_PATH, 'utf-8'));

        // Validate the structure
        if (!profitData.cycles || !Array.isArray(profitData.cycles)) {
          profitData = { totalProfit: 0, cycles: [] };
        }
      } else {
        profitData = { totalProfit: 0, cycles: [] };
      }
    } catch (error) {
      logger.warning('Failed to read existing profit data, starting fresh:', error);
      profitData = { totalProfit: 0, cycles: [] };
    }

    // Update the data
    profitData.totalProfit += profit;

    const cycleData: CycleData = {
      cycleId,
      profit,
      tokenAddress,
      timestamp: new Date().toISOString(),
      initialBalance: initialBalance || 0,
      finalBalance: finalBalance || 0,
    };

    profitData.cycles.push(cycleData);

    // Save the data
    fs.writeFileSync(PROFIT_LOG_PATH, JSON.stringify(profitData, null, 2));

    logger.debug(
      `Saved profit data for cycle ${cycleId}: ${profit.toFixed(
        6,
      )} SOL (Total: ${profitData.totalProfit.toFixed(6)} SOL)`,
    );
  } catch (error) {
    logger.error('Failed to save profit data:', error);
  }
}

/**
 * Get the total profit/loss across all cycles
 */
export function getTotalProfit(): { totalProfit: number; cycleCount: number } {
  try {
    if (fs.existsSync(PROFIT_LOG_PATH)) {
      const profitData: ProfitData = JSON.parse(fs.readFileSync(PROFIT_LOG_PATH, 'utf-8'));

      // Validate the structure
      if (profitData.cycles && Array.isArray(profitData.cycles)) {
        return {
          totalProfit: profitData.totalProfit || 0,
          cycleCount: profitData.cycles.length,
        };
      }
    }
  } catch (error) {
    logger.warning('Failed to read profit data:', error);
  }

  return { totalProfit: 0, cycleCount: 0 };
}

/**
 * Get profit history for analysis
 */
export function getProfitHistory(): CycleData[] {
  try {
    if (fs.existsSync(PROFIT_LOG_PATH)) {
      const profitData: ProfitData = JSON.parse(fs.readFileSync(PROFIT_LOG_PATH, 'utf-8'));

      if (profitData.cycles && Array.isArray(profitData.cycles)) {
        return profitData.cycles.sort(
          (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
        );
      }
    }
  } catch (error) {
    logger.warning('Failed to read profit history:', error);
  }

  return [];
}

/**
 * Validates wallet keypair
 */
export function validateWallet(wallet: Keypair): boolean {
  try {
    // Check if the wallet has a valid public key
    const publicKey = wallet.publicKey.toBase58();
    return publicKey.length === 44; // Base58 public key length
  } catch (error) {
    logger.error('Invalid wallet:', error);
    return false;
  }
}

/**
 * Estimates transaction fee
 */
export async function estimateTransactionFee(
  connection: Connection,
  transaction: Transaction,
): Promise<number> {
  try {
    const feeCalculator = await connection.getFeeForMessage(transaction.compileMessage());
    return (feeCalculator?.value || 5000) / LAMPORTS_PER_SOL;
  } catch (error) {
    logger.warning('Failed to estimate transaction fee, using default:', error);
    return 0.000005; // Default fee of 5000 lamports
  }
}
