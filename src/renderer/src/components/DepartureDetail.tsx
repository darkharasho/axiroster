import type { DepartureDoc } from '../../../shared/departures'

export interface DepartureDetailProps {
  doc: DepartureDoc | null
  canEdit: boolean
  onSave: (doc: DepartureDoc) => Promise<void>
  onClose: () => void
}

export default function DepartureDetail({ onClose }: DepartureDetailProps): JSX.Element {
  return (
    <div className="axi-scrim flex items-center justify-center p-6" onClick={onClose}>
      <div className="ar-modal__sheet max-w-xl" onClick={(e) => e.stopPropagation()} />
    </div>
  )
}
