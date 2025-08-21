import { BlockProcessor } from "../server/block-processor.js"
import { DatabaseManager } from "../lib/database.js"
import { computePoWHash } from "../lib/crypto-utils.js"

// Test configuration
const testConfig = {
  BLOCK_TIME_MS: 2000, // 2 seconds for testing
  DIFFICULTY_BITS: 12, // Lower difficulty for testing
  POOL_A_REWARD_TOKENS: 50,
  POOL_B_REWARD_TOKENS: 50,
}

const db = new DatabaseManager()
const processor = new BlockProcessor(testConfig)

console.log("[v0] Testing block processing...")

// Create test addresses
const testAddresses = [
  "0x1234567890123456789012345678901234567890",
  "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
  "0x9876543210987654321098765432109876543210",
]

// Function to generate valid shares for testing
function generateTestShares(blockNumber, seedHex, addresses, sharesPerAddress) {
  const shares = []

  for (const address of addresses) {
    let validShares = 0
    let nonce = 0

    while (validShares < sharesPerAddress) {
      const nonceStr = nonce.toString()
      const { hash, leadingZeroBits } = computePoWHash(address, blockNumber, seedHex, nonceStr)

      if (leadingZeroBits >= testConfig.DIFFICULTY_BITS) {
        shares.push({
          address,
          nonce: nonceStr,
          hash,
          leadingZeroBits,
        })
        validShares++
      }

      nonce++

      // Safety check to prevent infinite loop
      if (nonce > 100000) {
        console.log(`[v0] Warning: Could not generate enough shares for ${address}`)
        break
      }
    }
  }

  return shares
}

// Test block processing
async function testBlockProcessing() {
  const currentBlock = processor.getCurrentBlockNumber()
  const currentSeed = processor.getCurrentSeedHex()

  console.log(`[v0] Current block: ${currentBlock}, seed: ${currentSeed}`)

  // Generate test shares
  console.log("[v0] Generating test shares...")
  const testShares = generateTestShares(currentBlock, currentSeed, testAddresses, 3)

  console.log(`[v0] Generated ${testShares.length} test shares`)

  // Insert shares into database
  for (const share of testShares) {
    const inserted = db.insertShare(currentBlock, share.address, share.nonce, share.hash)
    if (inserted) {
      console.log(`[v0] Inserted share: ${share.address} (${share.leadingZeroBits} bits)`)
    }
  }

  // Check balances before processing
  console.log("[v0] Balances before block processing:")
  for (const address of testAddresses) {
    const balance = db.getBalance(address)
    console.log(`[v0]   ${address}: ${balance / 1e6} tokens`)
  }

  // Wait for block to process
  console.log("[v0] Waiting for block to process...")
  await new Promise((resolve) => setTimeout(resolve, testConfig.BLOCK_TIME_MS + 500))

  // Check balances after processing
  console.log("[v0] Balances after block processing:")
  for (const address of testAddresses) {
    const balance = db.getBalance(address)
    console.log(`[v0]   ${address}: ${balance / 1e6} tokens`)
  }

  processor.stop()
  console.log("[v0] Test completed!")
}

// Start processor and run test
processor.start()
testBlockProcessing().catch(console.error)
