// mining-manager.js
// Multi-threaded mining manager — updated to enforce a per-worker hash-rate limit (MAX_PER_WORKER_RATE)
// If user requests a total H/s that requires more workers (e.g. 100 H/s with 5 H/s per worker -> 20 workers),
// the manager will create the required number of workers up to a safe absolute cap.

export class MiningManager {
  constructor() {
    this.workers = [] // { worker, workerId, ready, lastHashRate }
    this.isRunning = false
    this.currentHashRate = 1 // total desired H/s
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

    // Configuration: per-worker hash rate cap (H/s)
    this.MAX_PER_WORKER_RATE = 5 // <= 5 H/s per worker as requested

    // Safety caps to avoid runaway worker creation that would crash browsers
    // Recommended max workers is based on hardwareConcurrency * multiplier, but we still allow higher up to ABSOLUTE_MAX_WORKERS
    const hw = (typeof navigator !== "undefined" && navigator.hardwareConcurrency) || 4
    this.RECOMMENDED_MAX_WORKERS = Math.max(1, Math.floor(hw * 4))
    this.ABSOLUTE_MAX_WORKERS = 256
  }

  // Initialize (cleanup)
  async initialize() {
    this.destroyWorkers()
    return Promise.resolve()
  }

  // Create n workers (count determined by caller). Returns after all ready.
  async createWorkers(count, perWorkerRate = 1) {
    this.destroyWorkers()

    const workerCount = Math.max(1, Math.floor(count))
    const promises = []

    for (let i = 0; i < workerCount; i++) {
      promises.push(this.createSingleWorker(i, perWorkerRate))
    }

    await Promise.all(promises)
    this.stats.activeWorkers = this.workers.length
    console.log(`[v0] Created ${this.workers.length} mining workers (perWorkerRate=${perWorkerRate})`)
  }

  // Create single worker and wait for ready signal
  async createSingleWorker(workerId, perWorkerRate = 1) {
    return new Promise((resolve, reject) => {
      try {
        const worker = new Worker("/mining-worker.js")

        const onMessage = (event) => {
          this.handleWorkerMessage(event.data, workerId)
        }

        const onError = (error) => {
          console.error(`[v0] Mining worker ${workerId} error:`, error)
          if (this.onError) this.onError(error)
          reject(error)
        }

        worker.onmessage = onMessage
        worker.onerror = onError

        // Wait for ready then start with idle state (start will be posted by manager.startMining)
        const readyHandler = (event) => {
          if (event.data && event.data.type === "ready") {
            try {
              worker.removeEventListener("message", readyHandler)
            } catch (e) {}
            this.workers.push({ worker, workerId, ready: true, lastHashRate: perWorkerRate })
            // Immediately tell the worker its target rate (worker may not yet be started)
            try {
              worker.postMessage({ type: "setHashRate", data: { hashRate: perWorkerRate } })
            } catch (e) {}
            resolve()
          }
        }

        worker.addEventListener("message", readyHandler)
      } catch (error) {
        reject(error)
      }
    })
  }

  // Handle messages from workers
  handleWorkerMessage(message, workerId) {
    const { type, data } = message || {}

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
          // pass the raw share object to callback
          this.onShareFound(data)
        }
        break

      case "stats":
        this.stats.totalAttempts += data.attempts

        // cap per-worker reported rate to avoid outliers
        const w = this.workers.find((x) => x.workerId === workerId)
        if (w) {
          w.lastHashRate = Math.min(Number.parseFloat(data.actualHashRate) || 0, 1000000) // cap huge numbers
        }

        const totalActual = this.workers.reduce((sum, w) => sum + (w.lastHashRate || 0), 0)
        this.stats.actualHashRate = Math.round(totalActual * 100) / 100

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
        console.error(`[v0] Mining worker ${workerId} reported error:`, data)
        if (this.onError) this.onError(data)
        break

