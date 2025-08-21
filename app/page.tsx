"use client"

import { useState, useEffect, useCallback } from "react"
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
import { SpeedInsights } from "@vercel/speed-insights/next"
export default function PoWFaucetPage() {
  // State management
  const [address, setAddress] = useState("")
  const [hashRate, setHashRate] = useState(1)
  const [maxWorkers, setMaxWorkers] = useState(64) // Default server-safe value
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
    () => new FaucetApiClient("https://competitive-emission-lib-thereafter.trycloudflare.com"),
  )
  const [connectionStatus, setConnectionStatus] = useState({ connected: false, checking: true })

  // Initialize mining manager
  useEffect(() => {
    const initMining = async () => {
      try {
        const manager = new MiningManager()
        await manager.initialize()

        // Set up event handlers
        manager.onShareFound = async (share) => {
          try {
            await apiClient.submitShare(share.address, share.blockNumber, share.nonce)
            setStatus(`Share submitted! Difficulty: ${share.leadingZeroBits} bits`)
            setTimeout(() => setStatus(""), 3000)
          } catch (err) {
            setError(`Failed to submit share: ${err.message}`)
          }
        }

        manager.onStatsUpdate = (stats) => {
          setMiningStats(stats)
        }

        manager.onError = (err) => {
          setError(`Mining error: ${err.message}`)
        }

        manager.onStatusChange = (status) => {
          setIsRunning(status.isRunning)
          if (status.activeWorkers !== undefined) {
            setMiningStats((prev) => ({ ...prev, activeWorkers: status.activeWorkers }))
          }
        }

        setMiningManager(manager)
      } catch (err) {
        setError(`Failed to initialize mining: ${err.message}`)
      }
    }

    initMining()

    return () => {
      if (miningManager) {
        miningManager.destroy()
      }
    }
  }, [])

  useEffect(() => {
    const checkConnection = async () => {
      const result = await apiClient.testConnection()
      setConnectionStatus({ ...result, checking: false })

      if (!result.connected) {
        setError(`Server connection failed: ${result.error}`)
      }
    }

    checkConnection()
  }, [apiClient])

  useEffect(() => {
    if (typeof navigator !== "undefined" && navigator.hardwareConcurrency) {
      setMaxWorkers(navigator.hardwareConcurrency)
    }
  }, [])

  // Update challenge and balance periodically
  useEffect(() => {
    const updateData = async () => {
      if (!connectionStatus.connected) {
        return
      }

      try {
        const challenge = await apiClient.getChallenge()
        setCurrentBlock(challenge.blockNumber)
        setTimeLeft(challenge.msLeft)

        if (address && /^0x[a-fA-F0-9]{40}$/.test(address)) {
          const status = await apiClient.getStatus(address)
          setBalance(status.balanceMicro)

          // Update mining challenge if running
          if (miningManager && isRunning) {
            miningManager.updateChallenge({
              address,
              blockNumber: challenge.blockNumber,
              seedHex: challenge.seedHex,
              difficultyBits: challenge.difficultyBits,
            })
          }
        }
      } catch (err) {
        console.error("Failed to update data:", err)
        if (err.message.includes("Cannot connect to server") || err.message.includes("Network error")) {
          setConnectionStatus({ connected: false, checking: false })
          setError(err.message)
        }
      }
    }

    updateData()
    const interval = setInterval(updateData, 1000)
    return () => clearInterval(interval)
  }, [address, miningManager, isRunning, apiClient, connectionStatus.connected])

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
      setStatus("Mining started!")
    } catch (err) {
      setError(`Failed to start mining: ${err.message}`)
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
    const newRate = Math.min(hashRate + 1, maxWorkers)
    updateHashRate(newRate)
  }, [hashRate, updateHashRate, maxWorkers])

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
    } catch (err) {
      setError(`Withdrawal failed: ${err.message}`)
    }
  }, [address, withdrawAmount, apiClient])

  return (
    <div className="min-h-screen bg-background p-4">
      <div className="mx-auto max-w-6xl space-y-6">
        {/* Header */}
        <div className="text-center space-y-2">
          <h1 className="text-3xl font-bold text-foreground">$MON faucet</h1>
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
                    max={maxWorkers}
                    value={hashRate}
                    onChange={(e) => updateHashRate(Math.max(1, Math.min(Number(e.target.value) || 1, maxWorkers)))}
                    className="text-center font-mono"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={incrementHashRate}
                    disabled={hashRate >= maxWorkers}
                    className="px-3"
                  >
                    +
                  </Button>
                </div>
                <div className="text-xs text-muted-foreground">Max: {maxWorkers} workers (CPU cores)</div>
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
                  <span className="font-mono">{(timeLeft / 1000).toFixed(1)}s</span>
                </div>
                <div className="space-y-1">
                  <div className="flex justify-between text-sm">
                    <span>Block Progress</span>
                    <span>{Math.max(0, 100 - (timeLeft / 400) * 100).toFixed(0)}%</span>
                  </div>
                  <Progress value={Math.max(0, 100 - (timeLeft / 400) * 100)} className="h-2" />
                </div>
              </div>

              <Separator />

              <div className="space-y-2">
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">Pool A Reward:</span>
                  <span>50 tokens</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">Pool B Reward:</span>
                  <span>50 tokens</span>
                </div>
                <div className="text-xs text-muted-foreground">
                  Pool A: Proportional by shares • Pool B: Weighted lottery
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Balance & Withdrawal */}
          <Card>
            <CardHeader>
              <CardTitle>Balance & Withdrawal</CardTitle>
              <CardDescription>Manage your earned tokens</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="text-center">
                <div className="text-2xl font-bold text-primary">{(balance / 1e6).toFixed(6)}</div>
                <div className="text-sm text-muted-foreground">Tokens</div>
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
                <div className="text-xs text-muted-foreground">Minimum: 1001 tokens (1000 token fee)</div>
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
              <CardDescription>Real-time mining performance metrics</CardDescription>
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

        {/* Footer */}
        <div className="text-center text-sm text-muted-foreground">
          <p>Proof-of-Work mining faucet with dual reward pools • Block time: 400ms • Difficulty: 18 bits</p>
        </div>
      </div>
    </div>
  )
}
