# PumpFun Bot

An automated token creation and sniping bot for Solana using PumpFun. Creates tokens and monitors for sniper buys, then sells immediately after for quick profits.

## Features

- Generates token metadata using Claude API
- Creates images using Replicate API
- Uploads metadata and images to IPFS using Pinata
- Creates tokens on PumpFun
- Buys a portion of the supply during token creation
- Monitors transactions and sells tokens based on conditions
- Creates a new wallet for each run
- Transfers funds between wallets
- Saves wallets in JSON format with base58-encoded keys for compatibility
- Tracks performance and profit/loss metrics

## Prerequisites

- Node.js v18.12 or higher
- pnpm (preferred package manager)
- API keys for:
  - Claude AI (for token metadata generation)
  - Replicate (for image generation)
  - Pinata (for IPFS storage)
  - Helius (for Solana RPC access)

## Project Structure

```
pumpfun-bot/
├── src/                  # Source code
│   ├── config/           # Configuration files
│   ├── services/         # Service modules
│   ├── utils/            # Utility functions
│   └── index.ts          # Main entry point
├── dist/                 # Compiled JavaScript output
├── wallets/              # Generated wallet files (gitignored)
├── pnl/                  # Profit and loss tracking
├── temp/                 # Temporary files
├── .env                  # Environment variables (gitignored)
├── .env.example          # Example environment variables
├── package.json          # Project dependencies and scripts
└── tsconfig.json         # TypeScript configuration
```

## Setup

1. Clone the repository
2. Install dependencies:
   ```
   pnpm install
   ```
3. Create a `.env` file with your API keys (see `.env.example`):
   ```
   REPLICATE_API_TOKEN=your_replicate_api_token
   HELIUS_API_KEY=your_helius_api_key
   CLAUDE_API_KEY=your_claude_api_key
   PINATA_JWT=your_pinata_jwt
   PINATA_GATEWAY=your_pinata_gateway
   ```
4. Build the project:
   ```
   pnpm run build
   ```

## Usage

Start the bot in development mode:

```
pnpm run dev
```

Or build and start in production mode:

```
pnpm run build
pnpm start
```

The bot will:

1. Create a new wallet
2. Generate token metadata and image
3. Upload to IPFS
4. Create a token on PumpFun
5. Buy a portion of the supply
6. Monitor transactions
7. Sell tokens based on conditions
8. Transfer funds to a new wallet and repeat
9. Track performance metrics

## Available Scripts

- `pnpm run build` - Compile TypeScript to JavaScript
- `pnpm start` - Run the compiled JavaScript
- `pnpm run dev` - Run the bot in development mode using tsx
- `pnpm run lint` - Run ESLint to check code quality

## Configuration

Edit the `.env` file to customize:

- API keys (required)
- Other configuration parameters

## Security

Wallet private keys are stored locally in the `wallets` directory as JSON files containing:

- The public key as a string
- The secret key as an array of numbers
- The secret key as a base58-encoded string for easy import into other Solana tools

These files are excluded from git by default via the `.gitignore` file.

## Performance Tracking

The bot tracks performance metrics in the `pnl` directory, allowing you to monitor:

- Token creation success rate
- Trading performance
- Profit and loss metrics

## Version Control

The project's `.gitignore` file excludes sensitive and unnecessary files:

- Environment variables (`.env`)
- Wallet files (`wallets/`)
- Dependencies (`node_modules/`)
- Build output (`dist/`)
- Temporary files (`temp/`)

## License

ISC
