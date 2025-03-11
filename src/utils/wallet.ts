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
import { WALLET_DIRECTORY } from '../config/constants.js';

// Path for storing profit/loss data
const PNL_DIRECTORY = 'pnl';
const PROFIT_LOG_PATH = path.join(PNL_DIRECTORY, 'profit_log.json');

// Creates a new Solana wallet
export function createWallet(): Keypair {
  return Keypair.generate();
}

// Saves a wallet's keypair to a local file
export function saveWallet(keypair: Keypair, filename?: string): string {
  // Create wallet directory if it doesn't exist
  if (!fs.existsSync(WALLET_DIRECTORY)) {
    fs.mkdirSync(WALLET_DIRECTORY, { recursive: true });
  }

  const walletName = filename || `wallet-${Date.now()}.json`;
  const walletPath = path.join(WALLET_DIRECTORY, walletName);

  // Save the keypair as a JSON file with both array and base58 formats
  const keyData = {
    publicKey: keypair.publicKey.toString(),
    secretKey: Array.from(keypair.secretKey),
    secretKeyBase58: bs58.encode(keypair.secretKey),
  };

  fs.writeFileSync(walletPath, JSON.stringify(keyData, null, 2));
  return walletPath;
}

// Loads a wallet from a local file
export function loadWallet(filePath: string): Keypair {
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
}

// Transfers SOL from one wallet to another
export async function transferSol(
  connection: Connection,
  fromWallet: Keypair,
  toWallet: PublicKey,
  amountSol: number,
): Promise<string> {
  // Get the recent blockhash
  const { blockhash } = await connection.getLatestBlockhash();

  // Create a transfer transaction
  const transaction = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: fromWallet.publicKey,
      toPubkey: toWallet,
      lamports: amountSol * LAMPORTS_PER_SOL,
    }),
  );

  // Set the transaction properties
  transaction.feePayer = fromWallet.publicKey;
  transaction.recentBlockhash = blockhash;

  // Sign and send the transaction
  transaction.sign(fromWallet);
  return await connection.sendRawTransaction(transaction.serialize());
}

// Gets the SOL balance of a wallet
export async function getBalance(connection: Connection, publicKey: PublicKey): Promise<number> {
  const balance = await connection.getBalance(publicKey);
  return balance / LAMPORTS_PER_SOL;
}

// Transfers all SOL from one wallet to another, minus fees
export async function transferAllSol(
  connection: Connection,
  fromWallet: Keypair,
  toWallet: PublicKey,
): Promise<string> {
  // Get the balance of the source wallet
  const balance = await connection.getBalance(fromWallet.publicKey);

  // Calculate the amount to transfer (balance - fee)
  // Estimate the fee as 5000 lamports (0.000005 SOL)
  const fee = 5000;
  const transferAmount = balance - fee;

  if (transferAmount <= 0) {
    throw new Error('Insufficient balance to transfer');
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
  return await connection.sendRawTransaction(transaction.serialize());
}

// Calculates the profit/loss from a cycle
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
export function saveProfitData(cycleId: number, profit: number, tokenAddress?: string): void {
  // Create PnL directory if it doesn't exist
  if (!fs.existsSync(PNL_DIRECTORY)) {
    fs.mkdirSync(PNL_DIRECTORY, { recursive: true });
  }

  // Load existing data or create new data structure
  let profitData: {
    totalProfit: number;
    cycles: Array<{
      cycleId: number;
      profit: number;
      tokenAddress?: string;
      timestamp: string;
    }>;
  };

  try {
    if (fs.existsSync(PROFIT_LOG_PATH)) {
      profitData = JSON.parse(fs.readFileSync(PROFIT_LOG_PATH, 'utf-8'));
    } else {
      profitData = { totalProfit: 0, cycles: [] };
    }
  } catch (error) {
    // If there's an error reading the file, start fresh
    profitData = { totalProfit: 0, cycles: [] };
  }

  // Update the data
  profitData.totalProfit += profit;
  profitData.cycles.push({
    cycleId,
    profit,
    tokenAddress,
    timestamp: new Date().toISOString(),
  });

  // Save the data
  fs.writeFileSync(PROFIT_LOG_PATH, JSON.stringify(profitData, null, 2));
}

/**
 * Get the total profit/loss across all cycles
 */
export function getTotalProfit(): { totalProfit: number; cycleCount: number } {
  try {
    if (fs.existsSync(PROFIT_LOG_PATH)) {
      const profitData = JSON.parse(fs.readFileSync(PROFIT_LOG_PATH, 'utf-8'));
      return {
        totalProfit: profitData.totalProfit,
        cycleCount: profitData.cycles.length,
      };
    }
  } catch (error) {
    // If there's an error, return zero
  }

  return { totalProfit: 0, cycleCount: 0 };
}
