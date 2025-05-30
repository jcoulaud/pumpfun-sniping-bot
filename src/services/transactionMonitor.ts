import { PUMP_PROGRAM_ID } from '@pump-fun/pump-sdk';
import { Connection, PublicKey } from '@solana/web3.js';
import logger from '../utils/logger.js';

/**
 * Transaction type enum
 */
export enum TransactionType {
  BUY = 'BUY',
  SELL = 'SELL',
  UNKNOWN = 'UNKNOWN',
}

/**
 * Transaction data interface
 */
export interface TransactionEvent {
  type: TransactionType;
  signature: string;
  buyer?: PublicKey;
  amount?: number;
  timestamp: number;
}

/**
 * Simplified buy transaction detection
 */
function isBuyTransaction(transaction: any, mintAddress: PublicKey): boolean {
  try {
    // Skip if no transaction data
    if (!transaction?.meta || transaction.meta.err) {
      return false;
    }

    // Check if transaction involves pump program
    const programIds = transaction.transaction.message.instructions
      ?.map((ix: any) => {
        try {
          if (transaction.transaction.message.version === 'legacy') {
            return transaction.transaction.message.accountKeys[ix.programIdIndex];
          } else {
            // For versioned transactions, just check if pump program is mentioned
            const allKeys = [
              ...transaction.transaction.message.accountKeys,
              ...(transaction.meta.loadedAddresses?.readonly || []),
              ...(transaction.meta.loadedAddresses?.writable || []),
            ];
            return allKeys[ix.programIdIndex];
          }
        } catch {
          return null;
        }
      })
      .filter(Boolean);

    const involvesPumpProgram = programIds?.some((id: string) => id === PUMP_PROGRAM_ID.toBase58());

    if (!involvesPumpProgram) {
      return false;
    }

    // Check if mint is involved
    const allAccountKeys = [
      ...transaction.transaction.message.accountKeys,
      ...(transaction.meta.loadedAddresses?.readonly || []),
      ...(transaction.meta.loadedAddresses?.writable || []),
    ];

    const involvesMint = allAccountKeys.some((key: string) => key === mintAddress.toBase58());

    if (!involvesMint) {
      return false;
    }

    // Check for positive token balance changes (indicating a buy)
    const tokenBalanceChanges = transaction.meta.postTokenBalances || [];
    const preTokenBalances = transaction.meta.preTokenBalances || [];

    for (const postBalance of tokenBalanceChanges) {
      if (postBalance.mint === mintAddress.toBase58()) {
        const preBalance = preTokenBalances.find(
          (pre: any) => pre.accountIndex === postBalance.accountIndex,
        );

        const preAmount = preBalance
          ? parseFloat(preBalance.uiTokenAmount.uiAmountString || '0')
          : 0;
        const postAmount = parseFloat(postBalance.uiTokenAmount.uiAmountString || '0');

        // If token balance increased, it's likely a buy
        if (postAmount > preAmount) {
          return true;
        }
      }
    }

    return false;
  } catch (error) {
    logger.debug('Error checking transaction:', error);
    return false;
  }
}

/**
 * Gets the buyer from a transaction
 */
function getBuyerFromTransaction(transaction: any): PublicKey | undefined {
  try {
    // The first account is usually the buyer/signer
    const firstAccount = transaction.transaction.message.accountKeys[0];
    return firstAccount ? new PublicKey(firstAccount) : undefined;
  } catch (error) {
    logger.debug('Error getting buyer from transaction:', error);
    return undefined;
  }
}

/**
 * Monitors transactions for a specific token mint using WebSocket
 */
export function monitorTokenTransactionsWebsocket(
  connection: Connection,
  mintAddress: PublicKey,
  onTransaction: (transaction: TransactionEvent) => void,
  excludeWallet?: PublicKey,
): () => void {
  logger.info(`Starting to monitor transactions for mint ${logger.formatToken(mintAddress)}...`);

  // Check recent transactions first
  const checkRecentTransactions = async () => {
    try {
      const signatures = await connection.getSignaturesForAddress(mintAddress, {
        limit: 10,
      });

      for (const sigInfo of signatures) {
        try {
          const transaction = await connection.getParsedTransaction(sigInfo.signature, {
            commitment: 'confirmed',
            maxSupportedTransactionVersion: 0,
          });

          if (transaction && isBuyTransaction(transaction, mintAddress)) {
            const buyer = getBuyerFromTransaction(transaction);

            // Skip our own transactions
            if (excludeWallet && buyer?.equals(excludeWallet)) {
              continue;
            }

            logger.debug(`Buy transaction detected during initial check: ${sigInfo.signature}`);

            onTransaction({
              type: TransactionType.BUY,
              signature: sigInfo.signature,
              buyer,
              timestamp: sigInfo.blockTime || Date.now() / 1000,
            });
          }
        } catch (error) {
          logger.debug(`Error processing transaction ${sigInfo.signature}:`, error);
        }
      }
    } catch (error) {
      logger.warning('Error checking recent transactions:', error);
    }
  };

  // Check recent transactions immediately
  checkRecentTransactions();

  // Set up WebSocket monitoring for new transactions
  const subscriptionId = connection.onLogs(
    mintAddress,
    (logs, context) => {
      // Process new transactions
      setTimeout(async () => {
        try {
          const transaction = await connection.getParsedTransaction(logs.signature, {
            commitment: 'confirmed',
            maxSupportedTransactionVersion: 0,
          });

          if (transaction && isBuyTransaction(transaction, mintAddress)) {
            const buyer = getBuyerFromTransaction(transaction);

            // Skip our own transactions
            if (excludeWallet && buyer?.equals(excludeWallet)) {
              return;
            }

            logger.debug(`Buy transaction detected via WebSocket: ${logs.signature}`);

            onTransaction({
              type: TransactionType.BUY,
              signature: logs.signature,
              buyer,
              timestamp: Date.now() / 1000,
            });
          }
        } catch (error) {
          logger.debug(`Error processing WebSocket transaction ${logs.signature}:`, error);
        }
      }, 100); // Small delay to ensure transaction is available
    },
    'confirmed',
  );

  // Return cleanup function
  return () => {
    logger.info('Stopping transaction monitoring...');
    connection.removeOnLogsListener(subscriptionId);
  };
}
