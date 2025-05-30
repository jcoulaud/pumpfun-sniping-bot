import { PUMP_PROGRAM_ID, PumpSdk, getBuyTokenAmountFromSolAmount } from '@pump-fun/pump-sdk';
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, Transaction } from '@solana/web3.js';
import BN from 'bn.js';
import { botConfig } from '../config/botConfig.js';
import logger from '../utils/logger.js';
import { withTransactionRetry } from '../utils/retry.js';

const DEFAULT_DECIMALS = 6;

/**
 * Creates a token on PumpFun using the official SDK
 */
export async function createToken(
  connection: Connection,
  payer: Keypair,
  mint: Keypair,
  name: string,
  symbol: string,
  metadataUri: string,
): Promise<string> {
  return withTransactionRetry(async () => {
    logger.info(`Creating token ${name} (${symbol}) on PumpFun using official SDK...`);

    // Validate inputs
    if (!name || !symbol || !metadataUri) {
      throw new Error('Invalid token parameters: name, symbol, and metadataUri are required');
    }

    if (name.length > 32 || symbol.length > 10) {
      throw new Error('Token name must be ≤32 chars and symbol must be ≤10 chars');
    }

    // Create SDK instance
    const sdk = new PumpSdk(connection, PUMP_PROGRAM_ID);

    // Get current wallet balance
    const walletBalance = await connection.getBalance(payer.publicKey);
    const walletBalanceSOL = walletBalance / LAMPORTS_PER_SOL;

    // Calculate buy amount as 70-80% of wallet balance, capped at 2 SOL
    const minPercentage = 0.7; // 70%
    const maxPercentage = 0.8; // 80%
    const randomPercentage = minPercentage + Math.random() * (maxPercentage - minPercentage);

    const calculatedAmount = walletBalanceSOL * randomPercentage;
    const maxAmount = 2.0; // 2 SOL cap
    const solAmountToBuy = Math.min(calculatedAmount, maxAmount);

    // Ensure we have enough balance for fees
    const estimatedFees = 0.01; // Estimate for transaction fees
    if (solAmountToBuy + estimatedFees > walletBalanceSOL) {
      throw new Error(
        `Insufficient balance. Wallet: ${walletBalanceSOL.toFixed(4)} SOL, ` +
          `Required: ${(solAmountToBuy + estimatedFees).toFixed(4)} SOL`,
      );
    }

    logger.info(
      `Wallet balance: ${walletBalanceSOL.toFixed(4)} SOL, ` +
        `Using: ${(randomPercentage * 100).toFixed(1)}% = ${solAmountToBuy.toFixed(4)} SOL`,
    );

    // Create transaction
    const transaction = new Transaction();

    // Add create instruction
    const createIx = await sdk.createInstruction(
      mint.publicKey,
      name,
      symbol,
      metadataUri,
      payer.publicKey, // creator
      payer.publicKey, // user
    );
    transaction.add(createIx);

    // Get global state for buy instruction
    const global = await sdk.fetchGlobal();

    // For new tokens, create a virtual bonding curve state
    const virtualBondingCurve = {
      virtualTokenReserves: global.initialVirtualTokenReserves,
      virtualSolReserves: global.initialVirtualSolReserves,
      realTokenReserves: global.initialRealTokenReserves,
      realSolReserves: new BN(0),
      tokenTotalSupply: global.tokenTotalSupply,
      complete: false,
      creator: payer.publicKey,
    };

    // Calculate token amount from SOL amount
    const buyAmountSol = new BN(Math.floor(solAmountToBuy * LAMPORTS_PER_SOL));
    const tokenAmount = getBuyTokenAmountFromSolAmount(
      global,
      virtualBondingCurve,
      buyAmountSol,
      true, // newCoin = true
    );

    logger.info(`Calculated token amount: ${tokenAmount.toString()} tokens`);

    // Add a small buffer to the slippage for precision issues
    const slippage = Math.max(
      botConfig.trading.slippageBasisPoints / 10000,
      0.01, // Minimum 1% slippage
    );

    // Reduce token amount slightly to account for slippage precision
    const adjustedTokenAmount = tokenAmount.mul(new BN(99)).div(new BN(100)); // 1% buffer

    // Add buy instructions
    const buyInstructions = await sdk.buyInstructions(
      global,
      null, // bondingCurveAccountInfo is null for new tokens
      null as any, // bondingCurve is null for new tokens
      mint.publicKey,
      payer.publicKey,
      adjustedTokenAmount, // adjusted token amount
      buyAmountSol, // SOL amount
      slippage,
      payer.publicKey, // newCoinCreator
    );

    transaction.add(...buyInstructions);

    // Sign and send transaction
    transaction.feePayer = payer.publicKey;
    const { blockhash } = await connection.getLatestBlockhash();
    transaction.recentBlockhash = blockhash;

    // Sign with both payer and mint keypairs
    transaction.sign(payer, mint);

    // Send transaction
    const signature = await connection.sendRawTransaction(transaction.serialize(), {
      skipPreflight: false,
      preflightCommitment: 'confirmed',
    });

    // Wait for confirmation with timeout
    const confirmationPromise = connection.confirmTransaction(signature, 'confirmed');
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error('Transaction confirmation timeout')),
        botConfig.monitoring.confirmationTimeout,
      ),
    );

    await Promise.race([confirmationPromise, timeoutPromise]);

    logger.info(`Token created successfully! Signature: ${signature}`);
    logger.info(`Token address: ${mint.publicKey.toBase58()}`);
    logger.info(`Pump.fun URL: https://pump.fun/${mint.publicKey.toBase58()}`);
    return signature;
  }, 'Token creation');
}

