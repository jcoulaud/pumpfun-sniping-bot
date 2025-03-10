import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  GLOBAL,
  MAX_SOL_AMOUNT_TO_BUY,
  MIN_SOL_AMOUNT_TO_BUY,
  MINT_AUTHORITY,
  MINT_SIZE,
  MPL_TOKEN_METADATA,
  PUMP_FUN_ACCOUNT,
  PUMP_FUN_FEE_RECIPIENT,
  PUMP_FUN_PROGRAM,
  RENT,
  SYSTEM_PROGRAM,
} from '../config/constants';

/**
 * Buffer utility functions
 */
function bufferFromString(str: string): Buffer {
  const nullTerminatedString = str + '\0';
  const buffer = Buffer.alloc(nullTerminatedString.length);
  buffer.write(nullTerminatedString);
  return buffer;
}

function bufferFromUInt64(num: number): Buffer {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64LE(BigInt(num), 0);
  return buffer;
}

/**
 * Creates a token on PumpFun
 * @param connection Solana connection
 * @param payer Wallet keypair
 * @param mint Mint keypair
 * @param name Token name
 * @param symbol Token symbol
 * @param metadataUri IPFS URI of the token metadata
 * @returns Transaction signature
 */
export async function createToken(
  connection: Connection,
  payer: Keypair,
  mint: Keypair,
  name: string,
  symbol: string,
  metadataUri: string,
): Promise<string> {
  console.log(`Creating token ${name} (${symbol}) on PumpFun...`);

  // Generate a random SOL amount to buy between MIN and MAX
  const solAmountToBuy =
    MIN_SOL_AMOUNT_TO_BUY + Math.random() * (MAX_SOL_AMOUNT_TO_BUY - MIN_SOL_AMOUNT_TO_BUY);

  console.log(`Will buy ${solAmountToBuy.toFixed(4)} SOL worth of tokens`);

  // Get all PDAs
  const [bondingCurve] = PublicKey.findProgramAddressSync(
    [Buffer.from('bonding-curve'), mint.publicKey.toBuffer()],
    PUMP_FUN_PROGRAM,
  );
  const [metadata] = PublicKey.findProgramAddressSync(
    [Buffer.from('metadata'), MPL_TOKEN_METADATA.toBuffer(), mint.publicKey.toBuffer()],
    MPL_TOKEN_METADATA,
  );

  const [associatedBondingCurve] = PublicKey.findProgramAddressSync(
    [bondingCurve.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.publicKey.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );

  // Check if accounts already exist
  const [mintInfo, bondingCurveInfo, metadataInfo] = await Promise.all([
    connection.getAccountInfo(mint.publicKey),
    connection.getAccountInfo(bondingCurve),
    connection.getAccountInfo(metadata),
  ]);

  if (mintInfo || bondingCurveInfo || metadataInfo) {
    throw new Error('One or more accounts already exist');
  }

  // Check if payer has enough balance
  const requiredBalance =
    (await connection.getMinimumBalanceForRentExemption(MINT_SIZE)) +
    solAmountToBuy * LAMPORTS_PER_SOL +
    0.05 * LAMPORTS_PER_SOL; // Additional 0.05 SOL for fees

  const balance = await connection.getBalance(payer.publicKey);
  if (balance < requiredBalance) {
    throw new Error(
      `Insufficient funds. Required: ${requiredBalance / LAMPORTS_PER_SOL}, Current: ${
        balance / LAMPORTS_PER_SOL
      }`,
    );
  }

  // Create compute budget instructions
  const computeUnitLimitIx = ComputeBudgetProgram.setComputeUnitLimit({
    units: 400000,
  });

  const computeUnitPriceIx = ComputeBudgetProgram.setComputeUnitPrice({
    microLamports: 1_000_000, // 0.001 SOL per 1 million compute units
  });

  // Create token instruction with updated instruction index
  const createTokenIx = new TransactionInstruction({
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
      { pubkey: PUMP_FUN_ACCOUNT, isSigner: false, isWritable: true },
      { pubkey: PUMP_FUN_FEE_RECIPIENT, isSigner: false, isWritable: true },
    ],
    data: Buffer.concat([
      Buffer.from([1]), // Using instruction index 1 instead of 0
      bufferFromString(name),
      bufferFromString(symbol),
      bufferFromString(metadataUri),
      bufferFromUInt64(Math.floor(solAmountToBuy * LAMPORTS_PER_SOL)),
    ]),
  });

  try {
    // Get recent blockhash
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');

    // Create transaction
    const messageV0 = new TransactionMessage({
      payerKey: payer.publicKey,
      recentBlockhash: blockhash,
      instructions: [computeUnitLimitIx, computeUnitPriceIx, createTokenIx],
    }).compileToV0Message();

    // Create and sign transaction
    const transaction = new VersionedTransaction(messageV0);
    transaction.sign([payer, mint]);

    // Send transaction
    const signature = await connection.sendTransaction(transaction, {
      skipPreflight: false,
      preflightCommitment: 'confirmed',
      maxRetries: 3,
    });

    console.log(`Token created successfully! Signature: ${signature}`);
    return signature;
  } catch (error) {
    console.error('Error creating token:', error);
    throw error;
  }
}

