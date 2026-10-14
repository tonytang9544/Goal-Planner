import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { PlanItem } from '../types/planner'

interface PlanItemEditorProps {
  item: PlanItem | null | undefined
  initialDate: string
  onSave: (item: Omit<PlanItem, 'id' | 'userId' | 'createdAt' | 'updatedAt' | 'position'>) => void
  onClose: () => void
}

function timeValue(value: string | null | undefined): string {
  if (!value) return ''
  const date = new Date(value)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

export function PlanItemEditor({ item, initialDate, onSave, onClose }: PlanItemEditorProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [title, setTitle] = useState(item?.title ?? '')
  const [notes, setNotes] = useState(item?.notes ?? '')
  const [date, setDate] = useState(item?.date ?? initialDate)
  const [time, setTime] = useState(timeValue(item?.dueAt))
  const [isCompleted, setIsCompleted] = useState(Boolean(item?.completedAt))

  useEffect(() => {
    dialogRef.current?.showModal()
  }, [])

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const dueAt = time ? new Date(`${date}T${time}`).toISOString() : null
    onSave({
      date,
      title: title.trim(),
      notes: notes.trim() || null,
      dueAt,
      completedAt: isCompleted ? item?.completedAt ?? new Date().toISOString() : null,
    })
  }

  return (
    <dialog
      className="plan-dialog"
      ref={dialogRef}
      aria-labelledby="plan-dialog-title"
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
      onClose={onClose}
    >
      <form className="plan-form" onSubmit={submit}>
        <header className="dialog-header">
          <div>
            <p className="eyebrow">{item ? 'MAKE A SMALL ADJUSTMENT' : 'MAKE A PLAN'}</p>
            <h2 id="plan-dialog-title">{item ? 'Edit plan' : 'New plan'}</h2>
          </div>
          <button className="close-button" type="button" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </header>

        <label className="form-field">
          <span>What would you like to do?</span>
          <input
            autoFocus
            required
            maxLength={120}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="A small, clear intention"
          />
        </label>

        <label className="form-field">
          <span>Notes <span className="optional-label">Optional</span></span>
          <textarea
            rows={3}
            maxLength={1000}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="Anything that will help you follow through"
          />
        </label>

        <div className="form-row">
          <label className="form-field">
            <span>Day</span>
            <input required type="date" value={date} onChange={(event) => setDate(event.target.value)} />
          </label>
          <label className="form-field">
            <span>Time <span className="optional-label">Optional</span></span>
            <input type="time" value={time} onChange={(event) => setTime(event.target.value)} />
          </label>
        </div>

        <label className="completed-option">
          <input
            type="checkbox"
            checked={isCompleted}
            onChange={(event) => setIsCompleted(event.target.checked)}
          />
          <span>Mark as completed</span>
        </label>

        <footer className="dialog-actions">
          <button className="button button-quiet" type="button" onClick={onClose}>Cancel</button>
          <button className="button button-primary" type="submit">
            {item ? 'Save plan' : 'Add plan'}
          </button>
        </footer>
      </form>
    </dialog>
  )
}
