// Multi-threaded mining manager for coordinating multiple Web Workers

export class MiningManager {
  constructor() {
    this.workers = []
    this.isRunning = false
    this.currentHashRate = 1
    this.currentChallenge = null
    this.stats = {
      totalAttempts: 0,
      totalShares: 0,
      actualHashRate: 0,
      uptime: 0,
      activeWorkers: 0,
    }
    this.startTime = null
    this.onShareFound = null
    this.onStatsUpdate = null
    this.onError = null
    this.onStatusChange = null
  }

  // Initialize Web Workers pool
  async initialize() {
    // Clean up any existing workers
    this.destroyWorkers()

    return Promise.resolve() // Ready immediately for dynamic worker creation
  }

  // Create n workers based on hash rate
  async createWorkers(hashRate) {
    this.destroyWorkers()

    const workerCount = hashRate
    const promises = []

    for (let i = 0; i < workerCount; i++) {
      promises.push(this.createSingleWorker(i))
    }

    await Promise.all(promises)
    this.stats.activeWorkers = this.workers.length
    console.log(`[v0] Created ${this.workers.length} mining workers`)
  }

  // Create a single worker
  async createSingleWorker(workerId) {
    return new Promise((resolve, reject) => {
      try {
        const worker = new Worker("/mining-worker.js")

        worker.onmessage = (event) => {
          this.handleWorkerMessage(event.data, workerId)
        }

        worker.onerror = (error) => {
          console.error(`[v0] Mining worker ${workerId} error:`, error)
          if (this.onError) {
            this.onError(error)
          }
          reject(error)
        }

        // Wait for ready signal
        const readyHandler = (event) => {
          if (event.data.type === "ready") {
            worker.removeEventListener("message", readyHandler)
            this.workers.push({ worker, workerId, ready: true })
            resolve()
          }
        }

        worker.addEventListener("message", readyHandler)
      } catch (error) {
        reject(error)
      }
    })
  }

  // Handle messages from Web Workers
  handleWorkerMessage(message, workerId) {
    const { type, data } = message

    switch (type) {
      case "ready":
        console.log(`[v0] Mining worker ${workerId} ready`)
        break

      case "started":
        console.log(`[v0] Worker ${workerId} started mining at ${data.hashRate} H/s for block ${data.blockNumber}`)
        break

      case "stopped":
        console.log(`[v0] Worker ${workerId} stopped`)
        break

      case "share":
        console.log(
          `[v0] Valid share found by worker ${workerId}! Block ${data.blockNumber}, difficulty ${data.leadingZeroBits} bits`,
        )
        this.stats.totalShares++

        if (this.onShareFound) {
          this.onShareFound(data)
        }
        break

      case "stats":
        this.stats.totalAttempts += data.attempts

        // Calculate actual combined hash rate more conservatively
        const workerInfo = this.workers.find((w) => w.workerId === workerId)
        if (workerInfo) {
          workerInfo.lastHashRate = Math.min(Number.parseFloat(data.actualHashRate), 2) // Cap individual worker rate at 2 H/s
        }

        const totalActualRate = this.workers.reduce((sum, w) => {
          return sum + (w.lastHashRate || 0)
        }, 0)

        this.stats.actualHashRate = totalActualRate

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

      case "error":
        console.error(`[v0] Mining worker ${workerId} error:`, data)
        if (this.onError) {
          this.onError(data)
        }
        break

      default:
        console.warn(`[v0] Unknown worker message type from worker ${workerId}:`, type)
    }
  }

  // Start mining with given challenge and hash rate
  async startMining(challenge, hashRate = 1) {
    if (this.isRunning) {
      this.stopMining()
    }

    // Create workers based on hash rate
    await this.createWorkers(hashRate)

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
      activeWorkers: this.workers.length,
    }

    // Each worker targets ~1 H/s
    const targetRatePerWorker = 1

    // Start all workers
    this.workers.forEach(({ worker }) => {
      worker.postMessage({
        type: "start",
        data: {
          challenge: {
            address: challenge.address,
            blockNumber: challenge.blockNumber,
            seedHex: challenge.seedHex,
            difficultyBits: challenge.difficultyBits,
          },
          hashRate: targetRatePerWorker,
        },
      })
    })

    if (this.onStatusChange) {
      this.onStatusChange({
        isRunning: true,
        hashRate,
        activeWorkers: this.workers.length,
      })
    }
  }

  // Stop mining
  stopMining() {
    if (!this.isRunning) {
      return
    }

    this.workers.forEach(({ worker }) => {
      worker.postMessage({ type: "stop" })
    })

    this.isRunning = false
    this.startTime = null

    if (this.onStatusChange) {
      this.onStatusChange({ isRunning: false })
    }
  }

  // Update hash rate while mining
  async updateHashRate(hashRate) {
    this.currentHashRate = hashRate

    if (this.isRunning && this.currentChallenge) {
      // Restart mining with new worker count
      await this.startMining(this.currentChallenge, hashRate)
    }
  }

  // Update challenge (when new block starts)
  updateChallenge(challenge) {
    this.currentChallenge = challenge

    if (this.isRunning) {
      this.workers.forEach(({ worker }) => {
        worker.postMessage({
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
      activeWorkers: this.workers.length,
    }
  }

  // Destroy all workers
  destroyWorkers() {
    this.workers.forEach(({ worker }) => {
      worker.terminate()
    })
    this.workers = []
    this.stats.activeWorkers = 0
  }

  // Cleanup
  destroy() {
    this.stopMining()
    this.destroyWorkers()
  }
}

// Remove predefined options - now using number input
export const HASH_RATE_OPTIONS = []
