/**
 * parseSlashCommand — pure function, zero side effects.
 *
 * Rules:
 *   /command [args...]  → { command: 'command', args: 'args...' }
 *   \/escaped           → null  (literal text, not a command)
 *   plain text          → null
 *   empty string        → null
 *
 * The \/ escape allows users to type a literal forward-slash message:
 *   \/help              sends the text "/help" to the model as plain text.
 */
export function parseSlashCommand(input: string): { command: string; args: string } | null {
  if (!input) return null

  // \/ escape: leading backslash before slash → not a command.
  if (input.startsWith('\\/')) return null

  if (!input.startsWith('/')) return null

  // Strip the leading slash.
  const rest = input.slice(1)

  // A bare '/' with nothing after it is not a command.
  if (!rest.trim()) return null

  const spaceIdx = rest.indexOf(' ')
  if (spaceIdx === -1) {
    return { command: rest.trim(), args: '' }
  }

  const command = rest.slice(0, spaceIdx).trim()
  const args = rest.slice(spaceIdx + 1).trimStart()

  if (!command) return null
  return { command, args }
}