      default:
        console.warn(`[v0] Unknown worker message type from worker ${workerId}:`, type)
    }
  }

  // Start mining with a challenge and a total hash rate (H/s)
  async startMining(challenge, totalHashRate = 1) {
    if (!challenge) {
      throw new Error("Missing challenge for startMining")
    }

    // If already running, stop first (we'll recreate workers)
    if (this.isRunning) {
      this.stopMining()
    }

    this.currentChallenge = challenge
    this.currentHashRate = Math.max(1, Number(totalHashRate) || 1)

    // Determine required workers based on per-worker cap
    const neededWorkers = Math.ceil(this.currentHashRate / this.MAX_PER_WORKER_RATE)

    // Apply safety caps: recommended vs absolute
    const suggested = this.RECOMMENDED_MAX_WORKERS
    const absolute = this.ABSOLUTE_MAX_WORKERS

    // Allow creating up to ABSOLUTE_MAX_WORKERS, but log if exceeding recommended
    const workerCount = Math.min(Math.max(1, neededWorkers), absolute)
    if (workerCount > suggested) {
      console.warn(`[v0] Requested workerCount (${workerCount}) exceeds recommended (${suggested}). This may increase memory/CPU usage.`)
    }

    // Compute per-worker rate (will be <= MAX_PER_WORKER_RATE)
    const perWorkerRate = Math.max(1, this.currentHashRate / workerCount)

    // create workers
    await this.createWorkers(workerCount, perWorkerRate)

    this.isRunning = true
    this.startTime = Date.now()

    // reset stats
    this.stats = {
      totalAttempts: 0,
      totalShares: 0,
      actualHashRate: 0,
      uptime: 0,
      activeWorkers: this.workers.length,
    }

    // Send start message to each worker with the challenge and per-worker rate
    this.workers.forEach(({ worker }, idx) => {
      try {
        worker.postMessage({
          type: "start",
          data: {
            challenge: {
              address: challenge.address,
              blockNumber: challenge.blockNumber,
              seedHex: challenge.seedHex,
              difficultyBits: challenge.difficultyBits,
            },
            hashRate: perWorkerRate,
          },
        })
      } catch (e) {
        console.warn(`[v0] Failed to post start to worker ${idx}:`, e)
      }
    })

    if (this.onStatusChange) {
      this.onStatusChange({
        isRunning: true,
        hashRate: this.currentHashRate,
        activeWorkers: this.workers.length,
      })
    }
  }

  // Stop mining (tell workers to stop)
  stopMining() {
    if (!this.isRunning) return

    this.workers.forEach(({ worker }) => {
      try {
        worker.postMessage({ type: "stop" })
      } catch (e) {
        console.warn("[v0] Failed to post stop to worker:", e)
      }
    })

    this.isRunning = false
    this.startTime = null

    if (this.onStatusChange) {
      this.onStatusChange({ isRunning: false })
    }
  }

  // Update total hash rate (H/s). If number of workers unchanged -> set per-worker rate via message.
  // If worker count needs to change -> restart mining to recreate workers.
  async updateHashRate(totalHashRate) {
    const newTotal = Math.max(1, Number(totalHashRate) || 1)
    this.currentHashRate = newTotal

    // compute desired worker count using per-worker cap
    const desiredWorkers = Math.ceil(newTotal / this.MAX_PER_WORKER_RATE)
    const desiredCount = Math.max(1, Math.floor(desiredWorkers))

    if (this.isRunning) {
      if (desiredCount === this.workers.length) {
        // Change per-worker rate on the fly
        const perWorkerRate = Math.max(1, newTotal / desiredCount)
        this.workers.forEach(({ worker }) => {
          try {
            worker.postMessage({ type: "setHashRate", data: { hashRate: perWorkerRate } })
          } catch (e) {
            console.warn("[v0] Failed to update worker hashRate:", e)
          }
        })

        if (this.onStatusChange) {
          this.onStatusChange({
            isRunning: true,
            hashRate: newTotal,
            activeWorkers: this.workers.length,
          })
        }
      } else {
        // different worker count needed -> restart mining with current challenge
        if (this.currentChallenge) {
          await this.startMining(this.currentChallenge, newTotal)
        } else {
          // if no challenge, just stop and mark new total (will apply on next start)
          this.stopMining()
        }
      }
    } else {
      // not running: just update the stored value
      if (this.onStatusChange) {
        this.onStatusChange({ isRunning: false, hashRate: newTotal })
      }
    }
  }

  // Update challenge while mining (server moved to new block)
  updateChallenge(challenge) {
    this.currentChallenge = challenge

    if (this.isRunning) {
      this.workers.forEach(({ worker }) => {
        try {
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
        } catch (e) {
          console.warn("[v0] Failed to post updateChallenge to worker:", e)
        }
      })
    }
  }

  // Return status
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

  // Terminate workers
  destroyWorkers() {
    this.workers.forEach(({ worker }) => {
      try {
        worker.terminate()
      } catch (e) {
        // ignore
      }
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

// keep export for backward compatibility if code expects HASH_RATE_OPTIONS
export const HASH_RATE_OPTIONS = []
