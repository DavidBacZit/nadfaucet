// API client for communicating with the PoW faucet server

export class FaucetApiClient {
  constructor(baseUrl = "") {
    this.baseUrl = baseUrl
  }

  async _handleRequest(url, options = {}) {
    try {
      const response = await fetch(url, options)
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || `HTTP ${response.status}: ${response.statusText}`)
      }

      if (!data.ok) {
        throw new Error(data.error || "Server returned error")
      }

      return data
    } catch (error) {
      // Provide more specific error messages
      if (error.name === "TypeError" && error.message.includes("fetch")) {
        throw new Error(`Cannot connect to server at ${this.baseUrl}. Make sure the server is running on port 3000.`)
      }
      if (error.message.includes("NetworkError") || error.message.includes("Failed to fetch")) {
        throw new Error(`Network error: Cannot reach server at ${this.baseUrl}. Check if the server is running.`)
      }
      throw error
    }
  }

  // Get current mining challenge
  async getChallenge() {
    return await this._handleRequest(`${this.baseUrl}/challenge`)
  }

  // Submit a mining share
  async submitShare(address, blockNumber, nonce) {
    return await this._handleRequest(`${this.baseUrl}/submit-proof`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        address,
        blockNumber,
        nonce,
      }),
    })
  }

  // Get user status and balance
  async getStatus(address) {
    return await this._handleRequest(`${this.baseUrl}/status?address=${encodeURIComponent(address)}`)
  }

  // Request withdrawal
  async requestWithdrawal(address, amountMicro) {
    return await this._handleRequest(`${this.baseUrl}/withdraw-request`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        address,
        amountMicro,
      }),
    })
  }

  // Get server health
  async getHealth() {
    return await this._handleRequest(`${this.baseUrl}/health`)
  }

  async testConnection() {
    try {
      await this.getHealth()
      return { connected: true, error: null }
    } catch (error) {
      return { connected: false, error: error.message }
    }
  }
}
