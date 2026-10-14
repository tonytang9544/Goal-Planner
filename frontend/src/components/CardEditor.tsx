import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { BoardColumn, Card, Label } from '../types/board'

interface CardEditorProps {
  card: Card | null | undefined
  initialColumnId: string
  columns: BoardColumn[]
  labels: Label[]
  onSave: (card: Omit<Card, 'id' | 'createdAt' | 'updatedAt' | 'position'>) => void
  onClose: () => void
}

function toLocalDateTime(value: string | null | undefined): string {
  if (!value) return ''
  const date = new Date(value)
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 16)
}

export function CardEditor({
  card,
  initialColumnId,
  columns,
  labels,
  onSave,
  onClose,
}: CardEditorProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [title, setTitle] = useState(card?.title ?? '')
  const [description, setDescription] = useState(card?.description ?? '')
  const [columnId, setColumnId] = useState(card?.columnId ?? initialColumnId)
  const [dueAt, setDueAt] = useState(toLocalDateTime(card?.dueAt))
  const [isCompleted, setIsCompleted] = useState(card?.isCompleted ?? false)
  const [labelIds, setLabelIds] = useState<string[]>(card?.labelIds ?? [])

  useEffect(() => {
    dialogRef.current?.showModal()
  }, [])

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const parsedDueDate = dueAt ? new Date(dueAt) : null
    onSave({
      columnId,
      title: title.trim(),
      description: description.trim() || null,
      labelIds,
      isCompleted,
      dueAt: parsedDueDate?.toISOString() ?? null,
    })
  }

  return (
    <dialog
      className="card-dialog"
      ref={dialogRef}
      aria-labelledby="card-dialog-title"
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
      onClose={onClose}
    >
      <form className="card-form" onSubmit={submit}>
        <header className="dialog-header">
          <div>
            <p className="eyebrow">{card ? 'UPDATE THE BOARD' : 'ADD TO THE BOARD'}</p>
            <h2 id="card-dialog-title">{card ? 'Edit card' : 'New card'}</h2>
          </div>
          <button className="icon-button" type="button" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </header>

        <label className="form-field">
          <span>Title</span>
          <input
            autoFocus
            required
            maxLength={120}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="What needs doing?"
          />
        </label>

        <label className="form-field">
          <span>Description <span className="optional-label">Optional</span></span>
          <textarea
            rows={3}
            maxLength={1000}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Add a few helpful details"
          />
        </label>

        <div className="form-row">
          <label className="form-field">
            <span>Column</span>
            <select value={columnId} onChange={(event) => setColumnId(event.target.value)}>
              {columns.map((column) => (
                <option key={column.id} value={column.id}>{column.name}</option>
              ))}
            </select>
          </label>
          <label className="form-field">
            <span>Due date <span className="optional-label">Optional</span></span>
            <input
              type="datetime-local"
              value={dueAt}
              onChange={(event) => setDueAt(event.target.value)}
            />
          </label>
        </div>

        <fieldset className="label-fieldset">
          <legend>Labels</legend>
          <div className="label-options">
            {labels.map((label) => (
              <label className="label-option" key={label.id}>
                <input
                  type="checkbox"
                  checked={labelIds.includes(label.id)}
                  onChange={(event) => {
                    setLabelIds((current) =>
                      event.target.checked
                        ? [...current, label.id]
                        : current.filter((id) => id !== label.id),
                    )
                  }}
                />
                <span className="label-chip" style={{ backgroundColor: label.color }}>
                  {label.name}
                </span>
              </label>
            ))}
          </div>
        </fieldset>

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
            {card ? 'Save changes' : 'Add card'}
          </button>
        </footer>
      </form>
    </dialog>
  )
}
