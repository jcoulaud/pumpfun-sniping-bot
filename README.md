# PumpFun Bot

An automated trading bot for creating and trading tokens on pump.fun. The bot creates tokens, monitors for external purchases, and automatically sells for profit.

## Features

- **Automated Token Creation**: Uses OpenAI to generate token metadata and images
- **Smart Trading**: Monitors for external purchases and sells automatically
- **Profit Tracking**: Comprehensive profit/loss tracking across trading cycles
- **Robust Error Handling**: Retry mechanisms and graceful degradation
- **Production Ready**: TypeScript, proper logging, configuration management
- **Official SDK**: Uses the official pump.fun SDK for reliability

## Prerequisites

- Node.js 18+ and pnpm
- Helius API key (for Solana RPC)
- Pinata JWT and Gateway (for IPFS uploads)
- OpenAI API key (for metadata generation)
- Replicate API token (for image generation)
- Initial SOL funding (minimum 0.1 SOL recommended)

## Installation

1. Clone the repository:

```bash
git clone <repository-url>
cd pumpfun-bot
```

2. Install dependencies:

```bash
pnpm install
```

3. Set up environment variables:

```bash
cp env.example .env
# Edit .env with your API keys
```

4. Build the project:

```bash
pnpm build
```

## Configuration

Configure the bot by editing your `.env` file:

### Required Environment Variables

- `HELIUS_API_KEY`: Your Helius RPC API key
- `PINATA_JWT`: Your Pinata JWT token for IPFS uploads
- `PINATA_GATEWAY`: Your Pinata gateway URL
- `OPENAI_API_KEY`: Your OpenAI API key for metadata generation
- `REPLICATE_API_TOKEN`: Your Replicate API token for image generation

### Trading Configuration

The bot uses a percentage-based approach for token purchases:

- **Buy Amount**: Uses 70-80% of current wallet balance (randomized)
- **Maximum Cap**: 2 SOL per trade
- **Dynamic Scaling**: Automatically adjusts to available funds

Optional environment variables:

- `SLIPPAGE_BASIS_POINTS`: Maximum slippage in basis points (default: 500 = 5%)
- `SELL_TIMEOUT_SECONDS`: Time to wait before selling if no one buys (default: 20)
- `TRANSACTION_FEE_BUFFER`: Extra SOL to keep for transaction fees (default: 0.01)

### Monitoring Configuration

- `MAX_TRANSACTION_AGE_SECONDS`: Maximum age of transactions to process (default: 30)
- `CONFIRMATION_TIMEOUT_MS`: Timeout for transaction confirmations (default: 30000)
- `RETRY_ATTEMPTS`: Number of retry attempts for failed operations (default: 3)
- `RETRY_DELAY_MS`: Base delay between retries in milliseconds (default: 1000)

## Usage

### Running the Bot

Start the bot in production mode:

```bash
pnpm start
```

For development with auto-restart:

```bash
pnpm dev
```

### Initial Setup

1. **Fund Your Wallet**: The bot will create a new wallet on first run. Fund it with at least 0.1 SOL to get started.

2. **Monitor Logs**: The bot provides detailed logging of all operations, including profit/loss tracking.

3. **Profit Tracking**: Profit data is automatically saved to `./pnl/profit_log.json`

### Bot Behavior

1. **Token Creation**: Creates a new token with AI-generated metadata and image
2. **Initial Purchase**: Buys a random amount of the created token (between MIN/MAX SOL)
3. **Monitoring**: Watches for external purchases using WebSocket monitoring
4. **Auto-Sell**: Sells all tokens when someone else buys, or after timeout
5. **Profit Calculation**: Calculates and logs profit/loss for each cycle
6. **Repeat**: Automatically starts a new cycle with a fresh wallet

## Architecture

The bot is built with a clean, modular architecture:

```
src/
├── config/          # Configuration management
├── services/        # Core business logic
│   ├── botManager.ts      # Main bot orchestration
│   ├── tokenService.ts    # Token creation/trading
│   ├── metadataGenerator.ts # AI-powered metadata generation
│   └── transactionMonitor.ts # Real-time transaction monitoring
├── types/           # TypeScript interfaces
├── utils/           # Utilities (logging, retry, wallet)
└── index.ts         # Application entry point
```

### Key Components

- **BotManager**: Orchestrates the entire trading cycle and manages state
- **TokenService**: Handles token creation, buying, and selling using official SDK
- **TransactionMonitor**: Real-time monitoring of blockchain transactions
- **RetryUtils**: Robust error handling with exponential backoff
- **Configuration**: Environment-based configuration with validation

## Safety Features

- **Graceful Shutdown**: Proper cleanup on process termination
- **Error Recovery**: Automatic retry with exponential backoff
- **Wallet Management**: Secure wallet creation and fund transfers
- **Transaction Validation**: Input validation and error checking
- **Rate Limiting**: Built-in delays and retry limits

## Monitoring and Logging

The bot provides comprehensive logging:

- **Cycle Tracking**: Each trading cycle is numbered and tracked
- **Profit/Loss**: Detailed P&L reporting with percentages
- **Transaction Details**: Full transaction signatures and amounts
- **Error Reporting**: Detailed error messages and stack traces
- **State Changes**: Real-time bot state monitoring

### Log Levels

- `INFO`: General operational information
- `SUCCESS`: Successful operations (profits, completions)
- `WARNING`: Non-critical issues
- `ERROR`: Critical errors requiring attention
- `DEBUG`: Detailed debugging information

## Profit Tracking

Profit data is automatically tracked and stored:

```json
{
  "totalProfit": 0.045,
  "cycles": [
    {
      "cycleId": 1,
      "profit": 0.045,
      "tokenAddress": "...",
      "timestamp": "2024-01-01T00:00:00.000Z",
      "initialBalance": 1.0,
      "finalBalance": 1.045
    }
  ]
}
```

## Troubleshooting

### Common Issues

1. **"Missing required environment variables"**

   - Ensure all required API keys are set in `.env`

2. **"Insufficient balance"**

   - Fund your wallet with at least 0.1 SOL

3. **"Network connection issue"**

   - Check your internet connection and Helius API key

4. **"Token creation failed"**
   - Verify OpenAI and Pinata API keys are valid

### Performance Optimization

- Use a dedicated Helius endpoint for better performance
- Monitor RPC rate limits
- Adjust retry settings based on network conditions

## Security Considerations

- **Private Keys**: Wallet private keys are stored locally in `./wallets/`
- **API Keys**: Keep your `.env` file secure and never commit it
- **Network**: Use secure RPC endpoints (HTTPS)
- **Funds**: Only fund wallets with amounts you can afford to lose

## Disclaimer

This bot is for educational and research purposes. Cryptocurrency trading involves substantial risk of loss. The authors are not responsible for any financial losses incurred through the use of this software.

## License

[Add your license here]

## Support

For issues and questions:

1. Check the troubleshooting section above
2. Review the logs for error details
3. Ensure all API keys and configuration are correct
