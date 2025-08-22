"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { Separator } from "@/components/ui/separator"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { MiningManager } from "@/lib/mining-manager"
import { FaucetApiClient } from "@/lib/api-client"

export default function PoWFaucetPage() {
  // State management
  const [address, setAddress] = useState("")
  const [hashRate, setHashRate] = useState(1)
  const [isRunning, setIsRunning] = useState(false)
  const [balance, setBalance] = useState(0)
  const [currentBlock, setCurrentBlock] = useState(0)
  const [timeLeft, setTimeLeft] = useState(0)
  const [miningStats, setMiningStats] = useState({
    totalAttempts: 0,
    totalShares: 0,
    actualHashRate: 0,
    uptime: 0,
    activeWorkers: 0,
  })
  const [withdrawAmount, setWithdrawAmount] = useState("")
  const [status, setStatus] = useState("")
  const [error, setError] = useState("")
  const [miningManager, setMiningManager] = useState<MiningManager | null>(null)
  const [apiClient] = useState(
    () => new FaucetApiClient("https://applicable-reproduction-examined-grace.trycloudflare.com"),
  )
  const [connectionStatus, setConnectionStatus] = useState({ connected: false, checking: true })

  // Prevent concurrent API calls
  const isUpdatingChallengeRef = useRef(false)
  const isUpdatingBalanceRef = useRef(false)

  // Initialize mining manager (robust cleanup)
  useEffect(() => {
    let mounted = true
    let manager: MiningManager | null = null

    const initMining = async () => {
      try {
        manager = new MiningManager()
        await manager.initialize()

        // Set up event handlers
        manager.onShareFound = async (share) => {
          try {
            console.log("[v0] Share found:", {
              address: share.address,
              blockNumber: share.blockNumber,
              leadingZeroBits: share.leadingZeroBits,
              nonce: share.nonce,
              difficulty: share.difficultyBits,
              hashHex: share.hashHex,
            })

            const result = await apiClient.submitShare(share.address, share.blockNumber, share.nonce)

            console.log("[v0] Share submitted successfully:", result)

            setTimeout(() => setStatus(""), 3000)
          } catch (err: any) {
            console.log("[v0] Share submission failed:", err?.message ?? err)
            // optionally surface share submit errors
          }
        }

        manager.onStatsUpdate = (stats) => {
          setMiningStats(stats)
        }

        manager.onError = (err) => {
          // you can surface mining errors if desired
          console.warn("MiningManager error:", err)
        }

        manager.onStatusChange = (status) => {
          setIsRunning(status.isRunning)
          if (status.activeWorkers !== undefined) {
            setMiningStats((prev) => ({ ...prev, activeWorkers: status.activeWorkers }))
          }
        }

        if (!mounted) {
          // if unmounted in the meantime, clean up
          manager.destroy()
          return
        }

        setMiningManager(manager)
      } catch (err: any) {
        console.error("Failed to initialize mining:", err?.message ?? err)
        setError("Failed to initialize mining manager")
      }
    }

    initMining()

    return () => {
      mounted = false
      if (manager) {
        try {
          manager.destroy()
        } catch (e) {
          console.warn("Error destroying mining manager:", e)
        }
      }
    }
  }, [apiClient])

  // Reconnect timer ref
  const reconnectTimer = useRef<number | null>(null)

  // Check connection — retry every 30s when offline
  useEffect(() => {
    let mounted = true

    const checkConnection = async () => {
      try {
        const result = await apiClient.testConnection()
        if (!mounted) return

        setConnectionStatus({ ...result, checking: false })

        // nếu thất bại thì đặt retry sau 30s
        if (!result.connected) {
          if (reconnectTimer.current) {
            clearTimeout(reconnectTimer.current)
            reconnectTimer.current = null
          }
          reconnectTimer.current = window.setTimeout(() => {
            checkConnection().catch(() => {})
          }, 30000)
        } else {
          if (reconnectTimer.current) {
            clearTimeout(reconnectTimer.current)
            reconnectTimer.current = null
          }
        }
      } catch (err) {
        if (!mounted) return
        setConnectionStatus({ connected: false, checking: false })
        if (reconnectTimer.current) {
          clearTimeout(reconnectTimer.current)
          reconnectTimer.current = null
        }
        reconnectTimer.current = window.setTimeout(() => {
          checkConnection().catch(() => {})
        }, 30000)
      }
    }

    checkConnection().catch(() => {})

    return () => {
      mounted = false
      if (reconnectTimer.current) {
        clearTimeout(reconnectTimer.current)
        reconnectTimer.current = null
      }
    }
  }, [apiClient])

  // If server is offline, absolutely stop hashing immediately
  useEffect(() => {
    if (!connectionStatus.connected && miningManager && isRunning) {
      try {
        miningManager.stopMining()
      } catch (e) {
        console.warn("Failed to stop mining on disconnect:", e)
      }
      setStatus("Server offline — mining stopped")
      setIsRunning(false)
    }
  }, [connectionStatus.connected, miningManager, isRunning])

  // Polling: challenge every 888ms; balance every 1 minute (60000ms)
  useEffect(() => {
    let mounted = true
    let challengeInterval: number | null = null
    let balanceInterval: number | null = null

    const fetchChallenge = async () => {
      if (!mounted) return
      if (isUpdatingChallengeRef.current) return
      isUpdatingChallengeRef.current = true

      try {
        const challenge = await apiClient.getChallenge()
        if (!mounted) return
        setCurrentBlock(challenge.blockNumber)
        setTimeLeft(challenge.msLeft)

        // mark server connected
        setConnectionStatus({ connected: true, checking: false })

        // Only update miningManager if we're running AND server connected
        if (address && /^0x[a-fA-F0-9]{40}$/.test(address)) {
          if (miningManager && isRunning && connectionStatus.connected) {
            miningManager.updateChallenge({
              address,
              blockNumber: challenge.blockNumber,
              seedHex: challenge.seedHex,
              difficultyBits: challenge.difficultyBits,
            })
          }
        }
      } catch (err: any) {
        console.error("Failed to fetch challenge:", err?.message ?? err)
        // Treat as server offline on failure
        setConnectionStatus({ connected: false, checking: false })
        // Ensure mining is stopped immediately
        if (miningManager && isRunning) {
          try {
            miningManager.stopMining()
          } catch (e) {
            console.warn("Failed to stop mining after challenge fetch fail:", e)
          }
          setIsRunning(false)
          setStatus("Server offline — mining stopped")
        }
      } finally {
        isUpdatingChallengeRef.current = false
      }
    }

    const fetchBalance = async () => {
      if (!mounted) return
      if (isUpdatingBalanceRef.current) return
      isUpdatingBalanceRef.current = true

      try {
        if (address && /^0x[a-fA-F0-9]{40}$/.test(address)) {
          const status = await apiClient.getStatus(address)
          if (!mounted) return
          setBalance(status.balanceMicro)
        }
      } catch (err: any) {
        console.error("Failed to fetch balance:", err?.message ?? err)
      } finally {
        isUpdatingBalanceRef.current = false
      }
    }

    // Initial fetch
    fetchChallenge().catch(() => {})
    fetchBalance().catch(() => {})

    // Intervals
    challengeInterval = window.setInterval(() => {
      fetchChallenge().catch(() => {})
    }, 888)

    balanceInterval = window.setInterval(() => {
      fetchBalance().catch(() => {})
    }, 60_000)

    return () => {
      mounted = false
      if (challengeInterval) clearInterval(challengeInterval)
      if (balanceInterval) clearInterval(balanceInterval)
    }
  }, [address, isRunning, miningManager, apiClient, connectionStatus.connected])

  // Mining controls
  const startMining = useCallback(async () => {
    if (!miningManager || !address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
      setError("Please enter a valid Ethereum address")
      return
    }

    if (!connectionStatus.connected) {
      setError("Cannot start mining: Server is not connected. Please check your server connection.")
      return
    }

    try {
      const challenge = await apiClient.getChallenge()
      console.log("[v0] Starting mining with challenge:", {
        address,
        blockNumber: challenge.blockNumber,
        seedHex: challenge.seedHex,
        difficultyBits: challenge.difficultyBits,
        hashRate,
      })

      miningManager.startMining(
        {
          address,
          blockNumber: challenge.blockNumber,
          seedHex: challenge.seedHex,
          difficultyBits: challenge.difficultyBits,
        },
        hashRate,
      )
      setError("")
    } catch (err: any) {
      console.error("Failed to start mining:", err?.message ?? err)
      setError(`Failed to start mining: ${err?.message ?? String(err)}`)
    }
  }, [miningManager, address, hashRate, apiClient, connectionStatus.connected])

  const stopMining = useCallback(() => {
    if (miningManager) {
      miningManager.stopMining()
      setStatus("Mining stopped")
    }
  }, [miningManager])

  const updateHashRate = useCallback(
    (newRate: number) => {
      setHashRate(newRate)
      if (miningManager && isRunning) {
        miningManager.updateHashRate(newRate)
      }
    },
    [miningManager, isRunning],
  )

  const incrementHashRate = useCallback(() => {
    const newRate = hashRate + 1
    updateHashRate(newRate)
  }, [hashRate, updateHashRate])

  const decrementHashRate = useCallback(() => {
    const newRate = Math.max(hashRate - 1, 1)
    updateHashRate(newRate)
  }, [hashRate, updateHashRate])

  // Withdrawal
  const requestWithdrawal = useCallback(async () => {
    if (!address || !withdrawAmount) {
      setError("Please enter address and withdrawal amount")
      return
    }

    const amountMicro = Number.parseFloat(withdrawAmount) * 1e6
    if (amountMicro <= 1000 * 1e6) {
      setError("Amount must be greater than 1000 tokens (withdrawal fee)")
      return
    }

    try {
      const result = await apiClient.requestWithdrawal(address, amountMicro)
      setStatus(`Withdrawal requested! Net amount: ${result.netAmount / 1e6} tokens`)
      setWithdrawAmount("")
      setError("")
    } catch (err: any) {
      setError(`Withdrawal failed: ${err?.message ?? String(err)}`)
    }
  }, [address, withdrawAmount, apiClient])

  return (
    <div className="min-h-screen bg-background p-4">
      <div className="mx-auto max-w-6xl space-y-6">
        {/* Header */}
        <div className="text-center space-y-2">
          <h1 className="text-3xl font-bold text-foreground">$NF faucet</h1>
          <div className="flex items-center justify-center gap-2">
            <div
              className={`w-2 h-2 rounded-full ${connectionStatus.checking ? "bg-yellow-500" : connectionStatus.connected ? "bg-green-500" : "bg-red-500"}`}
            />
            <span className="text-sm text-muted-foreground">
              {connectionStatus.checking
                ? "Checking server..."
                : connectionStatus.connected
                  ? "Server connected"
                  : "Server disconnected"}
            </span>
          </div>
        </div>

        {/* Status Alerts */}
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {!connectionStatus.connected && !connectionStatus.checking && (
          <Alert>
            <AlertDescription>
              <strong>Server not running:</strong> Cannot connect to the mining server. Make sure your backend server is
              running and accessible at the configured endpoint.
            </AlertDescription>
          </Alert>
        )}

        {status && (
          <Alert>
            <AlertDescription>{status}</AlertDescription>
          </Alert>
        )}

        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {/* Mining Configuration */}
          <Card>
            <CardHeader>
              <CardTitle>Mining Configuration</CardTitle>
              <CardDescription>Set up your mining parameters</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="address">Ethereum Address</Label>
                <Input
                  id="address"
                  placeholder="0x..."
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  className="font-mono text-sm"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="hashrate">Hash Rate (Workers)</Label>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={decrementHashRate}
                    disabled={hashRate <= 1}
                    className="px-3 bg-transparent"
                  >
                    -
                  </Button>
                  <Input
                    id="hashrate"
                    type="number"
                    min="1"
                    value={hashRate}
                    onChange={(e) => {
                      const value = Number(e.target.value)
                      if (!isNaN(value) && value >= 1) {
                        updateHashRate(value)
                      } else if (e.target.value === "") {
                        setHashRate(1)
                      }
                    }}
                    onBlur={(e) => {
                      const value = Number(e.target.value)
                      if (isNaN(value) || value < 1) {
                        updateHashRate(1)
                      }
                    }}
                    className="text-center font-mono"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={incrementHashRate}
                    className="px-3 bg-transparent"
                  >
                    +
                  </Button>
                </div>
              </div>

              <div className="flex gap-2">
                <Button onClick={startMining} disabled={isRunning} className="flex-1">
                  Start Mining
                </Button>
                <Button onClick={stopMining} disabled={!isRunning} variant="outline" className="flex-1 bg-transparent">
                  Stop Mining
                </Button>
              </div>

              <div className="flex items-center justify-between text-sm">
                <span>Status:</span>
                <div className="flex items-center gap-2">
                  <Badge variant={isRunning ? "default" : "secondary"}>
                    {isRunning ? `Mining (${miningStats.activeWorkers} workers)` : "Stopped"}
                  </Badge>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Block Information */}
          <Card>
            <CardHeader>
              <CardTitle>Current Block</CardTitle>
              <CardDescription>Real-time block information</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">Block Number:</span>
                  <span className="font-mono">{currentBlock}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">Time Left:</span>
                  <span className="font-mono">
                    {connectionStatus.connected ? `${(timeLeft / 1000).toFixed(1)}s` : "—"}
                  </span>
                </div>
              </div>

              <Separator />
            </CardContent>
          </Card>

          {/* Balance & Withdrawal */}
          <Card>
            <CardHeader>
              <CardTitle>Balance & Withdrawal</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="text-center">
                <div className="text-2xl font-bold text-primary">{(balance / 1e6).toFixed(0)}</div>
                <div className="text-sm text-muted-foreground">$NF</div>
              </div>

              <Separator />

              <div className="space-y-2">
                <Label htmlFor="withdraw-amount">Withdrawal Amount</Label>
                <Input
                  id="withdraw-amount"
                  type="number"
                  placeholder="Enter amount..."
                  value={withdrawAmount}
                  onChange={(e) => setWithdrawAmount(e.target.value)}
                />
                <div className="text-xs text-muted-foreground">Minimum: 1001 $NF (Fee: 1000 $NF)</div>
              </div>

              <Button onClick={requestWithdrawal} className="w-full" variant="secondary">
                Request Withdrawal
              </Button>
            </CardContent>
          </Card>

          {/* Mining Statistics */}
          <Card className="md:col-span-2 lg:col-span-3">
            <CardHeader>
              <CardTitle>Mining Statistics</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <div className="space-y-1">
                  <div className="text-sm text-muted-foreground">Total Attempts</div>
                  <div className="text-2xl font-bold">{miningStats.totalAttempts.toLocaleString()}</div>
                </div>
                <div className="space-y-1">
                  <div className="text-sm text-muted-foreground">Valid Shares</div>
                  <div className="text-2xl font-bold text-chart-5">{miningStats.totalShares}</div>
                </div>
                <div className="space-y-1">
                  <div className="text-sm text-muted-foreground">Hash Rate</div>
                  <div className="text-2xl font-bold text-chart-1">{miningStats.actualHashRate} H/s</div>
                </div>
                <div className="space-y-1">
                  <div className="text-sm text-muted-foreground">Uptime</div>
                  <div className="text-2xl font-bold">{Math.floor(miningStats.uptime)}s</div>
                </div>
                <div className="space-y-1">
                  <div className="text-sm text-muted-foreground">Active Workers</div>
                  <div className="text-2xl font-bold text-chart-2">{miningStats.activeWorkers}</div>
                </div>
              </div>

              {miningStats.totalAttempts > 0 && (
                <div className="mt-4 space-y-2">
                  <div className="flex justify-between text-sm">
                    <span>Success Rate</span>
                    <span>{((miningStats.totalShares / miningStats.totalAttempts) * 100).toFixed(4)}%</span>
                  </div>
                  <Progress value={(miningStats.totalShares / miningStats.totalAttempts) * 100} className="h-2" />
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
