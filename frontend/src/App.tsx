import { useState, type DragEvent } from 'react'
import { CardEditor } from './components/CardEditor'
import type { Board, BoardColumn, Card, Label } from './types/board'
import './App.css'

const initialBoard: Board = {
  id: 'home-board',
  name: 'Home projects',
  labels: [
    {
      id: 'label-home',
      boardId: 'home-board',
      name: 'Home',
      color: '#dff3e9',
      createdAt: '2026-10-14T00:00:00.000Z',
      updatedAt: '2026-10-14T00:00:00.000Z',
    },
    {
      id: 'label-shopping',
      boardId: 'home-board',
      name: 'Shopping',
      color: '#fff0d4',
      createdAt: '2026-10-14T00:00:00.000Z',
      updatedAt: '2026-10-14T00:00:00.000Z',
    },
    {
      id: 'label-weekend',
      boardId: 'home-board',
      name: 'Weekend',
      color: '#e9e4ff',
      createdAt: '2026-10-14T00:00:00.000Z',
      updatedAt: '2026-10-14T00:00:00.000Z',
    },
  ],
  columns: [
    {
      id: 'column-ideas',
      boardId: 'home-board',
      name: 'Ideas',
      position: 0,
      createdAt: '2026-10-14T00:00:00.000Z',
      updatedAt: '2026-10-14T00:00:00.000Z',
      cards: [
        {
          id: 'card-pantry',
          columnId: 'column-ideas',
          title: 'Reorganize the pantry',
          description: 'Make a list of shelves and storage boxes first.',
          labelIds: ['label-home'],
          position: 0,
          isCompleted: false,
          dueAt: null,
          createdAt: '2026-10-14T00:00:00.000Z',
          updatedAt: '2026-10-14T00:00:00.000Z',
        },
        {
          id: 'card-plants',
          columnId: 'column-ideas',
          title: 'Pick plants for the balcony',
          description: null,
          labelIds: ['label-weekend'],
          position: 1,
          isCompleted: false,
          dueAt: null,
          createdAt: '2026-10-14T00:00:00.000Z',
          updatedAt: '2026-10-14T00:00:00.000Z',
        },
      ],
    },
    {
      id: 'column-progress',
      boardId: 'home-board',
      name: 'In progress',
      position: 1,
      createdAt: '2026-10-14T00:00:00.000Z',
      updatedAt: '2026-10-14T00:00:00.000Z',
      cards: [
        {
          id: 'card-dinner',
          columnId: 'column-progress',
          title: 'Plan Friday dinner',
          description: 'Check with everyone before choosing a recipe.',
          labelIds: ['label-shopping'],
          position: 0,
          isCompleted: false,
          dueAt: '2026-10-16T18:00:00.000Z',
          createdAt: '2026-10-14T00:00:00.000Z',
          updatedAt: '2026-10-14T00:00:00.000Z',
        },
      ],
    },
    {
      id: 'column-done',
      boardId: 'home-board',
      name: 'Done',
      position: 2,
      createdAt: '2026-10-14T00:00:00.000Z',
      updatedAt: '2026-10-14T00:00:00.000Z',
      cards: [
        {
          id: 'card-movie',
          columnId: 'column-done',
          title: 'Choose a movie for movie night',
          description: null,
          labelIds: ['label-weekend'],
          position: 0,
          isCompleted: true,
          dueAt: null,
          createdAt: '2026-10-14T00:00:00.000Z',
          updatedAt: '2026-10-14T00:00:00.000Z',
        },
      ],
    },
  ],
  createdAt: '2026-10-14T00:00:00.000Z',
  updatedAt: '2026-10-14T00:00:00.000Z',
}

function reindexCards(cards: Card[], columnId: string): Card[] {
  return cards.map((card, position) => ({ ...card, columnId, position }))
}

