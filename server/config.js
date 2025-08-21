// Environment configuration with defaults
export const config = {
  // Server settings
  PORT: Number.parseInt(process.env.PORT) || 3000,

  // Mining settings
  BLOCK_TIME_MS: Number.parseInt(process.env.BLOCK_TIME_MS) || 400,
  DIFFICULTY_BITS: Number.parseInt(process.env.DIFFICULTY_BITS) || 18,
  MAX_SHARES_PB: Number.parseInt(process.env.MAX_SHARES_PB) || 500,

  // Reward settings
  POOL_A_REWARD_TOKENS: 50,
  POOL_B_REWARD_TOKENS: 50,
  WITHDRAW_FEE_TOKENS: Number.parseInt(process.env.WITHDRAW_FEE_TOKENS) || 1000,

  // Optional blockchain settings for payouts
  RPC_URL: process.env.RPC_URL,
  FAUCET_PRIVATE_KEY: process.env.FAUCET_PRIVATE_KEY,
  TOKEN_ADDRESS: process.env.TOKEN_ADDRESS,
}

// Convert token amounts to micro-tokens (6 decimal places)
export const MICRO_TOKEN_DECIMALS = 1e6

export const POOL_A_REWARD_MICRO = config.POOL_A_REWARD_TOKENS * MICRO_TOKEN_DECIMALS
export const POOL_B_REWARD_MICRO = config.POOL_B_REWARD_TOKENS * MICRO_TOKEN_DECIMALS
export const WITHDRAW_FEE_MICRO = config.WITHDRAW_FEE_TOKENS * MICRO_TOKEN_DECIMALS

// Validation helpers
export function validateConfig() {
  const errors = []

  if (config.BLOCK_TIME_MS < 100) {
    errors.push("BLOCK_TIME_MS must be at least 100ms")
  }

  if (config.DIFFICULTY_BITS < 1 || config.DIFFICULTY_BITS > 32) {
    errors.push("DIFFICULTY_BITS must be between 1 and 32")
  }

  if (config.MAX_SHARES_PB < 1) {
    errors.push("MAX_SHARES_PB must be at least 1")
  }

  if (config.WITHDRAW_FEE_TOKENS < 0) {
    errors.push("WITHDRAW_FEE_TOKENS must be non-negative")
  }

  return errors
}

console.log("[v0] Configuration loaded:")
console.log(`  Block time: ${config.BLOCK_TIME_MS}ms`)
console.log(`  Difficulty: ${config.DIFFICULTY_BITS} bits`)
console.log(`  Max shares per block: ${config.MAX_SHARES_PB}`)
console.log(`  Withdrawal fee: ${config.WITHDRAW_FEE_TOKENS} tokens`)
