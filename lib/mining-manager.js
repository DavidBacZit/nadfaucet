// Web Worker for browser-based proof-of-work mining
// This runs in a separate thread to avoid blocking the UI

let isRunning = false
let currentChallenge = null
let hashRate = 1 // hashes per second
const lastLoopTime = 0

// Import Web Crypto API for SHA-256
const crypto = self.crypto

// Convert string to Uint8Array for hashing
function stringToUint8Array(str) {
  return new TextEncoder().encode(str)
}

// Convert Uint8Array to hex string
function uint8ArrayToHex(uint8Array) {
  return Array.from(uint8Array)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
}

// Count leading zero bits in hex string
function countLeadingZeroBits(hexString) {
  let count = 0

  for (let i = 0; i < hexString.length; i++) {
    const char = hexString[i]
    const value = Number.parseInt(char, 16)

    if (value === 0) {
      count += 4 // Each hex digit represents 4 bits
    } else {
      // Count remaining zero bits in this digit
      if (value < 8) count += 1
      if (value < 4) count += 1
      if (value < 2) count += 1
      break
    }
  }

  return count
}

// Generate random nonce string
function generateNonce() {
  return Math.random().toString(36).substring(2) + Date.now().toString(36)
}

// Compute SHA-256 hash for proof-of-work
async function computePoWHash(address, blockNumber, seedHex, nonce) {
  const input = `${address.toLowerCase()}${blockNumber}${seedHex}${nonce}`
  const inputBytes = stringToUint8Array(input)

  const hashBuffer = await crypto.subtle.digest("SHA-256", inputBytes)
  const hashArray = new Uint8Array(hashBuffer)
  const hashHex = uint8ArrayToHex(hashArray)

  const leadingZeroBits = countLeadingZeroBits(hashHex)

  return {
    hash: hashHex,
    leadingZeroBits,
    nonce,
  }
}

// Main mining loop
async function miningLoop() {
  if (!isRunning || !currentChallenge) {
    return
  }

  const startTime = performance.now()
  const targetDuration = 1000 // 1 second
  const attemptsPerSecond = hashRate
  const attemptsThisLoop = Math.max(1, Math.floor(attemptsPerSecond))

  let attempts = 0
  let validShares = 0

  // Perform mining attempts
  for (let i = 0; i < attemptsThisLoop && isRunning; i++) {
    const nonce = generateNonce()

    try {
      const result = await computePoWHash(
        currentChallenge.address,
        currentChallenge.blockNumber,
        currentChallenge.seedHex,
        nonce,
      )

      attempts++

      // Check if this meets the difficulty requirement
      if (result.leadingZeroBits >= currentChallenge.difficultyBits) {
        validShares++

        // Send valid share to main thread
        self.postMessage({
          type: "share",
          data: {
            address: currentChallenge.address,
            blockNumber: currentChallenge.blockNumber,
            nonce: result.nonce,
            hash: result.hash,
            leadingZeroBits: result.leadingZeroBits,
          },
        })
      }
    } catch (error) {
      self.postMessage({
        type: "error",
        data: { message: "Mining error", error: error.message },
      })
    }
  }

  const elapsed = performance.now() - startTime
  const actualHashRate = attempts / (elapsed / 1000)

  // Send statistics to main thread
  self.postMessage({
    type: "stats",
    data: {
      attempts,
      validShares,
      actualHashRate: actualHashRate.toFixed(2),
      elapsed: elapsed.toFixed(2),
      targetRate: hashRate,
    },
  })

  // Schedule next loop iteration
  // Adjust timing to maintain target hash rate
  const remainingTime = Math.max(0, targetDuration - elapsed)
  setTimeout(miningLoop, remainingTime)
}

// Handle messages from main thread
self.onmessage = (event) => {
  const { type, data } = event.data

  switch (type) {
    case "start":
      if (data.challenge && data.hashRate) {
        currentChallenge = data.challenge
        hashRate = data.hashRate
        isRunning = true

        self.postMessage({
          type: "started",
          data: { hashRate, blockNumber: currentChallenge.blockNumber },
        })

        // Start mining loop
        miningLoop()
      }
      break

    case "stop":
      isRunning = false
      currentChallenge = null

      self.postMessage({
        type: "stopped",
        data: {},
      })
      break

    case "updateRate":
      if (data.hashRate) {
        hashRate = data.hashRate

        self.postMessage({
          type: "rateUpdated",
          data: { hashRate },
        })
      }
      break

    case "updateChallenge":
      if (data.challenge) {
        currentChallenge = data.challenge

        self.postMessage({
          type: "challengeUpdated",
          data: { blockNumber: currentChallenge.blockNumber },
        })
      }
      break

    default:
      self.postMessage({
        type: "error",
        data: { message: "Unknown message type", type },
      })
  }
}

// Send ready signal
self.postMessage({
  type: "ready",
  data: { message: "Mining worker initialized" },
})
