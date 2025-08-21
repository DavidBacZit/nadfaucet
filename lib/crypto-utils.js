import crypto from "crypto"

// Generate cryptographically secure random hex string
export function generateRandomHex(bytes) {
  return crypto.randomBytes(bytes).toString("hex")
}

// Compute SHA-256 hash and count leading zero bits
export function computePoWHash(address, blockNumber, seedHex, nonce) {
  const input = `${address.toLowerCase()}${blockNumber}${seedHex}${nonce}`
  const hash = crypto.createHash("sha256").update(input).digest("hex")

  const leadingZeroBits = countLeadingZeroBits(hash)

  return {
    hash,
    leadingZeroBits,
  }
}

// Count leading zero bits in a hex string
export function countLeadingZeroBits(hexString) {
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

// Validate Ethereum-style address
export function isValidAddress(address) {
  return /^0x[a-fA-F0-9]{40}$/.test(address)
}

// Weighted random selection for Pool B
export function selectWeightedRandom(weights) {
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0)
  if (totalWeight === 0) return -1

  const randomValue = crypto.randomInt(totalWeight)
  let cumulativeWeight = 0

  for (let i = 0; i < weights.length; i++) {
    cumulativeWeight += weights[i]
    if (randomValue < cumulativeWeight) {
      return i
    }
  }

  return weights.length - 1 // Fallback
}
