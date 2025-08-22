export class FaucetApiClient {
  constructor(baseUrl = "") {
    this.baseUrl = baseUrl
    this.defaultTimeout = 3000 // ms
  }

  async _handleRequest(url, options = {}, timeoutMs = this.defaultTimeout) {
    const controller = new AbortController()
    const id = setTimeout(() => controller.abort(), timeoutMs)
    options.signal = controller.signal

    try {
      const response = await fetch(url, options)
      clearTimeout(id)

      // try parsing JSON (may throw)
      const data = await response.json().catch(() => {
        throw new Error(`Invalid JSON from server (HTTP ${response.status})`)
      })

      if (!response.ok) {
        throw new Error(data?.error || `HTTP ${response.status}: ${response.statusText}`)
      }

      if (!data.ok) {
        throw new Error(data.error || "Server returned error")
      }

      return data
    } catch (error) {
      clearTimeout(id)
      // Aborted by timeout
      if (error.name === "AbortError") {
        throw new Error(`Request timed out after ${timeoutMs}ms`)
      }
      // Network-level fetch failure
      if (error.name === "TypeError" && error.message.includes("fetch")) {
        throw new Error(`Cannot connect to server at ${this.baseUrl}. Make sure the server is reachable.`)
      }
      throw error
    }
  }

  // Get current mining challenge
  async getChallenge() {
    return await this._handleRequest(`${this.baseUrl}/challenge`)
  }

  // Submit a mining share — note: NO blockNumber now
  async submitShare(address, nonce) {
    return await this._handleRequest(`${this.baseUrl}/submit-proof`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ address, nonce }),
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
    return await this._handleRequest(`${this.baseUrl}/health`, {}, 2000)
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
