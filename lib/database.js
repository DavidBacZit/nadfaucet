import Database from "better-sqlite3"
import { fileURLToPath } from "url"
import { dirname, join } from "path"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// Singleton database connection
let db = null

export function getDatabase() {
  if (!db) {
    db = new Database(join(__dirname, "..", "faucet.db"))
    db.pragma("journal_mode = WAL")
  }
  return db
}

// Database helper functions
export class DatabaseManager {
  constructor() {
    this.db = getDatabase()
  }

  // Meta operations
  getMeta(key) {
    const stmt = this.db.prepare("SELECT val FROM meta WHERE key = ?")
    const result = stmt.get(key)
    return result ? result.val : null
  }

  setMeta(key, val) {
    const stmt = this.db.prepare("INSERT OR REPLACE INTO meta (key, val) VALUES (?, ?)")
    stmt.run(key, val)
  }

  // Block operations
  insertBlock(blockNumber, seedHex) {
    const stmt = this.db.prepare("INSERT INTO blocks (block_number, seed_hex) VALUES (?, ?)")
    stmt.run(blockNumber, seedHex)
  }

  markBlockProcessed(blockNumber) {
    const stmt = this.db.prepare("UPDATE blocks SET processed_at = ? WHERE block_number = ?")
    stmt.run(Date.now(), blockNumber)
  }

  // Share operations
  insertShare(blockNumber, address, nonce, hashHex) {
    const stmt = this.db.prepare(`
      INSERT INTO shares (block_number, address, nonce, hash_hex, created_at) 
      VALUES (?, ?, ?, ?, ?)
    `)
    try {
      stmt.run(blockNumber, address, nonce, hashHex, Date.now())
      return true
    } catch (error) {
      if (error.code === "SQLITE_CONSTRAINT_UNIQUE") {
        return false // Duplicate share
      }
      throw error
    }
  }

  getSharesForBlock(blockNumber) {
    const stmt = this.db.prepare("SELECT * FROM shares WHERE block_number = ?")
    return stmt.all(blockNumber)
  }

  getShareCountForAddress(blockNumber, address) {
    const stmt = this.db.prepare("SELECT COUNT(*) as count FROM shares WHERE block_number = ? AND address = ?")
    const result = stmt.get(blockNumber, address)
    return result.count
  }

  // Balance operations
  getBalance(address) {
    const stmt = this.db.prepare("SELECT balance_micro FROM balances WHERE address = ?")
    const result = stmt.get(address)
    return result ? result.balance_micro : 0
  }

  updateBalance(address, balanceMicro) {
    const stmt = this.db.prepare(`
      INSERT INTO balances (address, balance_micro) VALUES (?, ?)
      ON CONFLICT(address) DO UPDATE SET balance_micro = balance_micro + ?
    `)
    stmt.run(address, balanceMicro, balanceMicro)
  }

  deductBalance(address, amountMicro) {
    const stmt = this.db.prepare("UPDATE balances SET balance_micro = balance_micro - ? WHERE address = ?")
    const result = stmt.run(amountMicro, address)
    return result.changes > 0
  }

  // Payout operations
  createPayout(address, amountMicro, feeMicro) {
    const stmt = this.db.prepare(`
      INSERT INTO payouts (address, amount_micro, fee_micro, status, created_at, updated_at)
      VALUES (?, ?, ?, 'pending', ?, ?)
    `)
    const now = Date.now()
    const result = stmt.run(address, amountMicro - feeMicro, feeMicro, now, now)
    return result.lastInsertRowid
  }

  getPendingPayouts() {
    const stmt = this.db.prepare('SELECT * FROM payouts WHERE status = "pending" ORDER BY created_at ASC')
    return stmt.all()
  }

  updatePayoutStatus(id, status, txHash = null) {
    const stmt = this.db.prepare("UPDATE payouts SET status = ?, tx_hash = ?, updated_at = ? WHERE id = ?")
    stmt.run(status, txHash, Date.now(), id)
  }
}
