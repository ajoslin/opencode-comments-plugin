export interface PendingCall {
  filePath: string
  content?: string
  oldString?: string
  newString?: string
  edits?: Array<{ old_string: string; new_string: string }>
  tool: "write" | "edit" | "multiedit"
  sessionID: string
  timestamp: number
}

export interface HookInput {
  session_id: string
  tool_name: string
  transcript_path: string
  cwd: string
  hook_event_name: string
  tool_input: {
    file_path?: string
    content?: string
    old_string?: string
    new_string?: string
    edits?: Array<{ old_string: string; new_string: string }>
  }
  tool_response?: unknown
}

export interface CheckResult {
  hasComments: boolean
  message: string
}
