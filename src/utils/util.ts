import { Commitment, Connection, Finality, PublicKey, Transaction } from '@solana/web3.js';

export const DEFAULT_COMMITMENT: Commitment = 'confirmed';
export const DEFAULT_FINALITY: Finality = 'finalized';

/**
 * Calculate buy amount with slippage
 */
export function calculateWithSlippageBuy(
  buyAmountSol: bigint,
  slippageBasisPoints: bigint,
): bigint {
  // Add slippage to the buy amount (e.g., 5% more SOL)
  return buyAmountSol + (buyAmountSol * slippageBasisPoints) / BigInt(10000);
}

/**
 * Calculate sell amount with slippage
 */
export function calculateWithSlippageSell(
  minSolOutput: bigint,
  slippageBasisPoints: bigint,
): bigint {
  // Subtract slippage from the minimum SOL output (e.g., 5% less SOL)
  return minSolOutput - (minSolOutput * slippageBasisPoints) / BigInt(10000);
}

/**
 * Send a transaction with optional priority fees
 */
export async function sendTx(
  connection: Connection,
  transaction: Transaction,
  payer: PublicKey,
  signers: any[],
  priorityFees?: any,
  commitment: Commitment = DEFAULT_COMMITMENT,
  finality: Finality = DEFAULT_FINALITY,
): Promise<any> {
  // Get recent blockhash
  const { blockhash } = await connection.getLatestBlockhash(commitment);
  transaction.recentBlockhash = blockhash;
  transaction.feePayer = payer;

  // Sign transaction
  transaction.sign(...signers);

  // Send transaction
  const signature = await connection.sendRawTransaction(transaction.serialize(), {
    skipPreflight: false,
    preflightCommitment: commitment,
  });

  // Confirm transaction
  await connection.confirmTransaction(
    {
      signature,
      blockhash,
      lastValidBlockHeight: (await connection.getLatestBlockhash()).lastValidBlockHeight,
    },
    finality,
  );

  return {
    signature,
    blockhash,
  };
}
