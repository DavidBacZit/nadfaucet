import express from "express"
import cors from "cors"
import rateLimit from "express-rate-limit"
import { DatabaseManager } from "../lib/database.js"
import { computePoWHash, isValidAddress } from "../lib/crypto-utils.js"
import { BlockProcessor } from "./block-processor.js"

const app = express()

// Configuration from environment variables
const config = {
  PORT: Number.parseInt(process.env.PORT) || 3000,
  BLOCK_TIME_MS: Number.parseInt(process.env.BLOCK_TIME_MS) || 400,
  DIFFICULTY_BITS: Number.parseInt(process.env.DIFFICULTY_BITS) || 18,
  MAX_SHARES_PB: Number.parseInt(process.env.MAX_SHARES_PB) || 500,
  WITHDRAW_FEE_TOKENS: Number.parseInt(process.env.WITHDRAW_FEE_TOKENS) || 1000,
  POOL_A_REWARD_TOKENS: 50,
  POOL_B_REWARD_TOKENS: 50,
}

const WITHDRAW_FEE_MICRO = config.WITHDRAW_FEE_TOKENS * 1e6

// Initialize database and block processor
const db = new DatabaseManager()
const blockProcessor = new BlockProcessor(config)

blockProcessor.start()

// Middleware
app.use(cors())
app.use(express.json())

// Rate limiting
const generalLimiter = rateLimit({
  windowMs: 1000, // 1 second
  max: 100, // 100 requests per second per IP
  message: { ok: false, error: "Rate limit exceeded" },
})

const submitLimiter = rateLimit({
  windowMs: 1000, // 1 second
  max: 50, // 50 submissions per second per IP
  message: { ok: false, error: "Submission rate limit exceeded" },
})

app.use(generalLimiter)

// GET /challenge - Return current mining challenge
app.get("/challenge", (req, res) => {
  const stats = blockProcessor.getBlockStats()
  res.json({
    ok: true,
    blockNumber: stats.currentBlock,
    seedHex: stats.seedHex,
    difficultyBits: config.DIFFICULTY_BITS,
    blockTimeMs: config.BLOCK_TIME_MS,
    serverTimeMs: Date.now(),
    msLeft: stats.msLeft,
  })
})

// POST /submit-proof - Submit a mining share
app.post("/submit-proof", submitLimiter, (req, res) => {
  const { address, nonce } = req.body

  // Validate input presence
  if (!address || !nonce) {
    return res.status(400).json({
      ok: false,
      error: "Missing required fields: address, nonce",
    })
  }

  // Validate address format
  if (!isValidAddress(address)) {
    return res.status(400).json({
      ok: false,
      error: "Invalid Ethereum address format",
    })
  }

  try {
    // Use server's current block/seed at time of submission
    const currentBlock = blockProcessor.getCurrentBlockNumber()
    const currentSeed = blockProcessor.getCurrentSeedHex()

    // Per-address per-block share limit
    const currentShares = db.getShareCountForAddress(currentBlock, address)
    if (currentShares >= config.MAX_SHARES_PB) {
      return res.status(429).json({
        ok: false,
        error: `Maximum shares per block exceeded (${config.MAX_SHARES_PB})`,
      })
    }

    // Compute PoW using server's currentSeed/currentBlock
    const { hash, leadingZeroBits } = computePoWHash(address, currentBlock, currentSeed, nonce)

    if (leadingZeroBits < config.DIFFICULTY_BITS) {
      return res.status(400).json({
        ok: false,
        error: "Insufficient proof-of-work",
        required: config.DIFFICULTY_BITS,
        provided: leadingZeroBits,
      })
    }

    // Insert share (DB-level duplicate prevention expected)
    const inserted = db.insertShare(currentBlock, address, nonce, hash)
    if (!inserted) {
      return res.status(409).json({
        ok: false,
        error: "Duplicate share",
      })
    }

    console.log(`[v0] Share accepted: ${address} block=${currentBlock} difficulty=${leadingZeroBits} hash=${hash}`)

    return res.json({
      ok: true,
      accepted: true,
      blockNumber: currentBlock,
      leadingZeroBits,
      hash,
    })
  } catch (err) {
    // Distinguish transient vs permanent errors
    console.error("[v0] Error handling submit-proof:", err)
    // If DB or other transient error, return 503 so clients can retry/backoff
    return res.status(503).json({
      ok: false,
      error: "Server transient error, please retry",
      details: err.message,
    })
  }
})

