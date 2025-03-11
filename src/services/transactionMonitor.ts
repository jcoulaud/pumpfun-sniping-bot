import { Connection, PublicKey } from '@solana/web3.js';
import { PUMP_FUN_PROGRAM } from '../config/constants.js';
import logger from '../utils/logger.js';

/**
 * Transaction type enum
 */
export enum TransactionType {
  BUY = 'buy',
  SELL = 'sell',
  UNKNOWN = 'unknown',
}

/**
 * Transaction data interface
 */
export interface TransactionData {
  signature: string;
  type: TransactionType;
  buyer?: PublicKey;
  amount?: number;
  timestamp: number;
}

/**
 * Monitors transactions for a specific token
 * @param connection Solana connection
 * @param mintAddress Mint address of the token to monitor
 * @param callback Callback function to execute when a transaction is detected
 * @returns Cleanup function to stop monitoring
 */
export function monitorTokenTransactions(
  connection: Connection,
  mintAddress: PublicKey,
  callback: (transaction: TransactionData) => void,
): () => void {
  logger.info(`Starting to monitor transactions for mint ${logger.formatToken(mintAddress)}...`);

  // Subscribe to program account changes
  const subscriptionId = connection.onProgramAccountChange(
    PUMP_FUN_PROGRAM,
    async (accountInfo, context) => {
      try {
        // Get the transaction details
        const signature = context.slot.toString();

        // Fetch the transaction
        const transaction = await connection.getTransaction(signature, {
          maxSupportedTransactionVersion: 0,
        });

        if (!transaction) {
          return;
        }

        // Check if the transaction involves our mint
        const accountKeys = transaction.transaction.message.getAccountKeys().keySegments().flat();
        if (!accountKeys.some((key: PublicKey) => key.equals(mintAddress))) {
          return;
        }

        // Determine the transaction type
        // This is a simplified approach - in a real implementation, you would need to decode
        // the transaction data to determine the exact type and details
        let type = TransactionType.UNKNOWN;
        let buyer: PublicKey | undefined;
        let amount: number | undefined;

        // For demonstration purposes, we're assuming any transaction with the mint is a buy
        // In a real implementation, you would need to decode the transaction data
        type = TransactionType.BUY;
        const keys = transaction.transaction.message.getAccountKeys().keySegments().flat();
        buyer = keys[0]; // Assuming the first account is the buyer

        // Call the callback with the transaction data
        callback({
          signature,
          type,
          buyer,
          amount,
          timestamp: transaction.blockTime || Date.now() / 1000,
        });
      } catch (error) {
        logger.error('Error processing transaction:', error);
      }
    },
    'confirmed',
  );

  // Return a cleanup function
  return () => {
    logger.info('Stopping transaction monitoring...');
    connection.removeProgramAccountChangeListener(subscriptionId);
  };
}

/**
 * Alternative implementation using websocket subscription to account activity
 * @param connection Solana connection
 * @param mintAddress Mint address of the token to monitor
 * @param callback Callback function to execute when a transaction is detected
 * @returns Cleanup function to stop monitoring
 */
export function monitorTokenTransactionsWebsocket(
  connection: Connection,
  mintAddress: PublicKey,
  callback: (transaction: TransactionData) => void,
): () => void {
  logger.info(
    `Starting to monitor transactions for mint ${logger.formatToken(
      mintAddress,
    )} using websocket...`,
  );

  // Subscribe to account changes
  const subscriptionId = connection.onAccountChange(
    mintAddress,
    async (accountInfo, context) => {
      try {
        // Get recent signatures for the mint
        const signatures = await connection.getSignaturesForAddress(mintAddress, {
          limit: 10,
        });

        if (signatures.length === 0) {
          return;
        }

        // Get the most recent signature
        const mostRecentSignature = signatures[0].signature;

        // Fetch the transaction
        const transaction = await connection.getTransaction(mostRecentSignature, {
          maxSupportedTransactionVersion: 0,
        });

        if (!transaction) {
          return;
        }

        // Determine the transaction type
        // This is a simplified approach - in a real implementation, you would need to decode
        // the transaction data to determine the exact type and details
        let type = TransactionType.UNKNOWN;
        let buyer: PublicKey | undefined;
        let amount: number | undefined;

        // For demonstration purposes, we're assuming any transaction with the mint is a buy
        // In a real implementation, you would need to decode the transaction data
        type = TransactionType.BUY;
        const keys = transaction.transaction.message.getAccountKeys().keySegments().flat();
        buyer = keys[0]; // Assuming the first account is the buyer

        // Call the callback with the transaction data
        callback({
          signature: mostRecentSignature,
          type,
          buyer,
          amount,
          timestamp: transaction.blockTime || Date.now() / 1000,
        });
      } catch (error) {
        logger.error('Error processing transaction:', error);
      }
    },
    'confirmed',
  );

  // Return a cleanup function
  return () => {
    logger.info('Stopping transaction monitoring...');
    connection.removeAccountChangeListener(subscriptionId);
  };
}

/**
 * Implementation using Helius webhook API for transaction monitoring
 * This is a more reliable method for production use
 * @param mintAddress Mint address of the token to monitor
 * @param callback Callback function to execute when a transaction is detected
 */
export async function setupHeliusWebhook(
  mintAddress: PublicKey,
  callbackUrl: string,
): Promise<string> {
  logger.info(`Setting up Helius webhook for mint ${logger.formatToken(mintAddress)}...`);

  const apiKey = process.env.HELIUS_API_KEY;
  if (!apiKey) {
    throw new Error('HELIUS_API_KEY is not set in environment variables');
  }

  const url = `https://api.helius.xyz/v0/webhooks?api-key=${apiKey}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      webhookURL: callbackUrl,
      transactionTypes: ['ANY'],
      accountAddresses: [mintAddress.toString()],
      webhookType: 'enhanced',
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to create Helius webhook: ${response.statusText}`);
  }

  const data = await response.json();
  return data.webhookID;
}

/**
 * Deletes a Helius webhook
 * @param webhookId ID of the webhook to delete
 */
export async function deleteHeliusWebhook(webhookId: string): Promise<void> {
  logger.info(`Deleting Helius webhook ${webhookId}...`);

  const apiKey = process.env.HELIUS_API_KEY;
  if (!apiKey) {
    throw new Error('HELIUS_API_KEY is not set in environment variables');
  }

  const url = `https://api.helius.xyz/v0/webhooks/${webhookId}?api-key=${apiKey}`;

  const response = await fetch(url, {
    method: 'DELETE',
  });

  if (!response.ok) {
    throw new Error(`Failed to delete Helius webhook: ${response.statusText}`);
  }
}
