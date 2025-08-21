# Web PoW Faucet

A browser-based Proof-of-Work mining faucet with dual reward pools. Users mine shares in their browser and earn tokens through proportional rewards (Pool A) and weighted lottery (Pool B).

## Features

- **Browser Mining**: Client-side SHA-256 proof-of-work in Web Workers
- **Dual Reward System**: 
  - Pool A: Proportional rewards based on contributed shares
  - Pool B: Weighted lottery with single winner per block
- **Configurable Difficulty**: Adjustable mining difficulty and block times
- **Anti-Abuse Protection**: Share limits, rate limiting, duplicate prevention
- **Withdrawal System**: Off-chain balance management with configurable fees

## Quick Start

1. **Setup Database**
   \`\`\`bash
   npm install
   npm run setup-db
   \`\`\`

2. **Start Server**
   \`\`\`bash
   npm run server
   \`\`\`

3. **Start Frontend** (in another terminal)
   \`\`\`bash
   npm run dev
   \`\`\`

4. **Visit** http://localhost:3000

## Configuration

Copy `.env.example` to `.env` and adjust settings:

- `BLOCK_TIME_MS`: Block interval in milliseconds (default: 400)
- `DIFFICULTY_BITS`: Required leading zero bits for valid shares (default: 18)
- `MAX_SHARES_PB`: Maximum shares per address per block (default: 500)
- `WITHDRAW_FEE_TOKENS`: Flat withdrawal fee in tokens (default: 1000)

## API Endpoints

- `GET /challenge` - Get current mining challenge
- `POST /submit-proof` - Submit mining share
- `GET /status?address=0x...` - Get user balance and status
- `POST /withdraw-request` - Request token withdrawal
- `GET /payouts` - View pending payouts (admin)
- `GET /health` - Server health check

## Architecture

- **Server**: Express.js with SQLite database
- **Client**: Vanilla JavaScript with Web Worker mining
- **Database**: SQLite with better-sqlite3 for performance
- **Security**: Rate limiting, input validation, cryptographic verification

## Block Processing

Every 400ms (configurable):
1. Collect all valid shares for the completed block
2. **Pool A**: Distribute 50 tokens proportionally by share count
3. **Pool B**: Award 50 tokens to weighted random winner
4. Update user balances and start new block

## Mining Process

1. Client requests challenge from `/challenge`
2. Web Worker performs SHA-256 hashing with random nonces
3. Valid shares (meeting difficulty) submitted to `/submit-proof`
4. Server verifies proof-of-work and stores accepted shares
5. Rewards distributed when block completes

## Development

- `npm run setup-db` - Initialize database schema
- `npm run server` - Start API server
- `npm run dev` - Start Next.js frontend
- Database file: `faucet.db` (created automatically)

## Security Notes

- All proof-of-work verification happens server-side
- Duplicate shares are rejected per (block, address, nonce)
- Rate limiting prevents spam submissions
- Withdrawal fees prevent micro-transaction abuse
- Cryptographically secure randomness for seeds and lottery
