import { PublicKey, SYSVAR_RENT_PUBKEY, SystemProgram } from '@solana/web3.js';

// Program and account constants
export const GLOBAL = new PublicKey('4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf');
export const SYSTEM_PROGRAM = SystemProgram.programId;
export const RENT = SYSVAR_RENT_PUBKEY;
export const PUMP_FUN_ACCOUNT = new PublicKey('Ce6TQqeHC9p8KetsN6JsjHK7UTZk7nasjjnr7XxXp9F1');
export const PUMP_FUN_PROGRAM = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');
export const PUMP_FUN_FEE_RECIPIENT = new PublicKey('CebN5WGQ4jvEPvsVU4EoHEpgzq1VV7AbicfhtW4xC9iM');
export const MPL_TOKEN_METADATA = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s');
export const MINT_AUTHORITY = new PublicKey('TSLvdd1pWpHVjahSpsvCXUbgwsL3JAcvokwaKt1eokM');
export const COMPUTE_BUDGET_PROGRAM_ID = new PublicKey(
  'ComputeBudget111111111111111111111111111111',
);
export const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey(
  'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
);

// Mint size for rent calculation
export const MINT_SIZE = 82;

// Configuration constants
export const MIN_SOL_AMOUNT_TO_BUY = 0.05;
export const MAX_SOL_AMOUNT_TO_BUY = 0.1;
export const SELL_TIMEOUT_MS = 15000; // 15 seconds
export const WALLET_DIRECTORY = 'wallets';
export const MAX_TOKEN_NAME_LENGTH = 20;
export const MAX_TOKEN_SYMBOL_LENGTH = 10;
