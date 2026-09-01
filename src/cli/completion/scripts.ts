/**
 * Shell completion scripts.
 *
 * They are deliberately THIN: collect the current words, shell out to
 * `aimux __complete`, render the reply. All real logic lives in TypeScript, so
 * upgrading aimux upgrades completion behaviour without regenerating anything
 * the user has installed.
 *
 * Reply protocol (`__complete` stdout):
 *   value<TAB>description   … zero or more candidate lines
 *   :list | :files | :none  … exactly one trailing directive line
 *
 * `:files` means "no candidates of ours — use your own filename completion".
 */

import { COMMANDS } from '../registry'

export type SupportedShell = 'bash' | 'fish' | 'zsh'

export const SUPPORTED_SHELLS: readonly SupportedShell[] = ['bash', 'fish', 'zsh']

export const DIRECTIVE_LIST = ':list'
export const DIRECTIVE_FILES = ':files'
export const DIRECTIVE_NONE = ':none'

export function isSupportedShell(value: string): value is SupportedShell {
  return SUPPORTED_SHELLS.includes(value as SupportedShell)
}

/** Long flags that take a path — fish needs these declared up front. */
function fileFlagNames(): string[] {
  const names = new Set<string>()
  for (const command of COMMANDS) {
    for (const flag of command.flags) {
      if (flag.complete?.kind === 'file') names.add(flag.name)
    }
  }
  return [...names].sort()
}

function bashScript(command: string): string {
  return `# aimux bash completion. Regenerate with: aimux completion bash
_aimux_complete() {
  local IFS=$'\\n'
  local directive="${DIRECTIVE_LIST}"
  local -a candidates=()
  local line

  while IFS= read -r line; do
    case "$line" in
      :*) directive="$line" ;;
      "") ;;
      *) candidates+=("\${line%%$'\\t'*}") ;;
    esac
  done < <(${command} __complete --no-descriptions --cword "$COMP_CWORD" -- "\${COMP_WORDS[@]}" 2>/dev/null)

  if [[ "$directive" == "${DIRECTIVE_FILES}" ]]; then
    # Let readline do filenames itself — it handles quoting and trailing slashes.
    compopt -o default 2>/dev/null
    COMPREPLY=()
    return 0
  fi

  compopt +o default 2>/dev/null
  if [[ "$directive" == "${DIRECTIVE_NONE}" ]]; then
    COMPREPLY=()
    return 0
  fi

  COMPREPLY=($(compgen -W "\${candidates[*]}" -- "\${COMP_WORDS[COMP_CWORD]}"))
}

complete -F _aimux_complete aimux
`
}

function zshScript(command: string): string {
  return `#compdef aimux
# aimux zsh completion. Regenerate with: aimux completion zsh

_aimux_complete() {
  local -a candidates
  local directive="${DIRECTIVE_LIST}"
  local line

  local -a reply_lines
  reply_lines=("\${(@f)$(${command} __complete --cword $((CURRENT - 1)) -- "\${words[@]}" 2>/dev/null)}")

  for line in "\${reply_lines[@]}"; do
    case "$line" in
      :*) directive="$line" ;;
      "") ;;
      # _describe takes "value:description"; the reply is tab separated.
      *) candidates+=("\${line/$'\\t'/:}") ;;
    esac
  done

  if [[ "$directive" == "${DIRECTIVE_FILES}" ]]; then
    _files
    return
  fi
  [[ "$directive" == "${DIRECTIVE_NONE}" ]] && return

  _describe -t aimux 'aimux' candidates
}

compdef _aimux_complete aimux
`
}

function fishScript(command: string): string {
  const fileFlags = fileFlagNames()
    .map((name) => `complete -c aimux -l ${name} -r -F`)
    .join('\n')
  return `# aimux fish completion. Regenerate with: aimux completion fish

function __aimux_complete
    # \`commandline -opc\` is every finished token (including "aimux"), so its
    # count IS the 0-based index of the token being typed. An empty current
    # token expands to nothing, which the resolver reads as "".
    set -l tokens (commandline -opc)
    set -l current (commandline -ct)
    ${command} __complete --cword (count $tokens) -- $tokens $current 2>/dev/null |
        string match --invert --regex '^:'
end

complete -c aimux -f -a '(__aimux_complete)'

# Flags that take a path get fish's own file completion.
${fileFlags}
`
}

/**
 * @param command How the script should invoke aimux. Override it in dev to
 * point at a checkout (e.g. `bun run /path/to/aimux/src/index.tsx`).
 */
export function renderCompletionScript(shell: SupportedShell, command = 'aimux'): string {
  switch (shell) {
    case 'bash':
      return bashScript(command)
    case 'fish':
      return fishScript(command)
    case 'zsh':
      return zshScript(command)
  }
}
