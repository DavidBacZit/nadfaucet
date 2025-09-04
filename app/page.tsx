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
    () => new FaucetApiClient("https://api.nadfaucet.fun"),
  )
  const [connectionStatus, setConnectionStatus] = useState({ connected: false, checking: true })

  // Track consecutive connection failures
  const failureCountRef = useRef(0)
  // Reconnect timer ref
  const reconnectTimer = useRef<number | null>(null)

  // Helper: when repeated failures happen, lower workers to 0 (or 1 fallback)
  const lowerWorkersDueToFailures = useCallback((target = 0) => {
    try {
      // try set to target (0)
      setHashRate(target)
      if (miningManager) {
        // some implementations may not accept 0; wrap in try/catch
        try {
          miningManager.updateHashRate(target)
        } catch (err) {
          // fallback to 1
          const fallback = 1
          setHashRate(fallback)
          try {
            miningManager.updateHashRate(fallback)
          } catch (_) {}
        }
      }
      setStatus("API unreachable repeatedly — workers reduced to conserve resources")
    } catch (err) {
      // final fallback
      setHashRate(1)
      try {
        miningManager?.updateHashRate(1)
      } catch (_) {}
      setStatus("API unreachable repeatedly — workers reduced (fallback to 1)")
    }
  }, [miningManager])

  // Increment failure counter and potentially lower workers
  const incrementFailureCount = useCallback(() => {
    failureCountRef.current += 1
    if (failureCountRef.current >= 4) {
      lowerWorkersDueToFailures(0)
      // reset counter so we don't repeatedly re-apply
      failureCountRef.current = 0
    }
  }, [lowerWorkersDueToFailures])

  useEffect(() => {
    const initMining = async () => {
      try {
        const manager = new MiningManager()
        await manager.initialize()

        // Set up event handlers
        manager.onShareFound = async (share) => {
          try {
            const result = await apiClient.submitShare(share.address, share.blockNumber, share.nonce)
            console.log("[v0] Share submitted successfully:", result)
            setTimeout(() => setStatus(""), 3000)
          } catch (err: any) {
            console.log("[v0] Share submission failed:", err?.message || err)

            // Nếu block sai → fetch lại ngay
            if (err?.response?.error === "Invalid block number") {
              try {
                const challenge = await apiClient.getChallenge()
                console.warn("[fix] Resynced challenge:", challenge)

                miningManager?.updateChallenge({
                  address,
                  blockNumber: challenge.blockNumber,
                  seedHex: challenge.seedHex,
                  difficultyBits: challenge.difficultyBits,
                })
                setCurrentBlock(challenge.blockNumber)
                setTimeLeft(challenge.msLeft)
              } catch (e) {
                console.error("Failed to refresh challenge after invalid block:", e)
              }
            }
          }
        }


        manager.onStatsUpdate = (stats) => {
          setMiningStats(stats)
        }

        manager.onError = (err) => {
          //setError(`Mining error: ${err.message}`)
        }

        manager.onStatusChange = (status) => {
          setIsRunning(status.isRunning)
          if (status.activeWorkers !== undefined) {
            setMiningStats((prev) => ({ ...prev, activeWorkers: status.activeWorkers }))
          }
        }

        setMiningManager(manager)
      } catch (err: any) {
        //setError(`Failed to initialize mining: ${err.message}`)
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
    let mounted = true

    const checkConnection = async () => {
      try {
        const result = await apiClient.testConnection()
        if (!mounted) return

        setConnectionStatus({ ...result, checking: false })

        // reset failure counter on success
        if (result.connected) {
          failureCountRef.current = 0
        }

        // nếu thất bại thì đặt retry sau 15s
        if (!result.connected) {
          incrementFailureCount()

          if (reconnectTimer.current) {
            clearTimeout(reconnectTimer.current)
            reconnectTimer.current = null
          }
          reconnectTimer.current = window.setTimeout(() => {
            checkConnection().catch(() => {})
          }, 15000)
        } else {
          if (reconnectTimer.current) {
            clearTimeout(reconnectTimer.current)
            reconnectTimer.current = null
          }
        }
      } catch (err) {
        if (!mounted) return
        setConnectionStatus({ connected: false, checking: false })
        incrementFailureCount()

        if (reconnectTimer.current) {
          clearTimeout(reconnectTimer.current)
          reconnectTimer.current = null
        }
        reconnectTimer.current = window.setTimeout(() => {
          checkConnection().catch(() => {})
        }, 15000)
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
  }, [apiClient, incrementFailureCount])

  useEffect(() => {
    let timeout: NodeJS.Timeout
    let interval: NodeJS.Timeout

    const updateData = async () => {
      try {
        const challenge = await apiClient.getChallenge()
        setCurrentBlock(challenge.blockNumber)
        setTimeLeft(challenge.msLeft)

        // Đánh dấu server đã kết nối
        setConnectionStatus({ connected: true, checking: false })

        // reset failure counter on success
        failureCountRef.current = 0

        if (address && /^0x[a-fA-F0-9]{40}$/.test(address)) {
          const status = await apiClient.getStatus(address)
          setBalance(status.balanceMicro)

          if (miningManager && isRunning) {
            miningManager.updateChallenge({
              address,
              blockNumber: challenge.blockNumber,
              seedHex: challenge.seedHex,
              difficultyBits: challenge.difficultyBits,
            })
          }
        }

        // Gọi lại đúng lúc block mới (msLeft) để bắt block mới kịp thời
        timeout = setTimeout(updateData, challenge.msLeft + 50)
      } catch (err: any) {
        console.error("Failed to update data:", err)
        setConnectionStatus({ connected: false, checking: false })

        // tăng counter lỗi
        incrementFailureCount()

        // Retry sau 15s nếu lỗi
        timeout = setTimeout(updateData, 15000)
      }
    }

    // Chạy ngay khi mount
    updateData()

    return () => {
      clearTimeout(timeout)
      clearInterval(interval)
    }
  }, [address, isRunning, miningManager, incrementFailureCount])


  // Mining controls
  const startMining = useCallback(async () => {
    if (!miningManager || !address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
      setError("Please enter a valid Ethereum address")
      return
    }

    if (hashRate <= 0) {
      setError("Cannot start mining with 0 workers — increase hash rate to start")
      return
    }

    if (!connectionStatus.connected) {
      //setError("Cannot start mining: Server is not connected. Please check your server connection.")
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
      //setError("")
      //setStatus("Mining started!")
    } catch (err: any) {
      //setError(`Failed to start mining: ${err.message}`)
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
        try {
          miningManager.updateHashRate(newRate)
        } catch (err) {
          // ignore if manager doesn't accept the value
        }
      }
    },
    [miningManager, isRunning],
  )

  const incrementHashRate = useCallback(() => {
    const newRate = hashRate + 1
    updateHashRate(newRate)
  }, [hashRate, updateHashRate])

  const decrementHashRate = useCallback(() => {
    const newRate = Math.max(hashRate - 1, 0)
    updateHashRate(newRate)
  }, [hashRate, updateHashRate])

  // Withdrawal
  const requestWithdrawal = useCallback(async () => {
    if (!address || !withdrawAmount) {
      setError("Please enter address and withdrawal amount")
      return
    }

    const amountMicro = Number.parseFloat(withdrawAmount) * 1e6
    if (amountMicro <= 2100 * 1e6) {
      setError("Amount must be greater than 2100 tokens (withdrawal fee)")
      return
    }

    try {
      const result = await apiClient.requestWithdrawal(address, amountMicro)
      setStatus(`Withdrawal requested! Net amount: ${result.netAmount / 1e6} tokens`)
      setWithdrawAmount("")
      setError("")
    } catch (err: any) {
      setError(`Withdrawal failed: ${err.message}`)
    }
  }, [address, withdrawAmount, apiClient])

  return (
    <div className="min-h-screen bg-background p-4">
      <div className="mx-auto max-w-6xl space-y-6">
        {/* Header */}
        <div className="text-center space-y-2">
          <div className="flex items-center justify-center gap-2">
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
                    disabled={hashRate <= 0}
                    className="px-3 bg-transparent"
                  >
                    -
                  </Button>
                  <Input
                    id="hashrate"
                    type="number"
                    min="0"
                    value={hashRate}
                    onChange={(e) => {
                      const value = Number(e.target.value)
                      if (!isNaN(value) && value >= 0) {
                        updateHashRate(value)
                      } else if (e.target.value === "") {
                        setHashRate(0)
                      }
                    }}
                    onBlur={(e) => {
                      const value = Number(e.target.value)
                      if (isNaN(value) || value < 0) {
                        updateHashRate(0)
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
                <div className="text-xs text-muted-foreground">Minimum: 2500 $NF (Fee: 2500 $NF)</div>
                <div className="text-xs text-muted-foreground">$NF contract: 0xd6521294cf8b18729e6a0e9b0504b25b1b56fed9</div>
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
