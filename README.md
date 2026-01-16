# opencode-comments-plugin

Stop the comment slop.

OpenCode plugin that warns when new comments or docstrings are added.
It wraps the `comment-checker` CLI from `go-claude-code-comment-checker` and surfaces warnings in tool output.

## Credits

This plugin is derived from the comment-checker hook logic in `oh-my-opencode`.
Credit to [oh-my-opencode](https://github.com/code-yeongyu/oh-my-opencode) for the original hook integration.

## Install

### NPM/Bun

```bash
bun add opencode-comments-plugin
# or
npm install opencode-comments-plugin
```

### Local plugin

```bash
bun install
bun run build
```

Then point your OpenCode config at the built file:

```json
{
  "plugin": ["opencode-comments-plugin"]
}
```

## Configuration

You can override the CLI warning message using `comment_checker.custom_prompt`:

```json
{
  "comment_checker": {
    "custom_prompt": "DETECTED:\n{{comments}}\nFix it."
  }
}
```

## Behavior

- Runs on `Write`, `Edit`, and `MultiEdit` tool calls.
- If the CLI detects comments, it appends the warning message to tool output.
- If the CLI binary is missing, the plugin auto-downloads the correct release.

## Development

```bash
bun install
bun run build
bun run typecheck
```
