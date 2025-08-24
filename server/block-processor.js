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

      await this.finalizeBlock(blockToProcess)

      this.currentBlockNumber++
      this.currentSeedHex = generateRandomHex(16)
      this.blockStartTime = Date.now()

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
    const shares = this.db.getSharesForBlock(blockNumber)
  
    if (shares.length === 0) {
      console.log(`[v0] Block ${blockNumber}: No shares to process`)
      this.db.markBlockProcessed(blockNumber)
      return
    }

    const sharesByAddress = new Map()
    for (const share of shares) {
      const count = sharesByAddress.get(share.address) || 0
      sharesByAddress.set(share.address, count + 1)
    }
  
    const addresses = Array.from(sharesByAddress.keys())
    const rewards = new Map()
  
    console.log(`[v0] Block ${blockNumber}: Share distribution:`)
    for (const [address, shareCount] of sharesByAddress) {
      console.log(`[v0] ${address}: ${shareCount} shares`)
    }
  
    const poolBReward = this.config.POOL_B_REWARD_TOKENS * 1e6
    const weights = addresses.map(addr => sharesByAddress.get(addr))
    const winnerIndex = selectWeightedRandom(weights)
    let poolBWinner = null
  
    if (winnerIndex >= 0) {
      poolBWinner = addresses[winnerIndex]
      rewards.set(poolBWinner, (rewards.get(poolBWinner) || 0) + poolBReward)
      console.log(
        `[v0] Block ${blockNumber}: Pool B winner: ${poolBWinner} gets ${poolBReward / 1e6} tokens`
      )
    }

    const poolAReward = this.config.POOL_A_REWARD_TOKENS * 1e6
    const totalShares = Array.from(sharesByAddress.values()).reduce((a, b) => a + b, 0)

    const adjustedShares = new Map()
    for (const [address, shareCount] of sharesByAddress) {
      let adjusted = shareCount

      if (address === poolBWinner) {
        const totalLoserShares = totalShares - shareCount
        const penalty = Math.min(totalLoserShares, Math.floor(totalShares / 2))
        adjusted = Math.floor((shareCount - penalty) / 2)
        if (adjusted < 0) adjusted = 0
      }

      if (adjusted > 0) {
        adjustedShares.set(address, adjusted)
      }
    }

    const totalAdjustedShares = Array.from(adjustedShares.values()).reduce((a, b) => a + b, 0)

    if (totalAdjustedShares > 0) {
      console.log(
        `[v0] Block ${blockNumber}: Pool A distributing ${poolAReward / 1e6} tokens proportionally (new adjusted shares)`
      )
      for (const [address, shareCount] of adjustedShares) {
        const reward = Math.floor((shareCount / totalAdjustedShares) * poolAReward)
        rewards.set(address, (rewards.get(address) || 0) + reward)
        console.log(
          `[v0] Pool A: ${address} gets ${reward / 1e6} tokens (${shareCount}/${totalAdjustedShares} adjusted shares)`
        )
      }
    }
  
    const poolCReward = this.config.POOL_C_REWARD_TOKENS * 1e6
    let poolCAddresses = addresses.filter(addr => addr !== poolBWinner)
    const numC = poolCAddresses.length
    
    if (numC > 0) {
      let workerRewards = poolCAddresses.map(addr => ({
        addr,
        reward: rewards.get(addr) || 0
      }))
    
      workerRewards.sort((a, b) => a.reward - b.reward)
    
      let m = numC
      for (let i = 1; i < numC; i++) {
        const left = workerRewards[i - 1].reward + Math.ceil(poolCReward / i)
        const right = workerRewards[i].reward
        if (left < right) {
          m = i
          break
        }
      }
    
      const rewardPerUser = Math.floor(poolCReward / m)
      let remainder = poolCReward % m
    
      for (let i = 0; i < m; i++) {
        let extra = rewardPerUser
        if (remainder > 0) {
          extra += 1
          remainder--
        }
        rewards.set(
          workerRewards[i].addr,
          (rewards.get(workerRewards[i].addr) || 0) + extra
        )
      }
    
      console.log(
        `[v0] Block ${blockNumber}: Pool C distributing ${poolCReward / 1e6} tokens to ${m}/${numC} lowest addresses (~${rewardPerUser / 1e6} each)`
      )
    }
    
    console.log(`[v0] Block ${blockNumber}: Applying rewards to database...`)
    this.applyRewards(rewards)
    this.db.markBlockProcessed(blockNumber)
  
    const totalRewardsMicro = Array.from(rewards.values()).reduce((sum, reward) => sum + reward, 0)
  
    console.log(
      `[v0] Block ${blockNumber}: FINAL - Distributed ${totalRewardsMicro / 1e6} tokens to ${rewards.size} addresses`
    )
  
    for (const [address, rewardMicro] of rewards) {
      const rewardTokens = rewardMicro / 1e6
      const shareCount = sharesByAddress.get(address)
      console.log(`[v0] FINAL: ${address}: ${rewardTokens} tokens total (${shareCount} shares)`)
    }
  }
  
  
  applyRewards(rewards) {
    const transaction = this.db.db.transaction(() => {
      for (const [address, rewardMicro] of rewards) {
        this.db.updateBalance(address, rewardMicro)
      }
    })

    transaction()
  }

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
