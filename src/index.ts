import type { Plugin } from "@opencode-ai/plugin"
import { existsSync } from "node:fs"
import { appendFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { COMMENT_CHECKER_EVENT, OUTPUT_FAILURE_PATTERNS, TOOL_NAMES } from "./constants"
import { getCommentCheckerPath, runCommentChecker, startBackgroundInit } from "./cli"
import type { PendingCall } from "./types"

const DEBUG = process.env.COMMENT_CHECKER_DEBUG === "1"
const DEBUG_FILE = join(tmpdir(), "comment-checker-debug.log")

function debugLog(...args: unknown[]) {
  if (!DEBUG) return
  const msg = `[${new Date().toISOString()}] [comment-checker:hook] ${args.map(a => typeof a === "object" ? JSON.stringify(a, null, 2) : String(a)).join(" ")}\n`
  appendFileSync(DEBUG_FILE, msg)
}

const pendingCalls = new Map<string, PendingCall>()
const PENDING_CALL_TTL = 60_000

let cliPathPromise: Promise<string | null> | null = null
let customPrompt: string | undefined

function cleanupOldPendingCalls(): void {
  const now = Date.now()
  for (const [callID, call] of pendingCalls) {
    if (now - call.timestamp > PENDING_CALL_TTL) {
      pendingCalls.delete(callID)
    }
  }
}

function resolveCustomPrompt(config: unknown): string | undefined {
  const raw = (config as unknown as { comment_checker?: { custom_prompt?: unknown } }).comment_checker
  if (!raw || typeof raw !== "object") return undefined
  const prompt = raw.custom_prompt
  return typeof prompt === "string" && prompt.trim().length > 0 ? prompt : undefined
}

setInterval(cleanupOldPendingCalls, 10_000)

export const CommentCheckerPlugin: Plugin = async () => {
  startBackgroundInit()
  cliPathPromise = getCommentCheckerPath()
  cliPathPromise.then(path => {
    debugLog("CLI path resolved:", path || "disabled (no binary)")
  }).catch(err => {
    debugLog("CLI path resolution error:", err)
  })

  return {
    config: async (config: unknown) => {
      customPrompt = resolveCustomPrompt(config)
    },
    "tool.execute.before": async (input: { tool: string; sessionID: string; callID: string }, output: { args: Record<string, unknown> }) => {
      const toolLower = input.tool.toLowerCase()
      if (!TOOL_NAMES.has(toolLower)) {
        return
      }

      const filePath = (output.args.filePath ?? output.args.file_path ?? output.args.path) as string | undefined
      const content = output.args.content as string | undefined
      const oldString = (output.args.oldString ?? output.args.old_string) as string | undefined
      const newString = (output.args.newString ?? output.args.new_string) as string | undefined
      const edits = output.args.edits as Array<{ old_string: string; new_string: string }> | undefined

      if (!filePath) {
        debugLog("no filePath found for tool:", toolLower)
        return
      }

      pendingCalls.set(input.callID, {
        filePath,
        content,
        oldString,
        newString,
        edits,
        tool: toolLower as "write" | "edit" | "multiedit",
        sessionID: input.sessionID,
        timestamp: Date.now(),
      })
    },
    "tool.execute.after": async (
      input: { tool: string; sessionID: string; callID: string },
      output: { title: string; output: string; metadata: unknown }
    ) => {
      const pendingCall = pendingCalls.get(input.callID)
      if (!pendingCall) {
        return
      }

      pendingCalls.delete(input.callID)

      const outputLower = output.output.toLowerCase()
      const isToolFailure = outputLower.startsWith("error")
        || OUTPUT_FAILURE_PATTERNS.some(pattern => outputLower.includes(pattern))

      if (isToolFailure) {
        debugLog("skipping due to tool failure in output")
        return
      }

      try {
        const cliPath = await cliPathPromise
        if (!cliPath || !existsSync(cliPath)) {
          debugLog("CLI not available, skipping comment check")
          return
        }

        const hookInput = {
          session_id: pendingCall.sessionID,
          tool_name: pendingCall.tool.charAt(0).toUpperCase() + pendingCall.tool.slice(1),
          transcript_path: "",
          cwd: process.cwd(),
          hook_event_name: COMMENT_CHECKER_EVENT,
          tool_input: {
            file_path: pendingCall.filePath,
            content: pendingCall.content,
            old_string: pendingCall.oldString,
            new_string: pendingCall.newString,
            edits: pendingCall.edits,
          },
        }

        const result = await runCommentChecker(hookInput, { prompt: customPrompt })
        if (result.hasComments && result.message) {
          output.output += `\n\n${result.message}`
        }
      } catch (err) {
        debugLog("tool.execute.after failed:", err)
      }
    },
  }
}

export default CommentCheckerPlugin
