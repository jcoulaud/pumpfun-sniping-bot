import { PublicKey, SYSVAR_RENT_PUBKEY, SystemProgram } from '@solana/web3.js';

// Program and account constants
export const GLOBAL = new PublicKey('4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf');
export const SYSTEM_PROGRAM = SystemProgram.programId;
export const RENT = SYSVAR_RENT_PUBKEY;
export const PUMP_FUN_PROGRAM = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');
export const MPL_TOKEN_METADATA = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s');
export const MINT_AUTHORITY = PublicKey.findProgramAddressSync(
  [Buffer.from('mint-authority')],
  PUMP_FUN_PROGRAM,
)[0];
export const COMPUTE_BUDGET_PROGRAM_ID = new PublicKey(
  'ComputeBudget111111111111111111111111111111',
);
export const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey(
  'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
);
export const EVENT_AUTHORITY = new PublicKey('Ce6TQqeHC9p8KetsN6JsjHK7UTZk7nasjjnr7XxXp9F1');
export const FEE_RECIPIENT = new PublicKey('CebN5WGQ4jvEPvsVU4EoHEpgzq1VV7AbicfhtW4xC9iM');

// Mint size for rent calculation
export const MINT_SIZE = 82;

// Configuration constants
export const MIN_SOL_AMOUNT_TO_BUY = 0.8;
export const MAX_SOL_AMOUNT_TO_BUY = 1.1;
export const TRANSACTION_FEE_BUFFER = 0.001; // Buffer for transaction fees (in SOL)
export const PUMPFUN_FEE_PERCENTAGE = 0.01; // 1% fee charged by PumpFun for buys/sells on the bonding curve
export const SELL_TIMEOUT_MS = 10000; // 10 seconds
export const WALLET_DIRECTORY = 'wallets';
export const MAX_TOKEN_NAME_LENGTH = 20;
export const MAX_TOKEN_SYMBOL_LENGTH = 10;

// Default commitment and finality
export const DEFAULT_COMMITMENT = 'confirmed';
export const DEFAULT_FINALITY = 'finalized';

// Slippage basis points (500 = 5%)
export const DEFAULT_SLIPPAGE_BASIS_POINTS = 500;
