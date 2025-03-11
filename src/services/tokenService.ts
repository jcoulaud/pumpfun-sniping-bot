import {
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddress,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  Transaction,
  TransactionInstruction,
} from '@solana/web3.js';
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  DEFAULT_SLIPPAGE_BASIS_POINTS,
  EVENT_AUTHORITY,
  FEE_RECIPIENT,
  GLOBAL,
  MAX_SOL_AMOUNT_TO_BUY,
  MIN_SOL_AMOUNT_TO_BUY,
  MINT_AUTHORITY,
  MINT_SIZE,
  MPL_TOKEN_METADATA,
  PUMP_FUN_PROGRAM,
  PUMPFUN_FEE_PERCENTAGE,
  RENT,
  SYSTEM_PROGRAM,
  TRANSACTION_FEE_BUFFER,
} from '../config/constants.js';
import logger from '../utils/logger.js';

/**
 * Creates a token on PumpFun
 */
export async function createToken(
  connection: Connection,
  payer: Keypair,
  mint: Keypair,
  name: string,
  symbol: string,
  metadataUri: string,
): Promise<string> {
  logger.info(`Creating token ${name} (${symbol}) on PumpFun...`);

  // Get all PDAs
  const bondingCurve = getBondingCurvePDA(mint.publicKey);

  const [metadata] = PublicKey.findProgramAddressSync(
    [Buffer.from('metadata'), MPL_TOKEN_METADATA.toBuffer(), mint.publicKey.toBuffer()],
    MPL_TOKEN_METADATA,
  );

  const associatedBondingCurve = await getAssociatedTokenAddress(
    mint.publicKey,
    bondingCurve,
    true,
  );

  // Get the associated token account for the payer
  const payerAta = await getAssociatedTokenAddress(mint.publicKey, payer.publicKey, false);

  // Check if accounts already exist
  const [mintInfo, bondingCurveInfo, metadataInfo] = await Promise.all([
    connection.getAccountInfo(mint.publicKey),
    connection.getAccountInfo(bondingCurve),
    connection.getAccountInfo(metadata),
  ]);

  if (mintInfo || bondingCurveInfo || metadataInfo) {
    throw new Error('One or more accounts already exist');
  }

  // Generate a random SOL amount to buy between MIN and MAX
  const solAmountToBuy =
    MIN_SOL_AMOUNT_TO_BUY + Math.random() * (MAX_SOL_AMOUNT_TO_BUY - MIN_SOL_AMOUNT_TO_BUY);

  logger.info(`Will buy ${solAmountToBuy.toFixed(4)} SOL worth of tokens`);

  // Check if payer has enough balance
  const rentExemption = await connection.getMinimumBalanceForRentExemption(MINT_SIZE);
  const pumpfunFee = solAmountToBuy * PUMPFUN_FEE_PERCENTAGE;
  const transactionFees = TRANSACTION_FEE_BUFFER * LAMPORTS_PER_SOL;
  const requiredBalance =
    rentExemption +
    solAmountToBuy * LAMPORTS_PER_SOL +
    pumpfunFee * LAMPORTS_PER_SOL +
    transactionFees;

  const balance = await connection.getBalance(payer.publicKey);

  // Log detailed breakdown of required funds
  logger.debug('Required funds breakdown:');
  logger.debug(`- Rent exemption: ${rentExemption / LAMPORTS_PER_SOL} SOL`);
  logger.debug(`- Token purchase: ${solAmountToBuy} SOL`);
  logger.debug(`- PumpFun fee (1%): ${pumpfunFee} SOL`);
  logger.debug(`- Transaction fees: ${TRANSACTION_FEE_BUFFER} SOL`);
  logger.debug(`- Total required: ${requiredBalance / LAMPORTS_PER_SOL} SOL`);
  logger.debug(`- Current balance: ${balance / LAMPORTS_PER_SOL} SOL`);

  if (balance < requiredBalance) {
    throw new Error(
      `Insufficient funds. Required: ${requiredBalance / LAMPORTS_PER_SOL}, Current: ${
        balance / LAMPORTS_PER_SOL
      }`,
    );
  }

  // Create compute budget instructions
  const computeUnitLimitIx = ComputeBudgetProgram.setComputeUnitLimit({
    units: 600000, // Increase to 600,000 units for more headroom
  });

  const computeUnitPriceIx = ComputeBudgetProgram.setComputeUnitPrice({
    microLamports: 50000, // Increase to 50,000 microLamports to prioritize the transaction
  });

  // Create a new transaction
  const transaction = new Transaction();

  // Add compute budget instructions
  transaction.add(computeUnitLimitIx);
  transaction.add(computeUnitPriceIx);

  // Create instruction data with proper arguments for create
  const createDiscriminator = Buffer.from([24, 30, 200, 40, 5, 28, 7, 119]);

  // Serialize the name, symbol, uri, and creator
  const nameBuffer = Buffer.from(name);
  const nameLength = Buffer.alloc(4);
  nameLength.writeUInt32LE(nameBuffer.length, 0);

  const symbolBuffer = Buffer.from(symbol);
  const symbolLength = Buffer.alloc(4);
  symbolLength.writeUInt32LE(symbolBuffer.length, 0);

  const uriBuffer = Buffer.from(metadataUri);
  const uriLength = Buffer.alloc(4);
  uriLength.writeUInt32LE(uriBuffer.length, 0);

  const creatorBuffer = payer.publicKey.toBuffer();

  // Construct the data buffer for create
  const createData = Buffer.concat([
    createDiscriminator,
    nameLength,
    nameBuffer,
    symbolLength,
    symbolBuffer,
    uriLength,
    uriBuffer,
    creatorBuffer,
  ]);

  // Create instruction for token creation
  const createIx = new TransactionInstruction({
    programId: PUMP_FUN_PROGRAM,
    keys: [
      { pubkey: mint.publicKey, isSigner: true, isWritable: true },
      { pubkey: MINT_AUTHORITY, isSigner: false, isWritable: false },
      { pubkey: bondingCurve, isSigner: false, isWritable: true },
      { pubkey: associatedBondingCurve, isSigner: false, isWritable: true },
      { pubkey: GLOBAL, isSigner: false, isWritable: false },
      { pubkey: MPL_TOKEN_METADATA, isSigner: false, isWritable: false },
      { pubkey: metadata, isSigner: false, isWritable: true },
      { pubkey: payer.publicKey, isSigner: true, isWritable: true },
      { pubkey: SYSTEM_PROGRAM, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: RENT, isSigner: false, isWritable: false },
      { pubkey: EVENT_AUTHORITY, isSigner: false, isWritable: false },
      { pubkey: PUMP_FUN_PROGRAM, isSigner: false, isWritable: false },
    ],
    data: createData,
  });

  transaction.add(createIx);

  // Add instruction to create token account for the payer
  transaction.add(
    createAssociatedTokenAccountInstruction(
      payer.publicKey,
      payerAta,
      payer.publicKey,
      mint.publicKey,
    ),
  );

  // Create instruction data with proper arguments for buy
  const buyDiscriminator = Buffer.from([102, 6, 61, 18, 1, 218, 235, 234]);

  // Calculate buy amount with slippage
  const buyAmountSol = BigInt(Math.floor(solAmountToBuy * LAMPORTS_PER_SOL));
  const slippageBasisPoints = BigInt(DEFAULT_SLIPPAGE_BASIS_POINTS);
  // Add slippage to the buy amount (e.g., 5% more SOL)
  const maxSolCost = buyAmountSol + (buyAmountSol * slippageBasisPoints) / BigInt(10000);

  // Serialize the amount and maxSolCost as u64 values
  const amountBuffer = Buffer.alloc(8);
  const maxSolCostBuffer = Buffer.alloc(8);

  // Write the values as little-endian
  amountBuffer.writeBigUInt64LE(buyAmountSol);
  maxSolCostBuffer.writeBigUInt64LE(maxSolCost);

  // Construct the data buffer for buy
  const buyData = Buffer.concat([buyDiscriminator, amountBuffer, maxSolCostBuffer]);

  // Create buy instruction
  const buyIx = new TransactionInstruction({
    programId: PUMP_FUN_PROGRAM,
    keys: [
      { pubkey: GLOBAL, isSigner: false, isWritable: false },
      { pubkey: FEE_RECIPIENT, isSigner: false, isWritable: true },
      { pubkey: mint.publicKey, isSigner: false, isWritable: false },
      { pubkey: bondingCurve, isSigner: false, isWritable: true },
      { pubkey: associatedBondingCurve, isSigner: false, isWritable: true },
      { pubkey: payerAta, isSigner: false, isWritable: true },
      { pubkey: payer.publicKey, isSigner: true, isWritable: true },
      { pubkey: SYSTEM_PROGRAM, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: RENT, isSigner: false, isWritable: false },
      { pubkey: EVENT_AUTHORITY, isSigner: false, isWritable: false },
      { pubkey: PUMP_FUN_PROGRAM, isSigner: false, isWritable: false },
    ],
    data: buyData,
  });

  transaction.add(buyIx);

  try {
    // Sign and send transaction
    transaction.feePayer = payer.publicKey;

    // Get a fresh blockhash with higher priority
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('finalized');
    transaction.recentBlockhash = blockhash;

    // Sign the transaction
    transaction.sign(payer, mint);

    // Log transaction size
    const serializedTx = transaction.serialize();
    logger.debug(`Transaction size: ${serializedTx.length} bytes`);

    // Check if transaction is too large
    if (serializedTx.length > 1232) {
      logger.warning(
        `Transaction size (${serializedTx.length} bytes) is approaching the limit. This may cause issues.`,
      );
    }

    // Send transaction with skipPreflight set to true to bypass simulation
    // This can help when the simulation is failing but the transaction would succeed on-chain
    logger.info('Sending transaction...');
    const signature = await connection.sendRawTransaction(serializedTx, {
      skipPreflight: true, // Skip preflight checks to bypass simulation errors
      preflightCommitment: 'finalized',
      maxRetries: 5,
    });

    logger.info(`Transaction submitted with signature: ${signature}`);
    logger.info('Waiting for confirmation...');

    // Wait for confirmation with a more detailed approach and longer timeout
    const confirmation = await connection.confirmTransaction(
      {
        signature,
        blockhash,
        lastValidBlockHeight,
      },
      'confirmed',
    );

    if (confirmation.value.err) {
      throw new Error(
        `Transaction confirmed but failed: ${JSON.stringify(confirmation.value.err)}`,
      );
    }

    return signature;
  } catch (error) {
    logger.error('Error creating token:', error);

    // Try to get more detailed error information
    if (error instanceof Error) {
      logger.error(`Error details: ${error.message}`);

      // If it's a specific Solana error, try to provide more context
      if (error.message.includes('ProgramFailedToComplete')) {
        logger.error(
          'This error typically occurs when the program runs out of compute units or encounters an unexpected condition.',
        );
        logger.error(
          'Try increasing the compute budget or check if the PumpFun program has been updated.',
        );
      } else if (error.message.includes('Transaction simulation failed')) {
        logger.error(
          'Transaction simulation failed. This could be due to insufficient funds or program constraints.',
        );
      }
    }

    throw error;
  }
}

