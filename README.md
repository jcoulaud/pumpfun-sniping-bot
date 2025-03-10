# PumpFun Bot

An automated token creation and trading bot for Solana using PumpFun.

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

## Prerequisites

- Node.js v18.12 or higher
- pnpm (preferred package manager)
- API keys for:
  - Claude AI
  - Replicate
  - Pinata (for IPFS storage)
  - Helius (for Solana RPC)

## Setup

1. Clone the repository
2. Install dependencies:
   ```
   pnpm install
   ```
3. Create a `.env` file with your API keys (see `.env.example`)
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

## Version Control

The project's `.gitignore` file excludes sensitive and unnecessary files:

- Environment variables (`.env`)
- Wallet files (`wallets/`)
- Dependencies (`node_modules/`)
- Build output (`dist/`)

## License

ISC
