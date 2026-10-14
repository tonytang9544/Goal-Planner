import { useState } from 'react'
import { PlanItemEditor } from './components/PlanItemEditor'
import type { PlanItem } from './types/planner'
import './App.css'

type PlannerView = 'month' | 'week' | 'day'

const currentUserId = 'local-user'
const currentUserName = 'Alex Morgan'
const weekdayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const monthFormatter = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' })
const longDateFormatter = new Intl.DateTimeFormat(undefined, {
  weekday: 'long',
  month: 'long',
  day: 'numeric',
})
const shortDateFormatter = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
})

function dateKey(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function currentTimestamp(): string {
  return new Date().toISOString()
}

function dateFromKey(value: string): Date {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, month - 1, day)
}

function addDays(date: Date, amount: number): Date {
  const result = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  result.setDate(result.getDate() + amount)
  return result
}

function startOfWeek(date: Date): Date {
  const offset = (date.getDay() + 6) % 7
  return addDays(date, -offset)
}

function createSeedItems(): PlanItem[] {
  const now = new Date()
  const createdAt = now.toISOString()
  const entries = [
    { offset: -1, title: 'Take out the recycling', notes: 'Glass and cardboard too.' , completed: true },
    { offset: 0, title: 'Water the herbs', notes: 'The basil is looking thirsty.', completed: true },
    { offset: 0, title: 'Pick up groceries', notes: 'Milk, oats, and fresh fruit.', completed: false },
    { offset: 1, title: 'Go for an evening walk', notes: null, completed: false },
    { offset: 3, title: 'Call Mum', notes: 'Ask how the garden is doing.', completed: false },
    { offset: 5, title: 'Tidy the entryway', notes: null, completed: false },
  ]

  return entries.map((entry, index) => ({
    id: `sample-plan-${index + 1}`,
    userId: currentUserId,
    date: dateKey(addDays(now, entry.offset)),
    title: entry.title,
    notes: entry.notes,
    dueAt: null,
    position: index,
    completedAt: entry.completed ? createdAt : null,
    createdAt,
    updatedAt: createdAt,
  }))
}

function itemsForDate(items: PlanItem[], date: string): PlanItem[] {
  return items
    .filter((item) => item.date === date)
    .sort((a, b) => a.position - b.position || a.createdAt.localeCompare(b.createdAt))
}

function PlannerItem({
  item,
  onEdit,
  onToggle,
  onDelete,
  onReorder,
}: {
  item: PlanItem
  onEdit: () => void
  onToggle: () => void
  onDelete: () => void
  onReorder: (direction: -1 | 1) => void
}) {
  return (
    <article className={`plan-item${item.completedAt ? ' is-completed' : ''}`}>
      <button
        className="completion-toggle"
        type="button"
        aria-label={`${item.completedAt ? 'Mark incomplete' : 'Mark complete'}: ${item.title}`}
        aria-pressed={Boolean(item.completedAt)}
        onClick={onToggle}
      >
        {item.completedAt && <span aria-hidden="true">✓</span>}
      </button>
      <button className="plan-item-main" type="button" onClick={onEdit}>
        <span className="plan-item-title">{item.title}</span>
        {item.notes && <span className="plan-item-notes">{item.notes}</span>}
        {item.dueAt && (
          <time className="plan-item-time" dateTime={item.dueAt}>
            {new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(
              new Date(item.dueAt),
            )}
          </time>
        )}
      </button>
      <div className="item-controls">
        <button type="button" aria-label={`Move ${item.title} earlier`} onClick={() => onReorder(-1)}>
          ↑
        </button>
        <button type="button" aria-label={`Move ${item.title} later`} onClick={() => onReorder(1)}>
          ↓
        </button>
        <button type="button" aria-label={`Delete ${item.title}`} onClick={onDelete}>
          ×
        </button>
      </div>
    </article>
  )
}

