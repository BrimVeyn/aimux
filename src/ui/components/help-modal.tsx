import { theme } from '../theme'

const SECTIONS = [
  {
    title: 'Navigation',
    bindings: [
      ['j / k', 'Move between tabs'],
      ['Shift+J / K', 'Reorder tabs'],
      ['i', 'Focus terminal input'],
      ['?', 'Show this help'],
    ],
  },
  {
    title: 'Tabs & Sessions',
    bindings: [
      ['Ctrl+n', 'New tab'],
      ['Ctrl+w', 'Close tab'],
      ['Ctrl+r', 'Restart tab'],
      ['Ctrl+g', 'Session picker'],
    ],
  },
  {
    title: 'Layout',
    bindings: [
      ['Ctrl+b', 'Toggle sidebar'],
      ['Ctrl+h / l', 'Resize sidebar'],
    ],
  },
  {
    title: 'Terminal Input',
    bindings: [['Ctrl+z', 'Back to navigation']],
  },
  {
    title: 'General',
    bindings: [['Ctrl+c', 'Quit']],
  },
] as const

export function HelpModal() {
  return (
    <box
      position="absolute"
      top={0}
      left={0}
      width="100%"
      height="100%"
      justifyContent="center"
      alignItems="center"
    >
      <box
        width={50}
        border
        borderColor={theme.borderActive}
        padding={1}
        backgroundColor={theme.panel}
        flexDirection="column"
        gap={1}
      >
        <text fg={theme.accentAlt}>Keybindings</text>
        {SECTIONS.map((section) => (
          <box key={section.title} flexDirection="column">
            <text fg={theme.text}>{section.title}</text>
            {section.bindings.map(([key, desc]) => (
              <box key={key} flexDirection="row">
                <box width={18}>
                  <text fg={theme.accentAlt}> {key}</text>
                </box>
                <text fg={theme.textMuted}>{desc}</text>
              </box>
            ))}
          </box>
        ))}
        <text fg={theme.textMuted}>Press Esc to close</text>
      </box>
    </box>
  )
}
