import { spawn } from "bun"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { existsSync } from "node:fs"
import { appendFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { ensureCommentCheckerBinary, getCachedBinaryPath } from "./downloader"
import type { CheckResult, HookInput } from "./types"

const DEBUG = process.env.COMMENT_CHECKER_DEBUG === "1"
const DEBUG_FILE = join(tmpdir(), "comment-checker-debug.log")

function debugLog(...args: unknown[]) {
  if (!DEBUG) return
  const msg = `[${new Date().toISOString()}] [comment-checker:cli] ${args.map(a => typeof a === "object" ? JSON.stringify(a, null, 2) : String(a)).join(" ")}\n`
  appendFileSync(DEBUG_FILE, msg)
}

function getBinaryName(): string {
  return process.platform === "win32" ? "comment-checker.exe" : "comment-checker"
}

function findCommentCheckerPathSync(): string | null {
  const binaryName = getBinaryName()

  try {
    const require = createRequire(import.meta.url)
    const cliPkgPath = require.resolve("@code-yeongyu/comment-checker/package.json")
    const cliDir = dirname(cliPkgPath)
    const binaryPath = join(cliDir, "bin", binaryName)

    if (existsSync(binaryPath)) {
      debugLog("found binary in main package:", binaryPath)
      return binaryPath
    }
  } catch {
    debugLog("main package not installed")
  }

  const cachedPath = getCachedBinaryPath()
  if (cachedPath) {
    debugLog("found binary in cache:", cachedPath)
    return cachedPath
  }

  debugLog("no binary found in known locations")
  return null
}

let resolvedCliPath: string | null = null
let initPromise: Promise<string | null> | null = null

export async function getCommentCheckerPath(): Promise<string | null> {
  if (resolvedCliPath !== null) {
    return resolvedCliPath
  }

  if (initPromise) {
    return initPromise
  }

  initPromise = (async () => {
    const syncPath = findCommentCheckerPathSync()
    if (syncPath && existsSync(syncPath)) {
      resolvedCliPath = syncPath
      debugLog("using sync-resolved path:", syncPath)
      return syncPath
    }

    debugLog("triggering lazy download...")
    const downloadedPath = await ensureCommentCheckerBinary()
    if (downloadedPath) {
      resolvedCliPath = downloadedPath
      debugLog("using downloaded path:", downloadedPath)
      return downloadedPath
    }

    debugLog("no binary available")
    return null
  })()

  return initPromise
}

export function getCommentCheckerPathSync(): string | null {
  return resolvedCliPath ?? findCommentCheckerPathSync()
}

export function startBackgroundInit(): void {
  if (initPromise) return
  initPromise = getCommentCheckerPath()
  initPromise.then(path => {
    debugLog("background init complete:", path || "no binary")
  }).catch(err => {
    debugLog("background init error:", err)
  })
}

export interface RunOptions {
  cliPath?: string
  prompt?: string
}

export async function runCommentChecker(input: HookInput, options: RunOptions = {}): Promise<CheckResult> {
  const binaryPath = options.cliPath ?? resolvedCliPath ?? getCommentCheckerPathSync()

  if (!binaryPath) {
    debugLog("comment-checker binary not found")
    return { hasComments: false, message: "" }
  }

  if (!existsSync(binaryPath)) {
    debugLog("comment-checker binary does not exist:", binaryPath)
    return { hasComments: false, message: "" }
  }

  const jsonInput = JSON.stringify(input)
  debugLog("running comment-checker with input:", jsonInput.substring(0, 200))

  try {
    const args = [binaryPath]
    if (options.prompt && options.prompt.trim().length > 0) {
      args.push("--prompt", options.prompt)
    }

    const proc = spawn(args, {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    })

    proc.stdin.write(jsonInput)
    proc.stdin.end()

    const stdout = await new Response(proc.stdout).text()
    const stderr = await new Response(proc.stderr).text()
    const exitCode = await proc.exited

    debugLog("exit code:", exitCode, "stdout length:", stdout.length, "stderr length:", stderr.length)

    if (exitCode === 0) {
      return { hasComments: false, message: "" }
    }

    if (exitCode === 2) {
      return { hasComments: true, message: stderr }
    }

    debugLog("unexpected exit code:", exitCode, "stderr:", stderr)
    return { hasComments: false, message: "" }
  } catch (err) {
    debugLog("failed to run comment-checker:", err)
    return { hasComments: false, message: "" }
  }
}