/**
 * Sells tokens from a wallet
 * @param connection Solana connection
 * @param payer Wallet keypair
 * @param mintAddress Mint address of the token
 * @returns Transaction signature
 */
export async function sellTokens(
  connection: Connection,
  payer: Keypair,
  mintAddress: PublicKey,
): Promise<string> {
  console.log(`Selling tokens for mint ${mintAddress.toString()}...`);

  // Get the bonding curve PDA
  const [bondingCurve] = await PublicKey.findProgramAddress(
    [Buffer.from('bonding-curve'), mintAddress.toBuffer()],
    PUMP_FUN_PROGRAM,
  );

  // Get the associated token account for the payer
  const [payerAta] = PublicKey.findProgramAddressSync(
    [payer.publicKey.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mintAddress.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );

  // Get the associated token account for the bonding curve
  const [bondingCurveAta] = PublicKey.findProgramAddressSync(
    [bondingCurve.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mintAddress.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );

  // Check if the payer has any tokens
  const tokenAccountInfo = await connection.getAccountInfo(payerAta);
  if (!tokenAccountInfo) {
    throw new Error('No token account found for the payer');
  }

  // Create compute budget instruction
  const computeBudgetIx = ComputeBudgetProgram.setComputeUnitLimit({
    units: 400000,
  });

  // Create sell instruction
  const sellTokensIx = new TransactionInstruction({
    programId: PUMP_FUN_PROGRAM,
    keys: [
      { pubkey: payer.publicKey, isSigner: true, isWritable: true },
      { pubkey: mintAddress, isSigner: false, isWritable: true },
      { pubkey: bondingCurve, isSigner: false, isWritable: true },
      { pubkey: bondingCurveAta, isSigner: false, isWritable: true },
      { pubkey: payerAta, isSigner: false, isWritable: true },
      { pubkey: GLOBAL, isSigner: false, isWritable: false },
      { pubkey: PUMP_FUN_ACCOUNT, isSigner: false, isWritable: true },
      { pubkey: PUMP_FUN_FEE_RECIPIENT, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SYSTEM_PROGRAM, isSigner: false, isWritable: false },
    ],
    data: Buffer.from([2]), // Sell instruction (2)
  });

  try {
    // Get recent blockhash
    const { blockhash } = await connection.getLatestBlockhash();

    // Create transaction message
    const messageV0 = new TransactionMessage({
      payerKey: payer.publicKey,
      recentBlockhash: blockhash,
      instructions: [computeBudgetIx, sellTokensIx],
    }).compileToV0Message();

    // Create and sign transaction
    const transaction = new VersionedTransaction(messageV0);
    transaction.sign([payer]);

    // Send transaction
    const signature = await connection.sendTransaction(transaction, {
      skipPreflight: false,
      preflightCommitment: 'confirmed',
      maxRetries: 3,
    });

    console.log(`Tokens sold successfully! Signature: ${signature}`);
    return signature;
  } catch (error) {
    console.error('Error selling tokens:', error);
    throw error;
  }
}