/**
 * Buys tokens using the official SDK
 */
export async function buyTokens(
  connection: Connection,
  buyer: Keypair,
  mintAddress: string,
  solAmount: number,
): Promise<string> {
  return withTransactionRetry(async () => {
    logger.info(`Buying ${solAmount} SOL worth of tokens for mint: ${mintAddress}`);

    // Validate inputs
    if (solAmount <= 0) {
      throw new Error('SOL amount must be positive');
    }

    if (solAmount < botConfig.trading.minSolAmount) {
      throw new Error(`SOL amount must be at least ${botConfig.trading.minSolAmount}`);
    }

    // Create SDK instance
    const sdk = new PumpSdk(connection, PUMP_PROGRAM_ID);
    const mint = new PublicKey(mintAddress);

    // Get global state and bonding curve
    const [global, bondingCurve] = await Promise.all([
      sdk.fetchGlobal(),
      sdk.fetchBondingCurve(mint),
    ]);

    // Get bonding curve account info
    const bondingCurveAccountInfo = await connection.getAccountInfo(sdk.bondingCurvePda(mint));

    if (!bondingCurveAccountInfo) {
      throw new Error('Bonding curve account not found');
    }

    // Calculate token amount from SOL amount
    const buyAmountSol = new BN(Math.floor(solAmount * LAMPORTS_PER_SOL));
    const tokenAmount = getBuyTokenAmountFromSolAmount(
      global,
      bondingCurve,
      buyAmountSol,
      false, // newCoin = false for existing tokens
    );

    logger.info(`Calculated token amount: ${tokenAmount.toString()} tokens`);

    // Create transaction
    const transaction = new Transaction();

    // Add a small buffer to the slippage for precision issues
    const slippage = Math.max(
      botConfig.trading.slippageBasisPoints / 10000,
      0.01, // Minimum 1% slippage
    );

    // Reduce token amount slightly to account for slippage precision
    const adjustedTokenAmount = tokenAmount.mul(new BN(99)).div(new BN(100)); // 1% buffer

    // Add buy instructions
    const buyInstructions = await sdk.buyInstructions(
      global,
      bondingCurveAccountInfo,
      bondingCurve,
      mint,
      buyer.publicKey,
      adjustedTokenAmount, // adjusted token amount
      buyAmountSol, // SOL amount
      slippage,
      bondingCurve.creator, // coin creator
    );

    transaction.add(...buyInstructions);

    // Sign and send transaction
    transaction.feePayer = buyer.publicKey;
    const { blockhash } = await connection.getLatestBlockhash();
    transaction.recentBlockhash = blockhash;
    transaction.sign(buyer);

    const signature = await connection.sendRawTransaction(transaction.serialize(), {
      skipPreflight: false,
      preflightCommitment: 'confirmed',
    });

    // Wait for confirmation with timeout
    const confirmationPromise = connection.confirmTransaction(signature, 'confirmed');
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error('Transaction confirmation timeout')),
        botConfig.monitoring.confirmationTimeout,
      ),
    );

    await Promise.race([confirmationPromise, timeoutPromise]);

    logger.info(`Buy successful! Signature: ${signature}`);
    return signature;
  }, 'Token purchase');
}