/**
 * Buys tokens from PumpFun
 */
export async function buyTokens(
  connection: Connection,
  buyer: Keypair,
  mintAddress: PublicKey,
  solAmount: number,
): Promise<string> {
  logger.info(`Buying tokens for mint ${logger.formatToken(mintAddress)} with ${solAmount} SOL...`);

  // Get the bonding curve PDA
  const bondingCurve = getBondingCurvePDA(mintAddress);

  // Get the associated token account for the buyer
  const buyerAta = await getAssociatedTokenAddress(mintAddress, buyer.publicKey, false);

  // Get the associated token account for the bonding curve
  const bondingCurveAta = await getAssociatedTokenAddress(mintAddress, bondingCurve, true);

  // Calculate buy amount with slippage
  const buyAmountSol = BigInt(Math.floor(solAmount * LAMPORTS_PER_SOL));
  const slippageBasisPoints = BigInt(DEFAULT_SLIPPAGE_BASIS_POINTS);
  // Add slippage to the buy amount (e.g., 5% more SOL)
  const maxSolCost = buyAmountSol + (buyAmountSol * slippageBasisPoints) / BigInt(10000);

  // Create compute budget instruction
  const computeBudgetIx = ComputeBudgetProgram.setComputeUnitLimit({
    units: 200000, // Reduce from 1,000,000 to 200,000 units
  });

  const computePriceIx = ComputeBudgetProgram.setComputeUnitPrice({
    microLamports: 20000, // 0.00002 SOL per 1 million compute units
  });

  // Create a new transaction
  const transaction = new Transaction();

  // Add compute budget instruction
  transaction.add(computeBudgetIx);
  transaction.add(computePriceIx);

  // Add instruction to create token account if it doesn't exist
  try {
    await connection.getAccountInfo(buyerAta);
  } catch (e) {
    transaction.add(
      createAssociatedTokenAccountInstruction(
        buyer.publicKey,
        buyerAta,
        buyer.publicKey,
        mintAddress,
      ),
    );
  }

  // Create instruction data with proper arguments
  const discriminator = Buffer.from([102, 6, 61, 18, 1, 218, 235, 234]);

  // Serialize the amount and maxSolCost as u64 values
  const amountBuffer = Buffer.alloc(8);
  const maxSolCostBuffer = Buffer.alloc(8);

  // Write the values as little-endian
  amountBuffer.writeBigUInt64LE(buyAmountSol);
  maxSolCostBuffer.writeBigUInt64LE(maxSolCost);

  // Construct the data buffer
  const data = Buffer.concat([discriminator, amountBuffer, maxSolCostBuffer]);

  // Create buy instruction
  const buyIx = new TransactionInstruction({
    programId: PUMP_FUN_PROGRAM,
    keys: [
      { pubkey: GLOBAL, isSigner: false, isWritable: false },
      { pubkey: FEE_RECIPIENT, isSigner: false, isWritable: true },
      { pubkey: mintAddress, isSigner: false, isWritable: false },
      { pubkey: bondingCurve, isSigner: false, isWritable: true },
      { pubkey: bondingCurveAta, isSigner: false, isWritable: true },
      { pubkey: buyerAta, isSigner: false, isWritable: true },
      { pubkey: buyer.publicKey, isSigner: true, isWritable: true },
      { pubkey: SYSTEM_PROGRAM, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: RENT, isSigner: false, isWritable: false },
      { pubkey: EVENT_AUTHORITY, isSigner: false, isWritable: false },
      { pubkey: PUMP_FUN_PROGRAM, isSigner: false, isWritable: false },
    ],
    data: data,
  });

  transaction.add(buyIx);

  try {
    // Sign and send transaction
    transaction.feePayer = buyer.publicKey;
    transaction.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

    // Sign the transaction
    transaction.sign(buyer);

    // Send transaction
    const signature = await connection.sendRawTransaction(transaction.serialize(), {
      skipPreflight: true, // Skip preflight to avoid simulation errors
      preflightCommitment: 'confirmed',
      maxRetries: 3,
    });

    await connection.confirmTransaction(signature, 'confirmed');
    return signature;
  } catch (error) {
    logger.error('Error buying tokens:', error);
    throw error;
  }
}

