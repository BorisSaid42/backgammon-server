# Backgammon Club — Server

Backend service that handles all payment logic, game state, and payouts.

## Architecture

```
Player A (Phantom) ──> SOL transfer ──> House Wallet
                                            │
Player B (Phantom) ──> SOL transfer ──> House Wallet
                                            │
                                     Server verifies
                                     tx on-chain before
                                     updating game state
                                            │
                                    Game ends ──> Server
                                    sends payout from
                                    house wallet to winner
```

The frontend NEVER touches payment logic. It only:
1. Builds a transaction and asks Phantom to sign it
2. Sends the tx signature to this server
3. Server verifies the tx actually landed on-chain before doing anything

## Environment Variables (set in Railway)

| Variable | Description |
|---|---|
| `HELIUS_RPC` | Helius mainnet RPC URL |
| `HOUSE_KEYPAIR` | Base58-encoded secret key of house wallet |
| `FRONTEND_URL` | Your frontend URL for CORS |

## Generating a House Wallet

```bash
# Install Solana CLI
sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"

# Generate keypair
solana-keygen new --outfile house-wallet.json

# Get the public key
solana-keygen pubkey house-wallet.json

# Convert secret key to base58 for the HOUSE_KEYPAIR env var
node -e "
  import('bs58').then(bs58 => {
    const key = JSON.parse(require('fs').readFileSync('house-wallet.json'));
    console.log(bs58.default.encode(Buffer.from(key)));
  });
"
```

**IMPORTANT:** Keep `house-wallet.json` secure. Never commit it. The base58
key goes ONLY in Railway environment variables.

## API Endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/health` | Health check, returns house pubkey |
| GET | `/house` | Returns house wallet public key |
| POST | `/lobby/create` | Create lobby with wager |
| POST | `/lobby/:id/join` | Join lobby, pay wager |
| GET | `/lobby/:id` | Poll game state |
| POST | `/lobby/:id/start` | Host starts the game |
| POST | `/lobby/:id/move` | Submit moves |
| POST | `/lobby/:id/double` | Offer doubling cube |
| POST | `/lobby/:id/double-response` | Accept/beaver/drop |

## Deploy to Railway

1. Push to a separate GitHub repo
2. Create a new Railway service from that repo
3. Set environment variables
4. It auto-deploys
