import { DatabaseManager } from "../lib/database.js"
import { generateRandomHex, selectWeightedRandom } from "../lib/crypto-utils.js"

export class BlockProcessor {
  constructor(config) {
    this.config = config
    this.db = new DatabaseManager()
    this.currentBlockNumber = Number.parseInt(this.db.getMeta("currentBlockNumber")) || 1
    this.currentSeedHex = this.db.getMeta("currentSeedHex") || generateRandomHex(16)
    this.blockStartTime = Date.now()
    this.blockTimer = null
    this.isProcessing = false

    console.log(`[v0] Block processor initialized - Block ${this.currentBlockNumber}, Seed: ${this.currentSeedHex}`)
  }

  start() {
    console.log(`[v0] Starting block processor with ${this.config.BLOCK_TIME_MS}ms intervals`)
    this.scheduleNextBlock()
  }

  stop() {
    if (this.blockTimer) {
      clearTimeout(this.blockTimer)
      this.blockTimer = null
    }
    console.log("[v0] Block processor stopped")
  }

  scheduleNextBlock() {
    const timeUntilNextBlock = this.config.BLOCK_TIME_MS - (Date.now() - this.blockStartTime)
    const delay = Math.max(0, timeUntilNextBlock)

    this.blockTimer = setTimeout(() => {
      this.processBlock()
    }, delay)
  }

  async processBlock() {
    if (this.isProcessing) {
      console.log("[v0] Block processing already in progress, skipping")
      return
    }

    this.isProcessing = true
    const blockToProcess = this.currentBlockNumber

    try {
      console.log(`[v0] Processing block ${blockToProcess}...`)

      // Finalize the current block
      await this.finalizeBlock(blockToProcess)

      // Start new block
      this.currentBlockNumber++
      this.currentSeedHex = generateRandomHex(16)
      this.blockStartTime = Date.now()

      // Update meta and insert new block record
      this.db.setMeta("currentBlockNumber", this.currentBlockNumber.toString())
      this.db.setMeta("currentSeedHex", this.currentSeedHex)
      this.db.insertBlock(this.currentBlockNumber, this.currentSeedHex)

      console.log(`[v0] Started block ${this.currentBlockNumber}, Seed: ${this.currentSeedHex}`)
    } catch (error) {
      console.error(`[v0] Error processing block ${blockToProcess}:`, error)
    } finally {
      this.isProcessing = false
      this.scheduleNextBlock()
    }
  }

  async finalizeBlock(blockNumber) {
    // Get all shares for this block
    const shares = this.db.getSharesForBlock(blockNumber)

    if (shares.length === 0) {
      console.log(`[v0] Block ${blockNumber}: No shares to process`)
      this.db.markBlockProcessed(blockNumber)
      return
    }

    console.log(`[v0] Block ${blockNumber}: Processing ${shares.length} shares`)

    // Group shares by address
    const sharesByAddress = new Map()
    for (const share of shares) {
      const count = sharesByAddress.get(share.address) || 0
      sharesByAddress.set(share.address, count + 1)
    }

    const totalShares = shares.length
    const rewards = new Map()

    // Pool A: Proportional rewards (50 tokens = 50 * 1e6 micro-tokens)
    const poolAReward = this.config.POOL_A_REWARD_TOKENS * 1e6
    for (const [address, shareCount] of sharesByAddress) {
      const proportionalReward = Math.floor((poolAReward * shareCount) / totalShares)
      rewards.set(address, (rewards.get(address) || 0) + proportionalReward)
    }

    // Pool B: Weighted lottery (50 tokens = 50 * 1e6 micro-tokens)
    const poolBReward = this.config.POOL_B_REWARD_TOKENS * 1e6
    const addresses = Array.from(sharesByAddress.keys())
    const weights = addresses.map((addr) => sharesByAddress.get(addr))

    const winnerIndex = selectWeightedRandom(weights)
    if (winnerIndex >= 0) {
      const winnerAddress = addresses[winnerIndex]
      rewards.set(winnerAddress, (rewards.get(winnerAddress) || 0) + poolBReward)
      console.log(`[v0] Block ${blockNumber}: Pool B winner: ${winnerAddress} (${weights[winnerIndex]} shares)`)
    }

    // Apply rewards atomically
    this.applyRewards(rewards)

    // Mark block as processed
    this.db.markBlockProcessed(blockNumber)

    // Log reward summary
    const totalRewardsMicro = Array.from(rewards.values()).reduce((sum, reward) => sum + reward, 0)
    const totalRewardsTokens = totalRewardsMicro / 1e6
    console.log(`[v0] Block ${blockNumber}: Distributed ${totalRewardsTokens} tokens to ${rewards.size} addresses`)

    // Log individual rewards for debugging
    for (const [address, rewardMicro] of rewards) {
      const rewardTokens = rewardMicro / 1e6
      const shareCount = sharesByAddress.get(address)
      console.log(`[v0]   ${address}: ${rewardTokens} tokens (${shareCount} shares)`)
    }
  }

  applyRewards(rewards) {
    // Use a transaction to ensure atomicity
    const transaction = this.db.db.transaction(() => {
      for (const [address, rewardMicro] of rewards) {
        this.db.updateBalance(address, rewardMicro)
      }
    })

    transaction()
  }

  // Getters for current state (used by API server)
  getCurrentBlockNumber() {
    return this.currentBlockNumber
  }

  getCurrentSeedHex() {
    return this.currentSeedHex
  }

  getBlockStartTime() {
    return this.blockStartTime
  }

  getTimeRemaining() {
    const elapsed = Date.now() - this.blockStartTime
    return Math.max(0, this.config.BLOCK_TIME_MS - elapsed)
  }

  // Get block statistics
  getBlockStats() {
    return {
      currentBlock: this.currentBlockNumber,
      seedHex: this.currentSeedHex,
      blockStartTime: this.blockStartTime,
      msLeft: this.getTimeRemaining(),
      isProcessing: this.isProcessing,
    }
  }
}