/**
 * Sells tokens using the official SDK
 */
export async function sellTokens(
  connection: Connection,
  seller: Keypair,
  mintAddress: string,
  tokenAmount: number,
): Promise<string> {
  return withTransactionRetry(async () => {
    logger.info(`Selling ${tokenAmount} tokens for mint: ${mintAddress}`);

    // Validate inputs
    if (tokenAmount <= 0) {
      throw new Error('Token amount must be positive');
    }

    // Create SDK instance
    const sdk = new PumpSdk(connection, PUMP_PROGRAM_ID);
    const mint = new PublicKey(mintAddress);

    // Get global state and bonding curve
    const [global, bondingCurve] = await Promise.all([
      sdk.fetchGlobal(),
      sdk.fetchBondingCurve(mint),
    ]);

    // Get bonding curve account info
    const bondingCurveAccountInfo = await connection.getAccountInfo(sdk.bondingCurvePda(mint));

    if (!bondingCurveAccountInfo) {
      throw new Error('Bonding curve account not found');
    }

    // Create transaction
    const transaction = new Transaction();

    // Convert token amount to base units
    const sellAmount = new BN(Math.floor(tokenAmount * Math.pow(10, DEFAULT_DECIMALS)));
    const slippage = botConfig.trading.slippageBasisPoints / 10000; // Convert basis points to decimal

    // Add sell instructions
    const sellInstructions = await sdk.sellInstructions(
      global,
      bondingCurveAccountInfo,
      mint,
      seller.publicKey,
      sellAmount, // token amount
      new BN(0), // SOL amount (calculated by the SDK)
      slippage,
    );

    transaction.add(...sellInstructions);

    // Sign and send transaction
    transaction.feePayer = seller.publicKey;
    const { blockhash } = await connection.getLatestBlockhash();
    transaction.recentBlockhash = blockhash;
    transaction.sign(seller);

    const signature = await connection.sendRawTransaction(transaction.serialize(), {
      skipPreflight: false,
      preflightCommitment: 'confirmed',
    });

    // Wait for confirmation with timeout
    const confirmationPromise = connection.confirmTransaction(signature, 'confirmed');
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error('Transaction confirmation timeout')),
        botConfig.monitoring.confirmationTimeout,
      ),
    );

    await Promise.race([confirmationPromise, timeoutPromise]);

    logger.info(`Sell successful! Signature: ${signature}`);
    return signature;
  }, 'Token sale');
}

/**
 * Gets bonding curve account information with error handling
 */
export async function getBondingCurveAccount(
  connection: Connection,
  mintAddress: string,
): Promise<any> {
  try {
    const sdk = new PumpSdk(connection, PUMP_PROGRAM_ID);
    const mint = new PublicKey(mintAddress);
    const bondingCurve = await sdk.fetchBondingCurve(mint);
    return bondingCurve;
  } catch (error) {
    logger.error('Error getting bonding curve account:', error);
    return null;
  }
}

/**
 * Gets global account information with error handling
 */
export async function getGlobalAccount(connection: Connection): Promise<any> {
  try {
    const sdk = new PumpSdk(connection, PUMP_PROGRAM_ID);
    const globalAccount = await sdk.fetchGlobal();
    return globalAccount;
  } catch (error) {
    logger.error('Error getting global account:', error);
    return null;
  }
}

/**
 * Validates token creation parameters
 */
export function validateTokenParams(name: string, symbol: string, metadataUri: string): void {
  if (!name || typeof name !== 'string') {
    throw new Error('Token name is required and must be a string');
  }

  if (!symbol || typeof symbol !== 'string') {
    throw new Error('Token symbol is required and must be a string');
  }

  if (!metadataUri || typeof metadataUri !== 'string') {
    throw new Error('Metadata URI is required and must be a string');
  }

  if (name.length > 32) {
    throw new Error('Token name must be 32 characters or less');
  }

  if (symbol.length > 10) {
    throw new Error('Token symbol must be 10 characters or less');
  }

  if (!metadataUri.startsWith('http://') && !metadataUri.startsWith('https://')) {
    throw new Error('Metadata URI must be a valid HTTP/HTTPS URL');
  }
}
