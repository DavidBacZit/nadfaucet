import dotenv from "dotenv"
dotenv.config()

import express from "express"
import cors from "cors"
import rateLimit from "express-rate-limit"
import { DatabaseManager } from "../lib/database.js"
import { computePoWHash, isValidAddress } from "../lib/crypto-utils.js"
import { BlockProcessor } from "/home/user/nadfaucet/server/block-processor.js"
import { ethers } from "ethers"

const app = express()

const config = {
  PORT: 3000,
  BLOCK_TIME_MS: 60000,
  DIFFICULTY_BITS: 1,
  MAX_SHARES_PB: 100000,
  WITHDRAW_FEE_TOKENS: 1000,
  POOL_A_REWARD_TOKENS: 17500,
  POOL_B_REWARD_TOKENS: 27500,
  POOL_C_REWARD_TOKENS: 9000,
}

const WITHDRAW_FEE_MICRO = config.WITHDRAW_FEE_TOKENS * 1e6

const db = new DatabaseManager()
const blockProcessor = new BlockProcessor(config)

blockProcessor.start()

app.use(cors())
app.use(express.json())

const generalLimiter = rateLimit({
  windowMs: 1000000,
  max: 1000000,
  message: { ok: false, error: "Rate limit exceeded" },
})

const submitLimiter = rateLimit({
  windowMs: 1000000,
  max: 10000000,
  message: { ok: false, error: "Submission rate limit exceeded" },
})

app.use(generalLimiter)

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

app.post("/submit-proof", submitLimiter, (req, res) => {
  const { address, blockNumber, nonce } = req.body
  const currentBlock = blockProcessor.getCurrentBlockNumber()
  const currentSeed = blockProcessor.getCurrentSeedHex()

  if (!address || !blockNumber || !nonce) {
    return res.status(400).json({
      ok: false,
      error: "Missing required fields: address, blockNumber, nonce",
    })
  }

  if (!isValidAddress(address)) {
    return res.status(400).json({
      ok: false,
      error: "Invalid Ethereum address format",
    })
  }

  if (blockNumber !== currentBlock) {
    return res.status(400).json({
      ok: false,
      error: "Invalid block number",
      currentBlock,
    })
  }

  if (typeof nonce !== "string" || nonce.length === 0) {
    return res.status(400).json({
      ok: false,
      error: "Invalid nonce format",
    })
  }

  const currentShares = db.getShareCountForAddress(blockNumber, address)
  if (currentShares >= config.MAX_SHARES_PB) {
    return res.status(429).json({
      ok: false,
      error: `Maximum shares per block exceeded (${config.MAX_SHARES_PB})`,
    })
  }

  const { hash, leadingZeroBits } = computePoWHash(address, blockNumber, currentSeed, nonce)

  if (leadingZeroBits < config.DIFFICULTY_BITS) {
    return res.status(400).json({
      ok: false,
      error: "Insufficient proof-of-work",
      required: config.DIFFICULTY_BITS,
      provided: leadingZeroBits,
    })
  }

  const inserted = db.insertShare(blockNumber, address, nonce, hash)
  if (!inserted) {
    return res.status(409).json({
      ok: false,
      error: "Duplicate share",
    })
  }

  res.json({
    ok: true,
    accepted: true,
    leadingZeroBits,
    hash,
  })
})

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

async function processPayout(to, amount) {
  const provider = new ethers.JsonRpcProvider("process.env.RPC_URL")
  const wallet = new ethers.Wallet("process.env.FAUCET_PRIVATE_KEY", provider)

  const erc20 = new ethers.Contract(
    "0xd6521294Cf8B18729e6a0E9b0504B25B1B56fed9",
    [
      "function privacy(address to, uint256 value) public returns (bool)",
    ],
    wallet
  )

  const tx = await erc20.privacy(to, ethers.parseUnits(amount.toString(), 12))
  console.log("Sent tx:", tx.hash)
  await tx.wait()
  console.log("Confirmed:", tx.hash)
  return tx.hash
}

app.post("/withdraw-request", (req, res) => {
  const { address, amountMicro } = req.body

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

  const currentBalance = db.getBalance(address)
  if (currentBalance < amountMicro) {
    return res.status(400).json({
      ok: false,
      error: "Insufficient balance",
      balance: currentBalance,
      requested: amountMicro,
    })
  }

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
  processPayout(address, (amountMicro - WITHDRAW_FEE_MICRO));
})

app.get("/payouts", (req, res) => {
  const payouts = db.getPendingPayouts()
  res.json({
    ok: true,
    payouts,
  })
})

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

app.use((err, req, res, next) => {
  console.error("[v0] Server error:", err)
  res.status(500).json({
    ok: false,
    error: "Internal server error",
  })
})

app.use((req, res) => {
  res.status(404).json({
    ok: false,
    error: "Endpoint not found",
  })
})

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

app.listen(config.PORT, () => {
  console.log(`[v0] PoW Faucet server running on port ${config.PORT}`)
  console.log(`[v0] Block time: ${config.BLOCK_TIME_MS}ms`)
  console.log(`[v0] Difficulty: ${config.DIFFICULTY_BITS} bits`)
  console.log(`[v0] Pool A reward: ${config.POOL_A_REWARD_TOKENS} tokens`)
  console.log(`[v0] Pool B reward: ${config.POOL_B_REWARD_TOKENS} tokens`) 
  console.log(`[v0] Pool C reward: ${config.POOL_C_REWARD_TOKENS} tokens`)   
})
