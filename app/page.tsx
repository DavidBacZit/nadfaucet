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

type PendingShareItem = {
  share: {
    address: string
    blockNumber?: number
    nonce: string
    leadingZeroBits?: number
    hashHex?: string
  }
  attempts: number
  nextAttempt: number
  addedAt: number
}

export default function PoWFaucetPage() {
  // State management
  const [address, setAddress] = useState("")
  // total desired H/s
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
    () => new FaucetApiClient("https://applicable-reproduction-examined-grace.trycloudflare.com/"),
  )
  const [connectionStatus, setConnectionStatus] = useState({ connected: false, checking: true })

  // Queue for pending shares (in-memory). Kept in ref to avoid re-renders.
  const pendingSharesRef = useRef<PendingShareItem[]>([])
  const [pendingCount, setPendingCount] = useState(0)
  const queueTimerRef = useRef<number | null>(null)

  // Reconnect timer ref
  const reconnectTimer = useRef<number | null>(null)

  // --- FRONTEND LIMITS FOR WORKERS/HASHRATE ---
  const MAX_PER_WORKER_RATE = 5 // H/s per worker cap
  const ABSOLUTE_MAX_WORKERS = 256
  const hw = typeof navigator !== "undefined" ? navigator.hardwareConcurrency || 4 : 4
  const RECOMMENDED_MAX_WORKERS = Math.max(1, Math.floor(hw * 4))

  const maxAllowedHashRate = MAX_PER_WORKER_RATE * ABSOLUTE_MAX_WORKERS // hard limit
  const recommendedMaxHashRate = MAX_PER_WORKER_RATE * RECOMMENDED_MAX_WORKERS

  // Initialize mining manager
  useEffect(() => {
    let mounted = true

    const initMining = async () => {
      try {
        const manager = new MiningManager()
        await manager.initialize()

        // Set up event handlers
        manager.onShareFound = (share) => {
          try {
            console.log("[v0] Share found:", {
              address: share.address,
              blockNumber: share.blockNumber,
              leadingZeroBits: share.leadingZeroBits,
              nonce: share.nonce,
              difficulty: share.difficultyBits,
              hashHex: share.hashHex,
            })

            // Push to local queue for reliable submission
            const now = Date.now()
            pendingSharesRef.current.push({
              share,
              attempts: 0,
              nextAttempt: now,
              addedAt: now,
            })
            setPendingCount(pendingSharesRef.current.length)

            // transient UI note
            setStatus("Share queued")
            setTimeout(() => setStatus(""), 1500)
          } catch (err) {
            console.error("[v0] Error queueing share:", err)
          }
        }

        manager.onStatsUpdate = (stats) => {
          setMiningStats(stats)
        }

        manager.onError = (err) => {
          // optionally show errors
          console.error("[v0] Mining manager error:", err)
        }

        manager.onStatusChange = (status) => {
          setIsRunning(status.isRunning)
          if (status.activeWorkers !== undefined) {
            setMiningStats((prev) => ({ ...prev, activeWorkers: status.activeWorkers }))
          }
        }

        if (!mounted) {
          manager.destroy()
          return
        }
        setMiningManager(manager)
      } catch (err) {
        console.error("[v0] Failed to initialize mining:", err)
        //setError(`Failed to initialize mining: ${err.message}`)
      }
    }

    initMining()

    return () => {
      mounted = false
      if (miningManager) {
        miningManager.destroy()
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Connection / health check loop (with retry/backoff)
  useEffect(() => {
    let mounted = true
    let backoffMs = 1000

    const checkConnection = async () => {
      try {
        const result = await apiClient.testConnection()
        if (!mounted) return

        setConnectionStatus({ ...result, checking: false })

        if (!result.connected) {
          // Exponential backoff up to 12s
          if (reconnectTimer.current) {
            clearTimeout(reconnectTimer.current)
            reconnectTimer.current = null
          }
          reconnectTimer.current = window.setTimeout(() => {
            backoffMs = Math.min(12000, backoffMs * 2)
            checkConnection().catch(() => {})
          }, backoffMs)
        } else {
          // reset backoff
          backoffMs = 1000
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
        backoffMs = Math.min(12000, backoffMs * 2)
        reconnectTimer.current = window.setTimeout(() => {
          checkConnection().catch(() => {})
        }, backoffMs)
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

  // Update challenge & block info — drive by server-supplied msLeft and reschedule precisely
  useEffect(() => {
    let mounted = true
    let timeout: number | undefined

    const updateChallenge = async () => {
      try {
        const challenge = await apiClient.getChallenge()
        if (!mounted) return

        setCurrentBlock(challenge.blockNumber)
        setTimeLeft(challenge.msLeft)
        setConnectionStatus({ connected: true, checking: false })

        // update miningManager's challenge if mining
        if (address && /^0x[a-fA-F0-9]{40}$/.test(address) && miningManager && isRunning) {
          miningManager.updateChallenge({
            address,
            blockNumber: challenge.blockNumber,
            seedHex: challenge.seedHex,
            difficultyBits: challenge.difficultyBits,
          })
        }

        // schedule next update right after block boundary (+200ms slack)
        const nextDelay = Math.max(200, challenge.msLeft + 200)
        timeout = window.setTimeout(updateChallenge, nextDelay)
      } catch (err: any) {
        console.error("Failed to fetch challenge:", err)
        setConnectionStatus({ connected: false, checking: false })

        // retry after short delay (backoff)
        timeout = window.setTimeout(updateChallenge, 1500)
      }
    }

    updateChallenge()

    return () => {
      mounted = false
      if (timeout) {
        clearTimeout(timeout)
      }
    }
  }, [address, isRunning, miningManager, apiClient])

  // Poll user status/balance less frequently (every 2000ms) to avoid overloading server
  useEffect(() => {
    let interval: number | undefined
    let mounted = true

    const doStatusPoll = async () => {
      if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) return
      try {
        const status = await apiClient.getStatus(address)
        if (!mounted) return
        setBalance(status.balanceMicro)
        // also update server connection flag if success
        setConnectionStatus((prev) => ({ ...prev, connected: true, checking: false }))
      } catch (err) {
        // don't spam errors; mark disconnected
        setConnectionStatus((prev) => ({ ...prev, connected: false, checking: false }))
      }
    }

    interval = window.setInterval(doStatusPoll, 2000)
    // run once immediately
    doStatusPoll().catch(() => {})

    return () => {
      mounted = false
      if (interval) clearInterval(interval)
    }
  }, [address, apiClient])

  // Queue processor: pick pending shares and attempt submit with exponential backoff
  useEffect(() => {
    const processQueue = async () => {
      if (!pendingSharesRef.current || pendingSharesRef.current.length === 0) return

      const now = Date.now()
      const maxPerTick = 4 // limit how many submits we try per tick to avoid spikes
      let processed = 0

      // iterate over queue by index (we'll mutate as needed)
      for (let i = 0; i < pendingSharesRef.current.length && processed < maxPerTick; ) {
        const item = pendingSharesRef.current[i]
        if (item.nextAttempt > now) {
          i++
          continue
        }

        const { share } = item

        try {
          // Submit share to server (server will accept with its current block internally)
          await apiClient.submitShare(share.address, share.nonce)
          // success -> remove from queue
          pendingSharesRef.current.splice(i, 1)
          processed++
          setStatus("Share submitted")
          setTimeout(() => setStatus(""), 1200)
        } catch (err: any) {
          // submission failed -> schedule retry with exponential backoff
          item.attempts = (item.attempts || 0) + 1
          // base 800ms * 2^attempts, cap at 60s
          const backoff = Math.min(60000, 800 * Math.pow(2, Math.max(0, item.attempts - 1)))
          item.nextAttempt = Date.now() + backoff

          // If server returned a permanent client error (400s except 429), then drop share
          const msg = err?.message || ""
          const isPermanent =
            msg.includes("Invalid") ||
            msg.includes("Insufficient") ||
            msg.includes("Duplicate") ||
            msg.includes("Invalid nonce") ||
            msg.includes("Invalid Ethereum address")

          if (isPermanent) {
            console.warn("[v0] Dropping share due to permanent error:", msg)
            pendingSharesRef.current.splice(i, 1)
            // do not increment i since we removed current item
          } else {
            // transient error -> keep in queue and move to next item
            i++
          }

          // safety: after many attempts drop to avoid infinite memory growth
          if (item.attempts >= 8) {
            console.warn("[v0] Dropping share after too many attempts:", item)
            const idx = pendingSharesRef.current.indexOf(item)
            if (idx >= 0) pendingSharesRef.current.splice(idx, 1)
          }
        }
      }

      // update pending count state if changed
      setPendingCount(pendingSharesRef.current.length)
    }

    // run periodically to process queue
    queueTimerRef.current = window.setInterval(() => {
      processQueue().catch((e) => console.error("Queue processing error:", e))
    }, 1500)

    // try one immediate processing pass
    processQueue().catch(() => {})

    return () => {
      if (queueTimerRef.current) {
        clearInterval(queueTimerRef.current)
        queueTimerRef.current = null
      }
    }
  }, [apiClient])

  // Mining controls
  const startMining = useCallback(async () => {
    if (!miningManager || !address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
      setError("Please enter a valid Ethereum address")
      return
    }

    // Allow mining even if server is not currently connected.
    if (!connectionStatus.connected) {
      console.warn("Server not connected — mining will run locally and queue shares for later submission.")
      setStatus("Mining locally (server offline). Shares will be queued.")
      setTimeout(() => setStatus(""), 2500)
    }

    try {
      const challenge = await apiClient.getChallenge().catch((e) => {
        // If challenge fetch fails, start mining anyway with last-known block info (miningManager will update when challenge returns)
        console.warn("Failed to fetch challenge before start:", e?.message || e)
        return {
          blockNumber: currentBlock,
          seedHex: "",
          difficultyBits: 18,
        }
      })

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
      // reset error/status
      setError("")
      // setStatus("Mining started!")
    } catch (err: any) {
      console.error("Failed to start mining:", err)
      setError(`Failed to start mining: ${err?.message || err}`)
    }
  }, [miningManager, address, hashRate, apiClient, connectionStatus.connected, currentBlock])

  const stopMining = useCallback(() => {
    if (miningManager) {
      miningManager.stopMining()
      setStatus("Mining stopped")
      setTimeout(() => setStatus(""), 1500)
    }
  }, [miningManager])

  // Utility: clamp hashRate to allowed range
  const clampHashRate = useCallback((value: number) => {
    const normalized = Number.isFinite(value) ? Math.max(1, Math.floor(value)) : 1
    const clamped = Math.min(normalized, maxAllowedHashRate)
    return clamped
  }, [])

  const updateHashRate = useCallback(
    (newRate: number) => {
      const clamped = clampHashRate(newRate)
      setHashRate(clamped)
      if (miningManager && isRunning) {
        miningManager.updateHashRate(clamped)
      }
    },
    [miningManager, isRunning, clampHashRate],
  )

  const incrementHashRate = useCallback(() => {
    const newRate = clampHashRate(hashRate + 1)
    updateHashRate(newRate)
  }, [hashRate, updateHashRate, clampHashRate])

  const decrementHashRate = useCallback(() => {
    const newRate = Math.max(clampHashRate(hashRate - 1), 1)
    updateHashRate(newRate)
  }, [hashRate, updateHashRate, clampHashRate])

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
      setError(`Withdrawal failed: ${err?.message || err}`)
    }
  }, [address, withdrawAmount, apiClient])

  const estimatedWorkers = Math.ceil(hashRate / MAX_PER_WORKER_RATE)

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

          {pendingCount > 0 && (
            <div className="text-xs text-muted-foreground">Pending shares queued: {pendingCount}</div>
          )}
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
              <strong>Server not running:</strong> Mining will continue locally and queue shares. Check your backend server when convenient.
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
                <Label htmlFor="hashrate">Hash Rate (H/s)</Label>
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
                        const clamped = clampHashRate(value)
                        updateHashRate(clamped)
                      } else if (e.target.value === "") {
                        setHashRate(1)
                      }
                    }}
                    onBlur={(e) => {
                      const value = Number(e.target.value)
                      if (isNaN(value) || value < 1) {
                        updateHashRate(1)
                      } else {
                        updateHashRate(clampHashRate(value))
                      }
                    }}
                    className="text-center font-mono"
                    max={maxAllowedHashRate}
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

                <div className="text-xs text-muted-foreground">
                  Estimated workers: <span className="font-mono">{estimatedWorkers}</span> (max per worker: {MAX_PER_WORKER_RATE} H/s).
                  <div>Max allowed H/s: {maxAllowedHashRate} ({ABSOLUTE_MAX_WORKERS} workers max). Recommended ≤ {recommendedMaxHashRate} ({RECOMMENDED_MAX_WORKERS} workers).</div>
                </div>

                {hashRate > recommendedMaxHashRate && (
                  <div className="text-xs text-yellow-600">Warning: requested rate exceeds recommended workers ({RECOMMENDED_MAX_WORKERS}). This may cause high resource usage.</div>
                )}
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