// GET /status - Get user status and current block info
app.get("/status", (req, res) => {
  const { address } = req.query

  if (!address || !isValidAddress(address)) {
    return res.status(400).json({
      ok: false,
      error: "Valid address parameter required",
    })
  }

  const balanceMicro = db.getBalance(address)
  const stats = blockProcessor.getBlockStats()

  console.log(`[v0] Balance query: ${address} = ${balanceMicro} micro-tokens (${balanceMicro / 1e6} tokens)`)

  res.json({
    ok: true,
    blockNumber: stats.currentBlock,
    seedHex: stats.seedHex,
    difficultyBits: config.DIFFICULTY_BITS,
    blockTimeMs: config.BLOCK_TIME_MS,
    poolARewardMicro: config.POOL_A_REWARD_TOKENS * 1e6,
    poolBRewardMicro: config.POOL_B_REWARD_TOKENS * 1e6,
    balanceMicro,
    serverTimeMs: Date.now(),
    msLeft: stats.msLeft,
  })
})

// POST /withdraw-request - Request token withdrawal
app.post("/withdraw-request", (req, res) => {
  const { address, amountMicro } = req.body

  // Validate input
  if (!address || !isValidAddress(address)) {
    return res.status(400).json({
      ok: false,
      error: "Valid address required",
    })
  }

  if (!amountMicro || typeof amountMicro !== "number" || amountMicro <= 0) {
    return res.status(400).json({
      ok: false,
      error: "Valid amountMicro required",
    })
  }

  if (amountMicro <= WITHDRAW_FEE_MICRO) {
    return res.status(400).json({
      ok: false,
      error: `Amount must be greater than withdrawal fee (${config.WITHDRAW_FEE_TOKENS} tokens)`,
    })
  }

  // Check balance
  const currentBalance = db.getBalance(address)
  if (currentBalance < amountMicro) {
    return res.status(400).json({
      ok: false,
      error: "Insufficient balance",
      balance: currentBalance,
      requested: amountMicro,
    })
  }

  // Deduct balance and create payout
  const success = db.deductBalance(address, amountMicro)
  if (!success) {
    return res.status(500).json({
      ok: false,
      error: "Failed to deduct balance",
    })
  }

  const payoutId = db.createPayout(address, amountMicro, WITHDRAW_FEE_MICRO)

  console.log(
    `[v0] Withdrawal requested: ${address} amount=${amountMicro} fee=${WITHDRAW_FEE_MICRO} payout=${payoutId}`,
  )

  res.json({
    ok: true,
    status: "queued",
    payoutId,
    netAmount: amountMicro - WITHDRAW_FEE_MICRO,
    fee: WITHDRAW_FEE_MICRO,
  })
})

// GET /payouts - Admin endpoint to view payouts
app.get("/payouts", (req, res) => {
  const payouts = db.getPendingPayouts()
  res.json({
    ok: true,
    payouts,
  })
})

// Health check endpoint
app.get("/health", (req, res) => {
  const stats = blockProcessor.getBlockStats()
  res.json({
    ok: true,
    blockNumber: stats.currentBlock,
    uptime: process.uptime(),
    blockProcessor: {
      isProcessing: stats.isProcessing,
      msLeft: stats.msLeft,
    },
    config: {
      blockTimeMs: config.BLOCK_TIME_MS,
      difficultyBits: config.DIFFICULTY_BITS,
      maxSharesPB: config.MAX_SHARES_PB,
      withdrawFeeTokens: config.WITHDRAW_FEE_TOKENS,
    },
  })
})

// Error handling middleware
app.use((err, req, res, next) => {
  console.error("[v0] Server error:", err)
  res.status(500).json({
    ok: false,
    error: "Internal server error",
  })
})

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    ok: false,
    error: "Endpoint not found",
  })
})

// Graceful shutdown
process.on("SIGINT", () => {
  console.log("[v0] Shutting down gracefully...")
  blockProcessor.stop()
  process.exit(0)
})

process.on("SIGTERM", () => {
  console.log("[v0] Shutting down gracefully...")
  blockProcessor.stop()
  process.exit(0)
})

// Start server
app.listen(config.PORT, () => {
  console.log(`[v0] PoW Faucet server running on port ${config.PORT}`)
  console.log(`[v0] Block time: ${config.BLOCK_TIME_MS}ms`)
  console.log(`[v0] Difficulty: ${config.DIFFICULTY_BITS} bits`)
  console.log(`[v0] Pool A reward: ${config.POOL_A_REWARD_TOKENS} tokens`)
  console.log(`[v0] Pool B reward: ${config.POOL_B_REWARD_TOKENS} tokens`)
})