function App() {
  const [today] = useState(() => dateKey(new Date()))
  const [items, setItems] = useState(createSeedItems)
  const [selectedDate, setSelectedDate] = useState(today)
  const [view, setView] = useState<PlannerView>('month')
  const [isTvMode, setIsTvMode] = useState(false)
  const [editingItem, setEditingItem] = useState<PlanItem | null | undefined>(undefined)

  const selectedDateValue = dateFromKey(selectedDate)
  const monthStart = new Date(selectedDateValue.getFullYear(), selectedDateValue.getMonth(), 1)
  const monthGridStart = startOfWeek(monthStart)
  const monthDays = Array.from({ length: 42 }, (_, index) => addDays(monthGridStart, index))
  const weekStart = startOfWeek(selectedDateValue)
  const weekDays = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index))
  const selectedItems = itemsForDate(items, selectedDate)
  const completedCount = selectedItems.filter((item) => item.completedAt).length
  const todayItems = itemsForDate(items, today)
  const todayCompletedCount = todayItems.filter((item) => item.completedAt).length

  function navigatePeriod(direction: -1 | 1) {
    const nextDate = new Date(selectedDateValue)
    if (view === 'month') nextDate.setMonth(nextDate.getMonth() + direction, 1)
    else if (view === 'week') nextDate.setDate(nextDate.getDate() + direction * 7)
    else nextDate.setDate(nextDate.getDate() + direction)
    setSelectedDate(dateKey(nextDate))
  }

  function selectDate(date: Date, nextView: PlannerView = view) {
    setSelectedDate(dateKey(date))
    setView(nextView)
  }

  function saveItem(values: Omit<PlanItem, 'id' | 'userId' | 'createdAt' | 'updatedAt' | 'position'>) {
    const now = currentTimestamp()
    setItems((current) => {
      const existing = editingItem
        ? current.find((item) => item.id === editingItem.id)
        : undefined
      const destinationItems = current.filter(
        (item) => item.date === values.date && item.id !== existing?.id,
      )
      const updatedItem: PlanItem = {
        ...values,
        id: existing?.id ?? `plan-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        userId: currentUserId,
        position: existing?.date === values.date ? existing.position : destinationItems.length,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      }
      return [
        ...current.filter((item) => item.id !== existing?.id),
        updatedItem,
      ].map((item) => {
        if (item.date === existing?.date && item.id !== updatedItem.id) {
          const remaining = itemsForDate(
            current.filter((other) => other.date === existing.date && other.id !== existing.id),
            existing.date,
          )
          const oldPosition = remaining.findIndex((other) => other.id === item.id)
          return { ...item, position: oldPosition }
        }
        return item
      })
    })
    setSelectedDate(values.date)
    setEditingItem(undefined)
  }

  function toggleCompletion(item: PlanItem) {
    const now = currentTimestamp()
    setItems((current) =>
      current.map((candidate) =>
        candidate.id === item.id
          ? { ...candidate, completedAt: candidate.completedAt ? null : now, updatedAt: now }
          : candidate,
      ),
    )
  }

  function deleteItem(item: PlanItem) {
    setItems((current) =>
      current
        .filter((candidate) => candidate.id !== item.id)
        .map((candidate) =>
          candidate.date === item.date
            ? {
                ...candidate,
                position: itemsForDate(
                  current.filter((other) => other.date === item.date && other.id !== item.id),
                  item.date,
                ).findIndex((other) => other.id === candidate.id),
              }
            : candidate,
        ),
    )
  }

  function reorderItem(item: PlanItem, direction: -1 | 1) {
    setItems((current) => {
      const dayItems = itemsForDate(current, item.date)
      const index = dayItems.findIndex((candidate) => candidate.id === item.id)
      const targetIndex = Math.max(0, Math.min(index + direction, dayItems.length - 1))
      if (index === targetIndex) return current
      const reordered = [...dayItems]
      const [moved] = reordered.splice(index, 1)
      reordered.splice(targetIndex, 0, moved)
      const positions = new Map(reordered.map((candidate, position) => [candidate.id, position]))
      return current.map((candidate) =>
        positions.has(candidate.id)
          ? { ...candidate, position: positions.get(candidate.id)! }
          : candidate,
      )
    })
  }

  function openNewItem(date = selectedDate) {
    setSelectedDate(date)
    setEditingItem(null)
  }

  const rangeLabel =
    view === 'month'
      ? monthFormatter.format(selectedDateValue)
      : view === 'week'
        ? `${shortDateFormatter.format(weekStart)} – ${shortDateFormatter.format(weekDays[6])}`
        : longDateFormatter.format(selectedDateValue)

  return (
    <main className={`app-shell${isTvMode ? ' tv-mode' : ''}`}>
      <header className="app-header">
        <a className="brand" href="/" aria-label="Home planner">
          <span className="brand-mark" aria-hidden="true">h</span>
          <span className="brand-name">Home planner</span>
        </a>
        <div className="header-actions">
          {!isTvMode && (
            <div className="profile-chip" aria-label={`Signed in as ${currentUserName}`}>
              <span className="avatar" aria-hidden="true">A</span>
              <span className="profile-name">{currentUserName}<small>Preview profile</small></span>
            </div>
          )}
          <button
            className="button button-quiet tv-toggle"
            type="button"
            aria-pressed={isTvMode}
            onClick={() => setIsTvMode((enabled) => !enabled)}
          >
            {isTvMode ? 'Exit TV view' : 'TV view'}
          </button>
        </div>
      </header>

      {isTvMode ? (
        <section className="tv-summary" aria-labelledby="tv-title">
          <p className="eyebrow">HOUSEHOLD TODAY</p>
          <h1 id="tv-title">{longDateFormatter.format(dateFromKey(today))}</h1>
          <p className="tv-greeting">A little progress goes a long way. <span>Preview profile</span></p>
          <div className="tv-progress">
            <div className="tv-progress-copy">
              <span className="avatar avatar-large" aria-hidden="true">A</span>
              <div>
                <strong>{currentUserName}</strong>
                <span>{todayCompletedCount} of {todayItems.length} plans complete</span>
              </div>
            </div>
            <div
              className="progress-track"
              role="progressbar"
              aria-label={`${currentUserName}'s plans completed today`}
              aria-valuenow={todayItems.length ? Math.round(todayCompletedCount / todayItems.length * 100) : 0}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <span
                style={{
                  width: `${todayItems.length ? (todayCompletedCount / todayItems.length) * 100 : 0}%`,
                }}
              />
            </div>
          </div>
          <div className="tv-today-list">
            {todayItems.length ? todayItems.map((item) => (
              <div className={`tv-plan-row${item.completedAt ? ' is-completed' : ''}`} key={item.id}>
                <span className="tv-check" aria-hidden="true">{item.completedAt ? '✓' : ''}</span>
                <span>{item.title}</span>
              </div>
            )) : (
              <p className="empty-state">No plans for today. Enjoy the open space.</p>
            )}
          </div>
        </section>
      ) : (
        <>
          <section className="planner-heading" aria-labelledby="planner-title">
            <div>
              <p className="eyebrow">MAKE SPACE FOR WHAT MATTERS</p>
              <h1 id="planner-title">My planner</h1>
              <p className="planner-subtitle">A calmer way to plan the days ahead.</p>
            </div>
            <button className="button button-primary add-plan-button" type="button" onClick={() => openNewItem()}>
              <span aria-hidden="true">+</span> Add a plan
            </button>
          </section>

          <section className="planner-panel" aria-label="Personal planner">
            <div className="planner-toolbar">
              <div className="period-navigation">
                <button className="nav-button" type="button" aria-label="Previous period" onClick={() => navigatePeriod(-1)}>
                  ‹
                </button>
                <h2 aria-live="polite">{rangeLabel}</h2>
                <button className="nav-button" type="button" aria-label="Next period" onClick={() => navigatePeriod(1)}>
                  ›
                </button>
                <button
                  className="today-button"
                  type="button"
                  onClick={() => selectDate(dateFromKey(today))}
                >
                  Today
                </button>
              </div>
              <div className="view-switcher" role="group" aria-label="Planner view">
                {(['month', 'week', 'day'] as const).map((option) => (
                  <button
                    key={option}
                    type="button"
                    aria-pressed={view === option}
                    onClick={() => setView(option)}
                  >
                    {option[0].toUpperCase() + option.slice(1)}
                  </button>
                ))}
              </div>
            </div>

            <div id="planner-view">
              {view === 'month' && (
                <div className="month-calendar" aria-label={`${rangeLabel} calendar`}>
                  <div className="weekday-row" aria-hidden="true">
                    {weekdayNames.map((name) => <span key={name}>{name.slice(0, 3)}</span>)}
                  </div>
                  <div className="month-grid">
                    {monthDays.map((date) => {
                      const key = dateKey(date)
                      const dayItems = itemsForDate(items, key)
                      const isOutsideMonth = date.getMonth() !== selectedDateValue.getMonth()
                      return (
                        <button
                          className={`month-day${isOutsideMonth ? ' outside-month' : ''}${key === today ? ' is-today' : ''}${key === selectedDate ? ' is-selected' : ''}`}
                          key={key}
                          type="button"
                          aria-label={`${longDateFormatter.format(date)}, ${dayItems.length} plans`}
                          aria-pressed={key === selectedDate}
                          onClick={() => selectDate(date, 'day')}
                        >
                          <span className="month-day-number">{date.getDate()}</span>
                          {dayItems.length > 0 && (
                            <span className="month-day-summary">
                              <span className="day-dot" aria-hidden="true" />
                              <span>{dayItems.length} {dayItems.length === 1 ? 'plan' : 'plans'}</span>
                            </span>
                          )}
                          <span className="month-day-items">
                            {dayItems.slice(0, 2).map((item) => (
                              <span className={`month-item${item.completedAt ? ' is-completed' : ''}`} key={item.id}>
                                {item.title}
                              </span>
                            ))}
                            {dayItems.length > 2 && <span className="more-items">+{dayItems.length - 2} more</span>}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}

              {view === 'week' && (
                <div className="week-planner">
                  {weekDays.map((date) => {
                    const key = dateKey(date)
                    const dayItems = itemsForDate(items, key)
                    return (
                      <section className={`week-day${key === today ? ' is-today' : ''}`} key={key}>
                        <button className="week-day-heading" type="button" onClick={() => selectDate(date, 'day')}>
                          <span>{shortDateFormatter.format(date)}</span>
                          {key === today && <span className="today-tag">Today</span>}
                        </button>
                        <div className="week-day-items">
                          {dayItems.length ? dayItems.map((item) => (
                            <button
                              className={`week-plan${item.completedAt ? ' is-completed' : ''}`}
                              type="button"
                              key={item.id}
                              onClick={() => setEditingItem(item)}
                            >
                              <span className="week-plan-dot" aria-hidden="true" />
                              {item.title}
                            </button>
                          )) : <span className="week-empty">No plans</span>}
                        </div>
                        <button className="week-add" type="button" onClick={() => openNewItem(key)}>
                          + Add plan
                        </button>
                      </section>
                    )
                  })}
                </div>
              )}

              {view === 'day' && (
                <section className="day-planner" aria-labelledby="selected-day-title">
                  <header className="day-heading">
                    <div>
                      <p className="eyebrow">{selectedDate === today ? 'TODAY' : 'YOUR DAY'}</p>
                      <h3 id="selected-day-title">{longDateFormatter.format(selectedDateValue)}</h3>
                      <p className="day-progress">
                        {completedCount} of {selectedItems.length} {selectedItems.length === 1 ? 'plan' : 'plans'} completed
                      </p>
                    </div>
                    <button className="button button-primary" type="button" onClick={() => openNewItem(selectedDate)}>
                      <span aria-hidden="true">+</span> Add plan
                    </button>
                  </header>
                  <div className="day-plan-list">
                    {selectedItems.length ? selectedItems.map((item) => (
                      <PlannerItem
                        key={item.id}
                        item={item}
                        onEdit={() => setEditingItem(item)}
                        onToggle={() => toggleCompletion(item)}
                        onDelete={() => deleteItem(item)}
                        onReorder={(direction) => reorderItem(item, direction)}
                      />
                    )) : (
                      <div className="empty-day">
                        <span className="empty-day-icon" aria-hidden="true">✳</span>
                        <h4>A little room to breathe</h4>
                        <p>Nothing planned for this day yet. Add something when you are ready.</p>
                        <button className="button button-quiet" type="button" onClick={() => openNewItem(selectedDate)}>
                          Add your first plan
                        </button>
                      </div>
                    )}
                  </div>
                </section>
              )}
            </div>
          </section>
          <p className="privacy-note"><span aria-hidden="true">◈</span> Your plans are personal. Only your progress totals are intended for the household chart.</p>
        </>
      )}

      {editingItem !== undefined && (
        <PlanItemEditor
          key={editingItem?.id ?? `new-${selectedDate}`}
          item={editingItem}
          initialDate={selectedDate}
          onSave={saveItem}
          onClose={() => setEditingItem(undefined)}
        />
      )}
    </main>
  )
}

export default App