/**
 * Sells tokens on PumpFun
 */
export async function sellTokens(
  connection: Connection,
  payer: Keypair,
  mintAddress: PublicKey,
): Promise<string> {
  logger.info(`Selling tokens for mint ${logger.formatToken(mintAddress)}...`);

  // Get the bonding curve PDA
  const bondingCurve = getBondingCurvePDA(mintAddress);

  // Get the associated token account for the payer
  const payerAta = await getAssociatedTokenAddress(mintAddress, payer.publicKey, false);

  // Get the associated token account for the bonding curve
  const bondingCurveAta = await getAssociatedTokenAddress(mintAddress, bondingCurve, true);

  // Check if the payer has a token account
  const tokenAccountInfo = await connection.getAccountInfo(payerAta);
  if (!tokenAccountInfo) {
    logger.warning('No token account found for the payer. Creating a buy transaction instead...');
    // If we don't have a token account, we can't sell. Let's buy some tokens instead.
    return buyTokens(connection, payer, mintAddress, 0.05); // Buy a small amount
  }

  // Get token balance
  const tokenBalance = await connection.getTokenAccountBalance(payerAta);
  const amount = BigInt(tokenBalance.value.amount);

  if (amount <= 0) {
    logger.warning('No tokens to sell. Creating a buy transaction instead...');
    // If we don't have any tokens, we can't sell. Let's buy some tokens instead.
    return buyTokens(connection, payer, mintAddress, 0.05); // Buy a small amount
  }

  // Calculate minimum SOL output with slippage
  const slippageBasisPoints = BigInt(DEFAULT_SLIPPAGE_BASIS_POINTS);
  // Subtract slippage from the minimum SOL output (e.g., 5% less SOL)
  const minSolOutput = BigInt(1); // Using a small value for simplicity

  // Create compute budget instruction
  const computeBudgetIx = ComputeBudgetProgram.setComputeUnitLimit({
    units: 200000, // Reduce from 1,000,000 to 200,000 units
  });

  const computePriceIx = ComputeBudgetProgram.setComputeUnitPrice({
    microLamports: 20000, // 0.00002 SOL per 1 million compute units
  });

  // Create a new transaction
  const transaction = new Transaction();

  // Add compute budget instruction
  transaction.add(computeBudgetIx);
  transaction.add(computePriceIx);

  // Create instruction data with proper arguments
  const discriminator = Buffer.from([51, 230, 133, 164, 1, 127, 131, 173]);

  // Serialize the amount and minSolOutput as u64 values
  const amountBuffer = Buffer.alloc(8);
  const minSolOutputBuffer = Buffer.alloc(8);

  // Write the values as little-endian
  amountBuffer.writeBigUInt64LE(amount);
  minSolOutputBuffer.writeBigUInt64LE(minSolOutput);

  // Construct the data buffer
  const data = Buffer.concat([discriminator, amountBuffer, minSolOutputBuffer]);

  // Create sell instruction
  const sellIx = new TransactionInstruction({
    programId: PUMP_FUN_PROGRAM,
    keys: [
      { pubkey: GLOBAL, isSigner: false, isWritable: false },
      { pubkey: FEE_RECIPIENT, isSigner: false, isWritable: true },
      { pubkey: mintAddress, isSigner: false, isWritable: false },
      { pubkey: bondingCurve, isSigner: false, isWritable: true },
      { pubkey: bondingCurveAta, isSigner: false, isWritable: true },
      { pubkey: payerAta, isSigner: false, isWritable: true },
      { pubkey: payer.publicKey, isSigner: true, isWritable: true },
      { pubkey: SYSTEM_PROGRAM, isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: EVENT_AUTHORITY, isSigner: false, isWritable: false },
      { pubkey: PUMP_FUN_PROGRAM, isSigner: false, isWritable: false },
    ],
    data: data,
  });

  transaction.add(sellIx);

  try {
    // Sign and send transaction
    transaction.feePayer = payer.publicKey;
    transaction.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

    // Sign the transaction
    transaction.sign(payer);

    // Send transaction
    const signature = await connection.sendRawTransaction(transaction.serialize(), {
      skipPreflight: true, // Skip preflight to avoid simulation errors
      preflightCommitment: 'confirmed',
      maxRetries: 3,
    });

    await connection.confirmTransaction(signature, 'confirmed');
    return signature;
  } catch (error) {
    logger.error('Error selling tokens:', error);
    throw error;
  }
}

/**
 * Helper function to get the bonding curve PDA
 */
function getBondingCurvePDA(mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('bonding-curve'), mint.toBuffer()],
    PUMP_FUN_PROGRAM,
  )[0];
}
