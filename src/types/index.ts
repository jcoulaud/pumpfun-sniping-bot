export interface TokenMetadata {
  name: string;
  symbol: string;
  description: string;
  image?: string;
  showName?: boolean;
  createdOn?: string;
  twitter?: string;
  website?: string;
  telegram?: string;
}

export interface TokenCreationResult {
  signature: string;
  mintAddress: string;
  metadataUri: string;
}

export interface WalletData {
  publicKey: string;
  secretKey: number[];
  secretKeyBase58: string;
}

export interface ProfitData {
  totalProfit: number;
  cycles: CycleData[];
}

export interface CycleData {
  cycleId: number;
  profit: number;
  tokenAddress?: string;
  timestamp: string;
  initialBalance: number;
  finalBalance: number;
}

export interface BotConfig {
  connection: {
    rpcUrl: string;
    commitment: 'processed' | 'confirmed' | 'finalized';
  };
  trading: {
    minSolAmount: number;
    maxSolAmount: number;
    slippageBasisPoints: number;
    sellTimeoutMs: number;
    transactionFeeBuffer: number;
  };
  monitoring: {
    maxTransactionAge: number;
    confirmationTimeout: number;
    retryAttempts: number;
    retryDelay: number;
  };
}

export interface TransactionDetails {
  signature: string;
  type: 'BUY' | 'SELL' | 'CREATE';
  amount?: number;
  buyer?: string;
  timestamp: number;
}

export enum BotState {
  INITIALIZING = 'INITIALIZING',
  CREATING_TOKEN = 'CREATING_TOKEN',
  MONITORING = 'MONITORING',
  SELLING = 'SELLING',
  CALCULATING_PROFIT = 'CALCULATING_PROFIT',
  CLEANING_UP = 'CLEANING_UP',
  ERROR = 'ERROR',
}

export interface BotStatus {
  state: BotState;
  cycleId: number;
  currentToken?: string;
  walletAddress: string;
  balance: number;
  startTime: number;
  lastActivity: number;
}
