/**
 * CodexLauncher — stub launcher.
 *
 * Step 0 CLI probe could not confirm parseable session ID in codex stdout
 * (OpenAI API returned 500 during probe). Active dispatch is deferred to
 * td-8a0d20 pending a successful probe.
 */
export class CodexLauncher {
  async launch(_directory: string, _prompt: string, _model?: string): Promise<never> {
    throw new Error('Codex dispatch not yet supported — see td-8a0d20')
  }

  dispose(): void {}
}

export const codexLauncher = new CodexLauncher()