function BoardCard({
  card,
  labels,
  columns,
  onEdit,
  onDelete,
  onMove,
  onReorder,
  onDrop,
  onDragStart,
}: {
  card: Card
  labels: Label[]
  columns: BoardColumn[]
  onEdit: () => void
  onDelete: () => void
  onMove: (columnId: string) => void
  onReorder: (direction: -1 | 1) => void
  onDrop: (event: DragEvent<HTMLElement>) => void
  onDragStart: (event: DragEvent<HTMLElement>) => void
}) {
  const cardLabels = labels.filter((label) => card.labelIds.includes(label.id))
  const dueDate = card.dueAt
    ? new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(
        new Date(card.dueAt),
      )
    : null

  return (
    <article
      className={`board-card${card.isCompleted ? ' is-completed' : ''}`}
      draggable
      onDragStart={onDragStart}
      onDragOver={(event) => event.preventDefault()}
      onDrop={onDrop}
    >
      <div className="card-topline">
        <div className="label-list">
          {cardLabels.map((label) => (
            <span
              className="label-chip"
              key={label.id}
              style={{ backgroundColor: label.color }}
            >
              {label.name}
            </span>
          ))}
        </div>
        <button
          className="icon-button card-edit"
          type="button"
          aria-label={`Edit ${card.title}`}
          onClick={onEdit}
        >
          <span aria-hidden="true">···</span>
        </button>
      </div>
      <h3 className="card-title">{card.title}</h3>
      {card.description && <p className="card-description">{card.description}</p>}
      <div className="card-footer">
        {dueDate ? (
          <span className="due-date">
            <span aria-hidden="true">◷</span> {dueDate}
          </span>
        ) : (
          <span />
        )}
        <button
          className="delete-button"
          type="button"
          onClick={onDelete}
          aria-label={`Delete ${card.title}`}
        >
          Delete
        </button>
      </div>
      <div className="card-accessible-controls">
        <label>
          <span className="sr-only">Move {card.title} to column</span>
          <select
            value={card.columnId}
            onChange={(event) => onMove(event.target.value)}
          >
            {columns.map((column) => (
              <option key={column.id} value={column.id}>
                Move to {column.name}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={() => onReorder(-1)}
          aria-label={`Move ${card.title} earlier`}
        >
          Earlier
        </button>
        <button
          type="button"
          onClick={() => onReorder(1)}
          aria-label={`Move ${card.title} later`}
        >
          Later
        </button>
      </div>
    </article>
  )
}

function App() {
  const [board, setBoard] = useState(initialBoard)
  const [editingCard, setEditingCard] = useState<Card | null | undefined>(undefined)
  const [editingColumnId, setEditingColumnId] = useState<string | null>(null)
  const [tvMode, setTvMode] = useState(false)
  const [draggedCardId, setDraggedCardId] = useState<string | null>(null)

  function saveCard(values: Omit<Card, 'id' | 'createdAt' | 'updatedAt' | 'position'>) {
    const now = new Date().toISOString()
    setBoard((current) => {
      const columns = current.columns.map((column) => ({
        ...column,
        cards: column.cards.filter((card) => card.id !== editingCard?.id),
      }))
      const targetColumn = columns.find((column) => column.id === values.columnId)
      if (!targetColumn) return current

      const existingCard = editingCard
        ? current.columns.flatMap((column) => column.cards).find((card) => card.id === editingCard.id)
        : undefined
      const card: Card = {
        ...values,
        id: existingCard?.id ?? `card-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        position: targetColumn.cards.length,
        createdAt: existingCard?.createdAt ?? now,
        updatedAt: now,
      }
      targetColumn.cards = [...targetColumn.cards, card]

      return {
        ...current,
        columns: columns.map((column) => ({
          ...column,
          cards: reindexCards(column.cards, column.id),
        })),
        updatedAt: now,
      }
    })
    setEditingCard(undefined)
    setEditingColumnId(null)
  }

  function deleteCard(cardId: string) {
    setBoard((current) => ({
      ...current,
      columns: current.columns.map((column) => ({
        ...column,
        cards: reindexCards(
          column.cards.filter((card) => card.id !== cardId),
          column.id,
        ),
      })),
      updatedAt: new Date().toISOString(),
    }))
  }

  function moveCard(cardId: string, targetColumnId: string, targetIndex?: number) {
    setBoard((current) => {
      const sourceColumn = current.columns.find((column) =>
        column.cards.some((card) => card.id === cardId),
      )
      const targetColumn = current.columns.find((column) => column.id === targetColumnId)
      const card = sourceColumn?.cards.find((item) => item.id === cardId)
      if (!sourceColumn || !targetColumn || !card) return current

      const columns = current.columns.map((column) => ({
        ...column,
        cards: [...column.cards],
      }))
      const source = columns.find((column) => column.id === sourceColumn.id)!
      const target = columns.find((column) => column.id === targetColumnId)!
      source.cards = source.cards.filter((item) => item.id !== cardId)
      const insertionIndex = Math.max(
        0,
        Math.min(targetIndex ?? target.cards.length, target.cards.length),
      )
      target.cards.splice(insertionIndex, 0, {
        ...card,
        columnId: targetColumnId,
        isCompleted: target.name.toLowerCase() === 'done' ? true : card.isCompleted,
        updatedAt: new Date().toISOString(),
      })

      return {
        ...current,
        columns: columns.map((column) => ({
          ...column,
          cards: reindexCards(column.cards, column.id),
        })),
        updatedAt: new Date().toISOString(),
      }
    })
  }

  function reorderCard(cardId: string, direction: -1 | 1) {
    const column = board.columns.find((item) =>
      item.cards.some((card) => card.id === cardId),
    )
    const cardIndex = column?.cards.findIndex((card) => card.id === cardId) ?? -1
    if (!column || cardIndex < 0) return
    const targetIndex = Math.max(0, Math.min(cardIndex + direction, column.cards.length - 1))
    moveCard(cardId, column.id, targetIndex)
  }

  function beginDrag(event: DragEvent<HTMLElement>, cardId: string) {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', cardId)
    setDraggedCardId(cardId)
  }

  function dropOnCard(event: DragEvent<HTMLElement>, columnId: string, targetCardId: string) {
    event.preventDefault()
    event.stopPropagation()
    const cardId = event.dataTransfer.getData('text/plain') || draggedCardId
    if (!cardId || cardId === targetCardId) return
    const targetColumn = board.columns.find((column) => column.id === columnId)
    const targetIndex = targetColumn?.cards.findIndex((card) => card.id === targetCardId)
    const sourceColumn = board.columns.find((column) =>
      column.cards.some((card) => card.id === cardId),
    )
    const sourceIndex = sourceColumn?.cards.findIndex((card) => card.id === cardId)
    const insertionIndex =
      sourceColumn?.id === columnId &&
      sourceIndex !== undefined &&
      targetIndex !== undefined &&
      sourceIndex < targetIndex
        ? targetIndex - 1
        : targetIndex
    moveCard(cardId, columnId, insertionIndex)
    setDraggedCardId(null)
  }

  function dropOnColumn(event: DragEvent<HTMLElement>, columnId: string) {
    event.preventDefault()
    const cardId = event.dataTransfer.getData('text/plain') || draggedCardId
    if (cardId) moveCard(cardId, columnId)
    setDraggedCardId(null)
  }

  return (
    <main className={`app-shell${tvMode ? ' tv-mode' : ''}`}>
      <header className="app-header">
        <a className="brand" href="/" aria-label="Jira TV home">
          <span className="brand-mark" aria-hidden="true">JT</span>
          <span className="brand-name">Jira TV</span>
        </a>
        <div className="header-actions">
          <span className="connection-status">
            <span className="status-dot" aria-hidden="true" />
            Home board
          </span>
          <button
            className="button button-quiet tv-toggle"
            type="button"
            aria-pressed={tvMode}
            onClick={() => setTvMode((mode) => !mode)}
          >
            {tvMode ? 'Exit TV view' : 'TV view'}
          </button>
        </div>
      </header>

      <section className="board-heading" aria-labelledby="board-title">
        <div>
          <p className="eyebrow">SHARED HOUSEHOLD BOARD</p>
          <h1 id="board-title">{board.name}</h1>
          <p className="board-subtitle">Small plans, shared progress.</p>
        </div>
        <button
          className="button button-primary add-card-top"
          type="button"
          onClick={() => {
            setEditingColumnId(board.columns[0]?.id ?? null)
            setEditingCard(null)
          }}
        >
          <span aria-hidden="true">+</span> Add a card
        </button>
      </section>

      <section className="board" aria-label={`${board.name} board`}>
        {board.columns.map((column) => (
          <section
            className="board-column"
            key={column.id}
            aria-labelledby={`${column.id}-heading`}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => dropOnColumn(event, column.id)}
          >
            <header className="column-header">
              <div className="column-title-wrap">
                <span className={`column-indicator indicator-${column.position}`} aria-hidden="true" />
                <h2 id={`${column.id}-heading`}>{column.name}</h2>
                <span className="card-count">{column.cards.length}</span>
              </div>
              <button
                className="icon-button column-add"
                type="button"
                aria-label={`Add a card to ${column.name}`}
                onClick={() => {
                  setEditingColumnId(column.id)
                  setEditingCard(null)
                }}
              >
                +
              </button>
            </header>
            <div className="column-cards">
              {column.cards.map((card) => (
                <BoardCard
                  key={card.id}
                  card={card}
                  labels={board.labels}
                  columns={board.columns}
                  onEdit={() => {
                    setEditingColumnId(column.id)
                    setEditingCard(card)
                  }}
                  onDelete={() => deleteCard(card.id)}
                  onMove={(targetColumnId) => moveCard(card.id, targetColumnId)}
                  onReorder={(direction) => reorderCard(card.id, direction)}
                  onDrop={(event) => dropOnCard(event, column.id, card.id)}
                  onDragStart={(event) => beginDrag(event, card.id)}
                />
              ))}
              <button
                className="add-card-button"
                type="button"
                onClick={() => {
                  setEditingColumnId(column.id)
                  setEditingCard(null)
                }}
              >
                <span aria-hidden="true">+</span> Add a card
              </button>
            </div>
          </section>
        ))}
      </section>

      {editingCard !== undefined && editingColumnId && (
        <CardEditor
          key={editingCard?.id ?? `new-${editingColumnId}`}
          card={editingCard}
          initialColumnId={editingColumnId}
          columns={board.columns}
          labels={board.labels}
          onSave={saveCard}
          onClose={() => {
            setEditingCard(undefined)
            setEditingColumnId(null)
          }}
        />
      )}
    </main>
  )
}

export default App
