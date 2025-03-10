import { clusterApiUrl, Connection, Keypair } from '@solana/web3.js';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { MIN_SOL_AMOUNT_TO_BUY, SELL_TIMEOUT_MS, WALLET_DIRECTORY } from './config/constants';
import {
  generateTokenImage,
  generateTokenMetadata,
  uploadToIPFS,
} from './services/metadataGenerator';
import { createToken, sellTokens } from './services/tokenService';
import { monitorTokenTransactionsWebsocket, TransactionType } from './services/transactionMonitor';
import { createWallet, getBalance, loadWallet, saveWallet, transferAllSol } from './utils/wallet';

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
    console.log('Starting PumpFun Bot...');

    // Create a new wallet for this run
    const wallet = createWallet();
    const walletPath = saveWallet(wallet);
    console.log(`Created new wallet: ${wallet.publicKey.toString()}`);
    console.log(`Wallet saved to: ${walletPath}`);

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
      console.log(`Found previous wallet: ${previousWallet.publicKey.toString()}`);

      // Check if the previous wallet has enough SOL
      const balance = await getBalance(connection, previousWallet.publicKey);
      const minRequiredBalance = MIN_SOL_AMOUNT_TO_BUY + 0.005; // MIN_SOL_AMOUNT_TO_BUY plus a small amount for transaction fees

      if (balance >= minRequiredBalance) {
        console.log(`Previous wallet has ${balance} SOL. Transferring to new wallet...`);

        // Transfer all SOL from the previous wallet to the new one
        const signature = await transferAllSol(connection, previousWallet, wallet.publicKey);

        console.log(`Transfer complete. Signature: ${signature}`);

        // Wait for the transfer to be confirmed
        await connection.confirmTransaction(signature);
      } else {
        console.log(
          `Previous wallet has insufficient balance (${balance} SOL). Minimum required: ${minRequiredBalance} SOL. Skipping transfer.`,
        );
        console.log('Please fund the wallet manually before continuing.');
        return; // Exit the program since we need funds to continue
      }
    } else {
      console.log('No previous wallet found. Please fund the new wallet manually.');
      console.log(`Wallet address: ${wallet.publicKey.toString()}`);
      return; // Exit the program since we need funds to continue
    }

    // Generate token metadata
    const metadata = await generateTokenMetadata();
    console.log('Generated token metadata:', metadata);

    // Generate token image
    const imageUrl = await generateTokenImage(metadata.name, metadata.symbol);
    console.log('Generated token image:', imageUrl);

    // Upload metadata and image to IPFS
    const metadataUri = await uploadToIPFS(
      {
        ...metadata,
        showName: true,
        createdOn: 'https://pump.fun',
      },
      imageUrl,
    );
    console.log('Uploaded to IPFS:', metadataUri);

    // Create a new mint keypair
    const mint = Keypair.generate();
    console.log(`Created new mint: ${mint.publicKey.toString()}`);

    // Create the token on PumpFun
    const createSignature = await createToken(
      connection,
      wallet,
      mint,
      metadata.name,
      metadata.symbol,
      metadataUri,
    );

    console.log(`Token created successfully! Signature: ${createSignature}`);

    // Set up a flag to track if someone has bought the token
    let someoneBought = false;

    // Set up a timer to sell tokens after the timeout
    const sellTimer = setTimeout(async () => {
      if (!someoneBought) {
        console.log(
          `No one bought the token within ${SELL_TIMEOUT_MS / 1000} seconds. Selling all tokens...`,
        );
        try {
          const sellSignature = await sellTokens(connection, wallet, mint.publicKey);
          console.log(`Tokens sold successfully! Signature: ${sellSignature}`);

          // Start the process again with a new wallet
          setTimeout(main, 5000);
        } catch (error) {
          console.error('Error selling tokens:', error);
        }
      }
    }, SELL_TIMEOUT_MS);

    // Monitor transactions for the token
    const stopMonitoring = monitorTokenTransactionsWebsocket(
      connection,
      mint.publicKey,
      async (transaction) => {
        console.log('Transaction detected:', transaction);

        // If someone bought the token and it's not our own transaction
        if (
          transaction.type === TransactionType.BUY &&
          transaction.buyer &&
          !transaction.buyer.equals(wallet.publicKey)
        ) {
          console.log('Someone bought the token! Selling all tokens...');
          someoneBought = true;

          // Clear the sell timer
          clearTimeout(sellTimer);

          try {
            const sellSignature = await sellTokens(connection, wallet, mint.publicKey);
            console.log(`Tokens sold successfully! Signature: ${sellSignature}`);

            // Stop monitoring
            stopMonitoring();

            // Start the process again with a new wallet
            setTimeout(main, 5000);
          } catch (error) {
            console.error('Error selling tokens:', error);
          }
        }
      },
    );
  } catch (error) {
    console.error('Error in main process:', error);
  }
}

// Start the bot
main().catch(console.error);

// Handle process termination
process.on('SIGINT', () => {
  console.log('Process terminated. Exiting...');
  process.exit(0);
});

process.on('unhandledRejection', (error: Error | unknown) => {
  console.error('Unhandled promise rejection:', error);
});
