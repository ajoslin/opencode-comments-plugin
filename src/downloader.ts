import { spawn } from "bun"
import { appendFileSync, chmodSync, existsSync, mkdirSync, unlinkSync } from "node:fs"
import { join } from "node:path"
import { homedir, tmpdir } from "node:os"
import { createRequire } from "node:module"

const DEBUG = process.env.COMMENT_CHECKER_DEBUG === "1"
const DEBUG_FILE = join(tmpdir(), "comment-checker-debug.log")

function debugLog(...args: unknown[]) {
  if (!DEBUG) return
  const msg = `[${new Date().toISOString()}] [comment-checker:downloader] ${args.map(a => typeof a === "object" ? JSON.stringify(a, null, 2) : String(a)).join(" ")}\n`
  appendFileSync(DEBUG_FILE, msg)
}

const REPO = "code-yeongyu/go-claude-code-comment-checker"

interface PlatformInfo {
  os: string
  arch: string
  ext: "tar.gz" | "zip"
}

const PLATFORM_MAP: Record<string, PlatformInfo> = {
  "darwin-arm64": { os: "darwin", arch: "arm64", ext: "tar.gz" },
  "darwin-x64": { os: "darwin", arch: "amd64", ext: "tar.gz" },
  "linux-arm64": { os: "linux", arch: "arm64", ext: "tar.gz" },
  "linux-x64": { os: "linux", arch: "amd64", ext: "tar.gz" },
  "win32-x64": { os: "windows", arch: "amd64", ext: "zip" },
}

export function getCacheDir(): string {
  const xdgCache = process.env.XDG_CACHE_HOME
  const base = xdgCache || join(homedir(), ".cache")
  return join(base, "opencode-comments-plugin", "bin")
}

export function getBinaryName(): string {
  return process.platform === "win32" ? "comment-checker.exe" : "comment-checker"
}

export function getCachedBinaryPath(): string | null {
  const binaryPath = join(getCacheDir(), getBinaryName())
  return existsSync(binaryPath) ? binaryPath : null
}

function getPackageVersion(): string {
  try {
    const require = createRequire(import.meta.url)
    const pkg = require("@code-yeongyu/comment-checker/package.json")
    return pkg.version
  } catch {
    return "0.7.0"
  }
}

async function extractTarGz(archivePath: string, destDir: string): Promise<void> {
  debugLog("Extracting tar.gz:", archivePath, "to", destDir)

  const proc = spawn(["tar", "-xzf", archivePath, "-C", destDir], {
    stdout: "pipe",
    stderr: "pipe",
  })

  const exitCode = await proc.exited
  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text()
    throw new Error(`tar extraction failed (exit ${exitCode}): ${stderr}`)
  }
}

async function extractZip(archivePath: string, destDir: string): Promise<void> {
  debugLog("Extracting zip:", archivePath, "to", destDir)

  const proc = process.platform === "win32"
    ? spawn(["powershell", "-command", `Expand-Archive -Path '${archivePath}' -DestinationPath '${destDir}' -Force`], {
        stdout: "pipe",
        stderr: "pipe",
      })
    : spawn(["unzip", "-o", archivePath, "-d", destDir], {
        stdout: "pipe",
        stderr: "pipe",
      })

  const exitCode = await proc.exited
  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text()
    throw new Error(`zip extraction failed (exit ${exitCode}): ${stderr}`)
  }
}

export async function downloadCommentChecker(): Promise<string | null> {
  const platformKey = `${process.platform}-${process.arch}`
  const platformInfo = PLATFORM_MAP[platformKey]

  if (!platformInfo) {
    debugLog("Unsupported platform:", platformKey)
    return null
  }

  const cacheDir = getCacheDir()
  const binaryName = getBinaryName()
  const binaryPath = join(cacheDir, binaryName)

  if (existsSync(binaryPath)) {
    debugLog("Binary already cached at:", binaryPath)
    return binaryPath
  }

  const version = getPackageVersion()
  const { os, arch, ext } = platformInfo
  const assetName = `comment-checker_v${version}_${os}_${arch}.${ext}`
  const downloadUrl = `https://github.com/${REPO}/releases/download/v${version}/${assetName}`

  debugLog("Downloading from:", downloadUrl)
  console.log("[opencode-comments-plugin] Downloading comment-checker binary...")

  try {
    if (!existsSync(cacheDir)) {
      mkdirSync(cacheDir, { recursive: true })
    }

    const response = await fetch(downloadUrl, { redirect: "follow" })
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }

    const archivePath = join(cacheDir, assetName)
    const arrayBuffer = await response.arrayBuffer()
    await Bun.write(archivePath, arrayBuffer)

    debugLog("Downloaded archive to:", archivePath)

    if (ext === "tar.gz") {
      await extractTarGz(archivePath, cacheDir)
    } else {
      await extractZip(archivePath, cacheDir)
    }

    if (existsSync(archivePath)) {
      unlinkSync(archivePath)
    }

    if (process.platform !== "win32" && existsSync(binaryPath)) {
      chmodSync(binaryPath, 0o755)
    }

    debugLog("Successfully downloaded binary to:", binaryPath)
    console.log("[opencode-comments-plugin] comment-checker binary ready.")

    return binaryPath
  } catch (err) {
    debugLog("Failed to download:", err)
    console.error(`[opencode-comments-plugin] Failed to download comment-checker: ${err instanceof Error ? err.message : err}`)
    console.error("[opencode-comments-plugin] Comment checking disabled.")
    return null
  }
}

export async function ensureCommentCheckerBinary(): Promise<string | null> {
  const cachedPath = getCachedBinaryPath()
  if (cachedPath) {
    debugLog("Using cached binary:", cachedPath)
    return cachedPath
  }

  return downloadCommentChecker()
}
