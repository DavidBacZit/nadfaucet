import Database from "better-sqlite3"
import { fileURLToPath } from "url"
import { dirname, join } from "path"
import crypto from "crypto"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// Initialize SQLite database
const db = new Database(join(__dirname, "..", "faucet.db"))

console.log("[v0] Setting up PoW Faucet database schema...")

// Enable WAL mode for better concurrent access
db.pragma("journal_mode = WAL")

// Create tables as per specification
db.exec(`
  -- Key/value meta storage for current block state
  CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    val TEXT NOT NULL
  );

  -- Block records
  CREATE TABLE IF NOT EXISTS blocks (
    block_number INTEGER PRIMARY KEY,
    seed_hex TEXT NOT NULL,
    processed_at INTEGER
  );

  -- Accepted shares from miners
  CREATE TABLE IF NOT EXISTS shares (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    block_number INTEGER NOT NULL,
    address TEXT NOT NULL,
    nonce TEXT NOT NULL,
    hash_hex TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    UNIQUE(block_number, address, nonce)
  );

  -- User balances in micro-tokens (6 decimal places)
  CREATE TABLE IF NOT EXISTS balances (
    address TEXT PRIMARY KEY,
    balance_micro INTEGER NOT NULL DEFAULT 0
  );

  -- Withdrawal requests and payouts
  CREATE TABLE IF NOT EXISTS payouts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    address TEXT NOT NULL,
    amount_micro INTEGER NOT NULL,
    fee_micro INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    tx_hash TEXT
  );
`)

// Create indexes for performance
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_shares_block ON shares(block_number);
  CREATE INDEX IF NOT EXISTS idx_shares_addr ON shares(address);
  CREATE INDEX IF NOT EXISTS idx_payouts_status ON payouts(status);
`)

// Helper function to generate random hex
function generateRandomHex(bytes) {
  return crypto.randomBytes(bytes).toString("hex")
}

// Initialize meta values if not exists
const initMeta = db.prepare("INSERT OR IGNORE INTO meta (key, val) VALUES (?, ?)")
initMeta.run("currentBlockNumber", "1")
initMeta.run("currentSeedHex", generateRandomHex(16))

console.log("[v0] Database schema created successfully!")
console.log("[v0] Initial block number: 1")
console.log("[v0] Database file: faucet.db")

db.close()
