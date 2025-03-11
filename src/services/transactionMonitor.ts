import { Connection, PublicKey } from '@solana/web3.js';
import logger from '../utils/logger.js';

/**
 * Transaction type enum
 */
export enum TransactionType {
  BUY = 'buy',
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
 * Checks if a transaction is a buy transaction for the given mint
 * @param transaction Transaction data
 * @param mintAddress Mint address
 * @param walletPublicKey Our wallet public key to exclude our own transactions
 * @returns Object with isBuy flag and buyer public key if it's a buy transaction
 */
function isBuyTransaction(
  transaction: any,
  mintAddress: PublicKey,
  walletPublicKey?: PublicKey,
): { isBuy: boolean; buyer?: PublicKey } {
  try {
    if (!transaction || !transaction.transaction) {
      return { isBuy: false };
    }

    // Get all accounts involved in the transaction
    const accountKeys = transaction.transaction.message.getAccountKeys().keySegments().flat();

    // Check if the mint is involved in the transaction
    const mintInvolved = accountKeys.some((key: PublicKey) => key.equals(mintAddress));
    if (!mintInvolved) {
      return { isBuy: false };
    }

    // Get the first account (usually the buyer/signer)
    const buyer = accountKeys[0];

    // Skip our own transactions
    if (walletPublicKey && buyer.equals(walletPublicKey)) {
      return { isBuy: false };
    }

    // Check if the transaction has instructions
    if (
      !transaction.transaction.message.instructions ||
      transaction.transaction.message.instructions.length === 0
    ) {
      return { isBuy: false };
    }

    // For PumpFun transactions, we can check for the buy instruction discriminator
    // The buy discriminator is [102, 6, 61, 18, 1, 218, 235, 234]
    const buyDiscriminator = Buffer.from([102, 6, 61, 18, 1, 218, 235, 234]);

    // Check if any instruction has the buy discriminator
    for (const ix of transaction.transaction.message.instructions) {
      if (!ix.data) continue;

      const data = Buffer.from(ix.data, 'base64');
      if (data.length >= 8 && data.slice(0, 8).equals(buyDiscriminator)) {
        return { isBuy: true, buyer };
      }
    }

    // If we couldn't definitively identify a buy transaction but the mint is involved,
    // we'll assume it's a buy transaction for now (can be refined later)
    return { isBuy: true, buyer };
  } catch (error) {
    logger.error('Error checking if transaction is a buy:', error);
    return { isBuy: false };
  }
}

/**
 * Improved websocket-based transaction monitoring
 * @param connection Solana connection
 * @param mintAddress Mint address of the token to monitor
 * @param callback Callback function to execute when a transaction is detected
 * @param walletPublicKey Our wallet public key to exclude our own transactions
 * @returns Cleanup function to stop monitoring
 */
export function monitorTokenTransactionsWebsocket(
  connection: Connection,
  mintAddress: PublicKey,
  callback: (transaction: TransactionData) => void,
  walletPublicKey?: PublicKey,
): () => void {
  logger.info(`Starting to monitor transactions for mint ${logger.formatToken(mintAddress)}...`);

  // Track processed signatures to avoid duplicates
  const processedSignatures = new Set<string>();

  // Track if monitoring is active
  let isMonitoringActive = true;

  // Subscribe to account changes
  const subscriptionId = connection.onAccountChange(
    mintAddress,
    async (accountInfo, context) => {
      // Skip if monitoring has been stopped
      if (!isMonitoringActive) return;

      // Only log at debug level to reduce noise
      logger.debug(`Account change detected for ${mintAddress.toString()} at slot ${context.slot}`);

      try {
        // Get recent signatures for the mint
        const signatures = await connection.getSignaturesForAddress(mintAddress, {
          limit: 10,
        });

        if (signatures.length === 0) {
          return;
        }

        // Process each signature that we haven't seen before
        for (const sigInfo of signatures) {
          // Skip if monitoring has been stopped during processing
          if (!isMonitoringActive) return;

          if (processedSignatures.has(sigInfo.signature)) {
            continue;
          }

          // Mark as processed immediately to avoid race conditions
          processedSignatures.add(sigInfo.signature);

          // Get transaction details
          const transaction = await connection.getTransaction(sigInfo.signature, {
            maxSupportedTransactionVersion: 0,
          });

          if (!transaction) {
            continue;
          }

          // Check if this is a buy transaction
          const { isBuy, buyer } = isBuyTransaction(transaction, mintAddress, walletPublicKey);

          if (isBuy && buyer) {
            // Log at debug level only to reduce noise
            logger.debug(`Buy transaction detected: ${sigInfo.signature}`);

            // Process the transaction
            callback({
              signature: sigInfo.signature,
              type: TransactionType.BUY,
              buyer,
              amount: undefined,
              timestamp: transaction.blockTime || Date.now() / 1000,
            });
          }
        }
      } catch (error) {
        logger.error('Error processing transaction from websocket:', error);
      }
    },
    'confirmed',
  );

  // Initial check timeout ID for cleanup
  let initialCheckTimeoutId: NodeJS.Timeout | null = null;

  // Do an initial check for transactions that might have happened right after token creation
  initialCheckTimeoutId = setTimeout(async () => {
    // Skip if monitoring has been stopped
    if (!isMonitoringActive) return;

    try {
      // Get recent signatures for the mint
      const signatures = await connection.getSignaturesForAddress(mintAddress, {
        limit: 10,
      });

      if (signatures.length === 0) {
        return;
      }

      // Process each signature that we haven't seen before
      for (const sigInfo of signatures) {
        // Skip if monitoring has been stopped during processing
        if (!isMonitoringActive) return;

        if (processedSignatures.has(sigInfo.signature)) {
          continue;
        }

        // Mark as processed immediately to avoid race conditions
        processedSignatures.add(sigInfo.signature);

        // Get transaction details
        const transaction = await connection.getTransaction(sigInfo.signature, {
          maxSupportedTransactionVersion: 0,
        });

        if (!transaction) {
          continue;
        }

        // Check if this is a buy transaction
        const { isBuy, buyer } = isBuyTransaction(transaction, mintAddress, walletPublicKey);

        if (isBuy && buyer) {
          // Log at debug level only to reduce noise
          logger.debug(`Buy transaction detected during initial check: ${sigInfo.signature}`);

          // Process the transaction
          callback({
            signature: sigInfo.signature,
            type: TransactionType.BUY,
            buyer,
            amount: undefined,
            timestamp: transaction.blockTime || Date.now() / 1000,
          });
        }
      }
    } catch (error) {
      logger.error('Error during initial transaction check:', error);
    }

    // Clear the timeout ID after execution
    initialCheckTimeoutId = null;
  }, 500);

  // Return a cleanup function
  return () => {
    // Prevent multiple calls to the cleanup function
    if (!isMonitoringActive) return;

    // Simplified logging message
    logger.info(`Stopping transaction monitoring...`);

    // Mark monitoring as inactive
    isMonitoringActive = false;

    // Remove the account change listener
    try {
      connection.removeAccountChangeListener(subscriptionId);
    } catch (error: any) {
      // Don't log errors about already removed listeners to reduce noise
      if (!error.toString().includes('Ignored unsubscribe request')) {
        logger.error('Error removing account change listener:', error);
      }
    }

    // Clear the initial check timeout if it's still pending
    if (initialCheckTimeoutId) {
      clearTimeout(initialCheckTimeoutId);
      initialCheckTimeoutId = null;
    }

    // Clear the processed signatures set
    processedSignatures.clear();
  };
}
