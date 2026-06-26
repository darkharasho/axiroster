export type ToggleRole = 'read' | 'write'

/** Compact read/write segmented control — replaces the role <select>. */
export function RoleToggle({
  value,
  onChange,
  disabled
}: {
  value: ToggleRole
  onChange: (role: ToggleRole) => void
  disabled?: boolean
}): JSX.Element {
  return (
    <div className="inline-flex gap-0.5 rounded-md border border-panel-line bg-panel-sunk p-0.5">
      {(['read', 'write'] as ToggleRole[]).map((r) => (
        <button
          key={r}
          type="button"
          disabled={disabled}
          onClick={() => value !== r && onChange(r)}
          className={`rounded px-3 py-0.5 text-xs font-semibold transition-colors disabled:opacity-50 ${
            value === r
              ? 'bg-accent-soft text-black'
              : 'text-ink-faint hover:text-ink'
          }`}
        >
          {r}
        </button>
      ))}
    </div>
  )
}
