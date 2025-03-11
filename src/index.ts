import { clusterApiUrl, Connection, Keypair } from '@solana/web3.js';
import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import { MIN_SOL_AMOUNT_TO_BUY, SELL_TIMEOUT_MS, WALLET_DIRECTORY } from './config/constants.js';
import {
  generateTokenImage,
  generateTokenMetadata,
  uploadToIPFS,
} from './services/metadataGenerator.js';
import { createToken, sellTokens } from './services/tokenService.js';
import {
  monitorTokenTransactionsWebsocket,
  TransactionType,
} from './services/transactionMonitor.js';
import logger from './utils/logger.js';
import {
  createWallet,
  getBalance,
  loadWallet,
  saveWallet,
  transferAllSol,
} from './utils/wallet.js';

// Load environment variables
dotenv.config();

// Create wallet directory if it doesn't exist
if (!fs.existsSync(WALLET_DIRECTORY)) {
  fs.mkdirSync(WALLET_DIRECTORY, { recursive: true });
}

// Initialize Solana connection
const connection = new Connection(
  process.env.HELIUS_API_KEY
    ? `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`
    : clusterApiUrl('mainnet-beta'),
  'confirmed',
);

/**
 * Main function to run the bot
 */
async function main() {
  try {
    // Start a new cycle
    logger.startCycle();

    logger.info('Starting PumpFun Bot...');

    // Create a new wallet for this run
    const wallet = createWallet();
    const walletPath = saveWallet(wallet);
    logger.info(`Created new wallet: ${logger.formatWallet(wallet.publicKey)}`);
    logger.debug(`Wallet saved to: ${walletPath}`);

    // Check if there's a previous wallet to transfer funds from
    const previousWallets = fs
      .readdirSync(WALLET_DIRECTORY)
      .filter((file: string) => file.endsWith('.json') && file !== path.basename(walletPath))
      .map((file: string) => path.join(WALLET_DIRECTORY, file));

    if (previousWallets.length > 0) {
      // Sort by creation time (newest first)
      previousWallets.sort((a: string, b: string) => {
        return fs.statSync(b).mtime.getTime() - fs.statSync(a).mtime.getTime();
      });

      // Load the most recent wallet
      const previousWallet = loadWallet(previousWallets[0]);
      logger.info(`Found previous wallet: ${logger.formatWallet(previousWallet.publicKey)}`);

      // Check if the previous wallet has enough SOL
      const balance = await getBalance(connection, previousWallet.publicKey);
      const minRequiredBalance = MIN_SOL_AMOUNT_TO_BUY + 0.005; // MIN_SOL_AMOUNT_TO_BUY plus a small amount for transaction fees

      if (balance >= minRequiredBalance) {
        logger.info(`Previous wallet has ${balance} SOL. Transferring to new wallet...`);

        // Transfer all SOL from the previous wallet to the new one
        const signature = await transferAllSol(connection, previousWallet, wallet.publicKey);

        logger.success(`Transfer complete. Signature: ${logger.formatTx(signature)}`);

        // Wait for the transfer to be confirmed
        await connection.confirmTransaction(signature);
      } else {
        logger.warning(
          `Previous wallet has insufficient balance (${balance} SOL). Minimum required: ${minRequiredBalance} SOL. Skipping transfer.`,
        );
        logger.warning('Please fund the wallet manually before continuing.');
        return; // Exit the program since we need funds to continue
      }
    } else {
      logger.warning('No previous wallet found. Please fund the new wallet manually.');
      logger.info(`Wallet address: ${logger.formatWallet(wallet.publicKey)}`);
      return; // Exit the program since we need funds to continue
    }

    // Generate token metadata
    const metadata = await generateTokenMetadata();
    logger.info('Generated token metadata:', metadata);

    // Generate token image
    const imageUrl = await generateTokenImage(metadata.name, metadata.symbol);
    logger.info('Generated token image:', imageUrl);

    // Upload metadata and image to IPFS
    const metadataUri = await uploadToIPFS(
      {
        ...metadata,
        showName: true,
        createdOn: 'https://pump.fun',
      },
      imageUrl,
    );
    logger.info('Uploaded to IPFS:', metadataUri);

    // Create a new mint keypair
    const mint = Keypair.generate();
    logger.info(`Created new mint: ${logger.formatToken(mint.publicKey)}`);

    // Create the token on PumpFun
    const createSignature = await createToken(
      connection,
      wallet,
      mint,
      metadata.name,
      metadata.symbol,
      metadataUri,
    );

    logger.success(`Token created successfully! Signature: ${logger.formatTx(createSignature)}`);

    // Set up a flag to track if someone has bought the token
    let someoneBought = false;

    // Set up a timer to sell tokens after the timeout
    const sellTimer = setTimeout(async () => {
      if (!someoneBought) {
        logger.cycle(
          `No one bought the token within ${SELL_TIMEOUT_MS / 1000} seconds. Selling all tokens...`,
        );
        try {
          const sellSignature = await sellTokens(connection, wallet, mint.publicKey);
          logger.success(`Tokens sold successfully! Signature: ${logger.formatTx(sellSignature)}`);

          // End the current cycle
          logger.endCycle();

          // Start the process again with a new wallet
          setTimeout(main, 5000);
        } catch (error) {
          logger.error('Error selling tokens:', error);
        }
      }
    }, SELL_TIMEOUT_MS);

    // Monitor transactions for the token
    const stopMonitoring = monitorTokenTransactionsWebsocket(
      connection,
      mint.publicKey,
      async (transaction) => {
        logger.debug('Transaction detected:', transaction);

        // If someone bought the token and it's not our own transaction
        if (
          transaction.type === TransactionType.BUY &&
          transaction.buyer &&
          !transaction.buyer.equals(wallet.publicKey)
        ) {
          logger.success('Someone bought the token! Selling all tokens...');
          someoneBought = true;

          // Clear the sell timer
          clearTimeout(sellTimer);

          try {
            const sellSignature = await sellTokens(connection, wallet, mint.publicKey);
            logger.success(
              `Tokens sold successfully! Signature: ${logger.formatTx(sellSignature)}`,
            );

            // End the current cycle
            logger.endCycle();

            // Stop monitoring
            stopMonitoring();

            // Start the process again with a new wallet
            setTimeout(main, 5000);
          } catch (error) {
            logger.error('Error selling tokens:', error);
          }
        }
      },
    );
  } catch (error) {
    logger.error('Error in main process:', error);
  }
}

// Start the bot
main().catch((error) => logger.error('Unhandled error in main:', error));

// Handle process termination
process.on('SIGINT', () => {
  logger.warning('Process terminated. Exiting...');
  process.exit(0);
});

process.on('unhandledRejection', (error: Error | unknown) => {
  logger.error('Unhandled promise rejection:', error);
});
