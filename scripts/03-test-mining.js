import { MiningManager } from "../lib/mining-manager.js"
import { FaucetApiClient } from "../lib/api-client.js"

// Test mining functionality
async function testMining() {
  console.log("[v0] Testing mining functionality...")

  const apiClient = new FaucetApiClient("http://localhost:3000")
  const miningManager = new MiningManager()

  try {
    // Initialize mining manager
    await miningManager.initialize()
    console.log("[v0] Mining manager initialized")

    // Get current challenge
    const challenge = await apiClient.getChallenge()
    console.log("[v0] Current challenge:", challenge)

    // Test address
    const testAddress = "0x1234567890123456789012345678901234567890"

    // Set up event handlers
    miningManager.onShareFound = async (share) => {
      console.log("[v0] Share found:", share)

      try {
        const result = await apiClient.submitShare(share.address, share.blockNumber, share.nonce)
        console.log("[v0] Share submitted successfully:", result)
      } catch (error) {
        console.error("[v0] Failed to submit share:", error.message)
      }
    }

    miningManager.onStatsUpdate = (stats) => {
      console.log(
        `[v0] Mining stats: ${stats.actualHashRate} H/s, ${stats.totalAttempts} attempts, ${stats.totalShares} shares`,
      )
    }

    miningManager.onError = (error) => {
      console.error("[v0] Mining error:", error)
    }

    // Start mining at low hash rate for testing
    console.log("[v0] Starting mining at 2 H/s...")
    miningManager.startMining(
      {
        address: testAddress,
        blockNumber: challenge.blockNumber,
        seedHex: challenge.seedHex,
        difficultyBits: challenge.difficultyBits,
      },
      2,
    )

    // Mine for 10 seconds
    await new Promise((resolve) => setTimeout(resolve, 10000))

    // Update hash rate
    console.log("[v0] Updating hash rate to 4 H/s...")
    miningManager.updateHashRate(4)

    // Mine for another 10 seconds
    await new Promise((resolve) => setTimeout(resolve, 10000))

    // Stop mining
    console.log("[v0] Stopping mining...")
    miningManager.stopMining()

    // Get final status
    const status = miningManager.getStatus()
    console.log("[v0] Final mining status:", status)

    // Cleanup
    miningManager.destroy()
    console.log("[v0] Mining test completed!")
  } catch (error) {
    console.error("[v0] Mining test failed:", error)
    miningManager.destroy()
  }
}

// Run test if this script is executed directly
if (typeof window === "undefined") {
  testMining().catch(console.error)
}

export { testMining }
