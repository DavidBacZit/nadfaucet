import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"

interface MiningStatusProps {
  isRunning: boolean
  hashRate: number
  currentBlock: number
  timeLeft: number
  stats: {
    totalAttempts: number
    totalShares: number
    actualHashRate: number
    uptime: number
    activeWorkers?: number
  }
}

export function MiningStatus({ isRunning, hashRate, currentBlock, timeLeft, stats }: MiningStatusProps) {
  const blockProgress = Math.max(0, 100 - (timeLeft / 400) * 100)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          Mining Status
          <Badge variant={isRunning ? "default" : "secondary"}>
            {isRunning ? `Active (${stats.activeWorkers || 0} workers)` : "Inactive"}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <div className="text-muted-foreground">Target Rate</div>
            <div className="font-mono">{hashRate} H/s</div>
          </div>
          <div>
            <div className="text-muted-foreground">Actual Rate</div>
            <div className="font-mono">{stats.actualHashRate} H/s</div>
          </div>
          <div>
            <div className="text-muted-foreground">Block</div>
            <div className="font-mono">#{currentBlock}</div>
          </div>
          <div>
            <div className="text-muted-foreground">Time Left</div>
            <div className="font-mono">{(timeLeft / 1000).toFixed(1)}s</div>
          </div>
          <div>
            <div className="text-muted-foreground">Active Workers</div>
            <div className="font-mono">{stats.activeWorkers || 0}</div>
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span>Block Progress</span>
            <span>{blockProgress.toFixed(0)}%</span>
          </div>
          <Progress value={blockProgress} className="h-2" />
        </div>

        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <div className="text-muted-foreground">Attempts</div>
            <div className="font-mono">{stats.totalAttempts.toLocaleString()}</div>
          </div>
          <div>
            <div className="text-muted-foreground">Valid Shares</div>
            <div className="font-mono text-chart-5">{stats.totalShares}</div>
          </div>
        </div>

        {stats.totalAttempts > 0 && (
          <div className="space-y-1">
            <div className="flex justify-between text-sm">
              <span>Success Rate</span>
              <span>{((stats.totalShares / stats.totalAttempts) * 100).toFixed(4)}%</span>
            </div>
            <Progress value={(stats.totalShares / stats.totalAttempts) * 100} className="h-1" />
          </div>
        )}
      </CardContent>
    </Card>
  )
}
