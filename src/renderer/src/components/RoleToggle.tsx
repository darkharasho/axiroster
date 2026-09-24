export type ToggleRole = 'read' | 'write'

/** Compact read/write control — two pills, because "which of these is on" is
 *  exactly what a pressed pill says and it needs no extra form step. */
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
    <div className="inline-flex gap-1">
      {(['read', 'write'] as ToggleRole[]).map((r) => (
        <button
          key={r}
          type="button"
          disabled={disabled}
          aria-pressed={value === r}
          onClick={() => value !== r && onChange(r)}
          className="axi-pill"
        >
          {r}
        </button>
      ))}
    </div>
  )
}
