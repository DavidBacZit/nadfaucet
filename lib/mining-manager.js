// Mining manager for coordinating Web Worker mining

export class MiningManager {
  constructor() {
    this.worker = null
    this.isRunning = false
    this.currentHashRate = 1
    this.currentChallenge = null
    this.stats = {
      totalAttempts: 0,
      totalShares: 0,
      actualHashRate: 0,
      uptime: 0,
    }
    this.startTime = null
    this.onShareFound = null
    this.onStatsUpdate = null
    this.onError = null
    this.onStatusChange = null
  }

  // Initialize the Web Worker
  async initialize() {
    return new Promise((resolve, reject) => {
      try {
        this.worker = new Worker("/mining-worker.js")

        this.worker.onmessage = (event) => {
          this.handleWorkerMessage(event.data)
        }

        this.worker.onerror = (error) => {
          console.error("[v0] Mining worker error:", error)
          if (this.onError) {
            this.onError(error)
          }
          reject(error)
        }

        // Wait for ready signal
        const readyHandler = (event) => {
          if (event.data.type === "ready") {
            this.worker.removeEventListener("message", readyHandler)
            resolve()
          }
        }

        this.worker.addEventListener("message", readyHandler)
      } catch (error) {
        reject(error)
      }
    })
  }

  // Handle messages from Web Worker
  handleWorkerMessage(message) {
    const { type, data } = message

    switch (type) {
      case "ready":
        console.log("[v0] Mining worker ready")
        break

      case "started":
        console.log(`[v0] Mining started at ${data.hashRate} H/s for block ${data.blockNumber}`)
        if (this.onStatusChange) {
          this.onStatusChange({ isRunning: true, hashRate: data.hashRate })
        }
        break

      case "stopped":
        console.log("[v0] Mining stopped")
        this.isRunning = false
        if (this.onStatusChange) {
          this.onStatusChange({ isRunning: false })
        }
        break

      case "share":
        console.log(`[v0] Valid share found! Block ${data.blockNumber}, difficulty ${data.leadingZeroBits} bits`)
        this.stats.totalShares++

        if (this.onShareFound) {
          this.onShareFound(data)
        }
        break

      case "stats":
        this.stats.totalAttempts += data.attempts
        this.stats.actualHashRate = Number.parseFloat(data.actualHashRate)

        if (this.startTime) {
          this.stats.uptime = (Date.now() - this.startTime) / 1000
        }

        if (this.onStatsUpdate) {
          this.onStatsUpdate({
            ...this.stats,
            lastLoopStats: data,
          })
        }
        break

      case "rateUpdated":
        console.log(`[v0] Hash rate updated to ${data.hashRate} H/s`)
        this.currentHashRate = data.hashRate
        break

      case "challengeUpdated":
        console.log(`[v0] Challenge updated to block ${data.blockNumber}`)
        break

      case "error":
        console.error("[v0] Mining worker error:", data)
        if (this.onError) {
          this.onError(data)
        }
        break

      default:
        console.warn("[v0] Unknown worker message type:", type)
    }
  }

  // Start mining with given challenge and hash rate
  startMining(challenge, hashRate = 1) {
    if (!this.worker) {
      throw new Error("Mining worker not initialized")
    }

    if (this.isRunning) {
      this.stopMining()
    }

    this.currentChallenge = challenge
    this.currentHashRate = hashRate
    this.isRunning = true
    this.startTime = Date.now()

    // Reset stats
    this.stats = {
      totalAttempts: 0,
      totalShares: 0,
      actualHashRate: 0,
      uptime: 0,
    }

    this.worker.postMessage({
      type: "start",
      data: {
        challenge: {
          address: challenge.address,
          blockNumber: challenge.blockNumber,
          seedHex: challenge.seedHex,
          difficultyBits: challenge.difficultyBits,
        },
        hashRate,
      },
    })
  }

  // Stop mining
  stopMining() {
    if (!this.worker || !this.isRunning) {
      return
    }

    this.worker.postMessage({ type: "stop" })
    this.isRunning = false
    this.startTime = null
  }

  // Update hash rate while mining
  updateHashRate(hashRate) {
    if (!this.worker) {
      return
    }

    this.currentHashRate = hashRate

    if (this.isRunning) {
      this.worker.postMessage({
        type: "updateRate",
        data: { hashRate },
      })
    }
  }

  // Update challenge (when new block starts)
  updateChallenge(challenge) {
    if (!this.worker) {
      return
    }

    this.currentChallenge = challenge

    if (this.isRunning) {
      this.worker.postMessage({
        type: "updateChallenge",
        data: {
          challenge: {
            address: challenge.address,
            blockNumber: challenge.blockNumber,
            seedHex: challenge.seedHex,
            difficultyBits: challenge.difficultyBits,
          },
        },
      })
    }
  }

  // Get current mining status
  getStatus() {
    return {
      isRunning: this.isRunning,
      hashRate: this.currentHashRate,
      challenge: this.currentChallenge,
      stats: this.stats,
      uptime: this.startTime ? (Date.now() - this.startTime) / 1000 : 0,
    }
  }

  // Cleanup
  destroy() {
    if (this.worker) {
      this.stopMining()
      this.worker.terminate()
      this.worker = null
    }
  }
}

// Predefined hash rate options
export const HASH_RATE_OPTIONS = [
  { value: 1, label: "1 H/s", description: "Very Low" },
  { value: 2, label: "2 H/s", description: "Low" },
  { value: 4, label: "4 H/s", description: "Medium" },
  { value: 8, label: "8 H/s", description: "High" },
  { value: 16, label: "16 H/s", description: "Very High" },
  { value: 32, label: "32 H/s", description: "Extreme" },
  { value: 64, label: "64 H/s", description: "Maximum" },
]
