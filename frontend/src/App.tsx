import { useEffect, useState } from 'react'
import { PlanItemEditor } from './components/PlanItemEditor'
import type { PlanItem } from './types/planner'
import './App.css'

type PlannerView = 'month' | 'week' | 'day'

const currentUserId = 'local-user'
const currentUserName = 'Alex Morgan'
const householdUsers = [
  { id: currentUserId, displayName: currentUserName, initials: 'A' },
  { id: 'user-jamie', displayName: 'Jamie Lee', initials: 'J' },
  { id: 'user-sam', displayName: 'Sam Patel', initials: 'S' },
]
const weekdayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const householdTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
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

function localTimeAt(date: Date, hour: number, minute: number): string {
  const value = new Date(date.getFullYear(), date.getMonth(), date.getDate(), hour, minute)
  return value.toISOString()
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

function createSeedItems(today: Date): PlanItem[] {
  const createdAt = today.toISOString()
  const history = [
    {
      userId: currentUserId,
      days: ['all', 'all', 'some', 'some', 'none', 'all', 'all'],
      titles: ['Water the plants', 'Stretch for ten minutes'],
    },
    {
      userId: 'user-jamie',
      days: ['some', 'all', 'some', 'all', 'some', 'none', 'all'],
      titles: ['Read a chapter', 'Take a lunch break'],
    },
    {
      userId: 'user-sam',
      days: ['all', 'empty', 'all', 'some', 'all', 'all', 'some'],
      titles: ['Morning walk', 'Practice guitar'],
    },
  ] as const

  const pastItems = history.flatMap(({ userId, days, titles }) =>
    days.flatMap((status, historyIndex) => {
      if (status === 'empty') return []
      const date = addDays(today, -(historyIndex + 1))
      const dayItems = status === 'all'
        ? titles.map(() => true)
        : status === 'some'
          ? [true, false]
          : [false, false]
      return titles.slice(0, dayItems.length).map((title, itemIndex) => ({
        id: `history-${userId}-${historyIndex}-${itemIndex}`,
        userId,
        date: dateKey(date),
        title,
        notes: null,
        dueAt: null,
        position: itemIndex,
        completedAt: dayItems[itemIndex] ? localTimeAt(date, 18, 0) : null,
        createdAt,
        updatedAt: createdAt,
      }))
    }),
  )

  const todayEntries = [
    { userId: currentUserId, title: 'Water the herbs', notes: 'The basil is looking thirsty.', hour: 9, minute: 0, completed: true },
    { userId: currentUserId, title: 'Pick up groceries', notes: 'Milk, oats, and fresh fruit.', hour: 17, minute: 30, completed: false },
    { userId: 'user-jamie', title: 'Finish the book chapter', notes: null, hour: 20, minute: 0, completed: false },
    { userId: 'user-jamie', title: 'Prepare lunch for tomorrow', notes: null, hour: 21, minute: 0, completed: true },
    { userId: 'user-sam', title: 'Take a walk after work', notes: null, hour: 18, minute: 0, completed: true },
    { userId: 'user-sam', title: 'Water the balcony plants', notes: null, hour: 19, minute: 0, completed: true },
  ]
  const todayItems = todayEntries.map((entry, index) => ({
    id: `today-plan-${index + 1}`,
    userId: entry.userId,
    date: dateKey(today),
    title: entry.title,
    notes: entry.notes,
    dueAt: localTimeAt(today, entry.hour, entry.minute),
    position: todayEntries.filter((item) => item.userId === entry.userId).findIndex((item) => item === entry),
    completedAt: entry.completed ? localTimeAt(today, Math.max(8, entry.hour - 1), entry.minute) : null,
    createdAt,
    updatedAt: createdAt,
  }))

  const alexFutureEntries = [
    { offset: 1, title: 'Go for an evening walk', notes: null },
    { offset: 3, title: 'Call Mum', notes: 'Ask how the garden is doing.' },
    { offset: 5, title: 'Tidy the entryway', notes: null },
  ].map((entry, index) => ({
    id: `future-plan-${index + 1}`,
    userId: currentUserId,
    date: dateKey(addDays(today, entry.offset)),
    title: entry.title,
    notes: entry.notes,
    dueAt: null,
    position: index,
    completedAt: null,
    createdAt,
    updatedAt: createdAt,
  }))

  return [...pastItems, ...todayItems, ...alexFutureEntries]
}

function itemsForDate(items: PlanItem[], date: string): PlanItem[] {
  return items
    .filter((item) => item.date === date)
    .sort((a, b) => a.position - b.position || a.createdAt.localeCompare(b.createdAt))
}

function streakLength(items: PlanItem[], userId: string, today: string, predicate: (dayItems: PlanItem[]) => boolean): number {
  let streak = 0
  let date = addDays(dateFromKey(today), -1)

  while (true) {
    const dayItems = itemsForDate(items.filter((item) => item.userId === userId), dateKey(date))
    if (dayItems.length === 0 || !predicate(dayItems)) return streak
    streak += 1
    date = addDays(date, -1)
  }
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
  const [clock, setClock] = useState(() => new Date())
  const [items, setItems] = useState(() => createSeedItems(clock))
  const initialToday = dateKey(clock)
  const [selectedDate, setSelectedDate] = useState(initialToday)
  const [view, setView] = useState<PlannerView>('month')
  const [isTvMode, setIsTvMode] = useState(false)
  const [editingItem, setEditingItem] = useState<PlanItem | null | undefined>(undefined)

  useEffect(() => {
    const timer = window.setInterval(() => setClock(new Date()), 60_000)
    return () => window.clearInterval(timer)
  }, [])

  const today = dateKey(clock)
  const selectedDateValue = dateFromKey(selectedDate)
  const monthStart = new Date(selectedDateValue.getFullYear(), selectedDateValue.getMonth(), 1)
  const monthGridStart = startOfWeek(monthStart)
  const monthDays = Array.from({ length: 42 }, (_, index) => addDays(monthGridStart, index))
  const weekStart = startOfWeek(selectedDateValue)
  const weekDays = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index))
  const personalItems = items.filter((item) => item.userId === currentUserId)
  const selectedItems = itemsForDate(personalItems, selectedDate)
  const completedCount = selectedItems.filter((item) => item.completedAt).length
  const householdProgress = householdUsers.map((user) => {
    const targets = itemsForDate(items.filter((item) => item.userId === user.id), today)
    const completed = targets.filter((item) => item.completedAt).length
    return {
      ...user,
      targets,
      completed,
      allTargetsStreak: streakLength(
        items,
        user.id,
        today,
        (dayItems) => dayItems.every((item) => item.completedAt !== null),
      ),
      atLeastOneStreak: streakLength(
        items,
        user.id,
        today,
        (dayItems) => dayItems.some((item) => item.completedAt !== null),
      ),
    }
  })

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
        (item) => item.userId === currentUserId && item.date === values.date && item.id !== existing?.id,
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
        if (item.userId === currentUserId && item.date === existing?.date && item.id !== updatedItem.id) {
          const remaining = itemsForDate(
            current.filter((other) => other.userId === currentUserId && other.date === existing.date && other.id !== existing.id),
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
          candidate.userId === item.userId && candidate.date === item.date
            ? {
                ...candidate,
                position: itemsForDate(
                  current.filter((other) => other.userId === item.userId && other.date === item.date && other.id !== item.id),
                  item.date,
                ).findIndex((other) => other.id === candidate.id),
              }
            : candidate,
        ),
    )
  }

  function reorderItem(item: PlanItem, direction: -1 | 1) {
    setItems((current) => {
      const dayItems = itemsForDate(
        current.filter((candidate) => candidate.userId === item.userId),
        item.date,
      )
      const index = dayItems.findIndex((candidate) => candidate.id === item.id)
      const targetIndex = Math.max(0, Math.min(index + direction, dayItems.length - 1))
      if (index === targetIndex) return current
      const reordered = [...dayItems]
      const [moved] = reordered.splice(index, 1)
      reordered.splice(targetIndex, 0, moved)
      const positions = new Map(reordered.map((candidate, position) => [candidate.id, position]))
      return current.map((candidate) =>
        candidate.userId === item.userId && positions.has(candidate.id)
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
        <div className="header-brand-date">
          <a className="brand" href="/" aria-label="Home planner">
            <span className="brand-mark" aria-hidden="true">h</span>
            <span className="brand-copy">
              <span className="brand-name">Home planner</span>
              {isTvMode && <span className="brand-tagline">A little progress goes a long way.</span>}
            </span>
          </a>
          {isTvMode && (
            <h1 className="tv-date" id="tv-title" aria-live="polite">
              {longDateFormatter.format(dateFromKey(today))}
            </h1>
          )}
        </div>
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
          <div className="tv-household-grid">
            {householdProgress.map((user) => {
              const progress = user.targets.length
                ? Math.round((user.completed / user.targets.length) * 100)
                : 0
              return (
                <article className="tv-user-card" key={user.id} aria-labelledby={`tv-user-${user.id}`}>
                  <header className="tv-user-header">
                    <span className="avatar avatar-large" aria-hidden="true">{user.initials}</span>
                    <div className="tv-user-identity">
                      <h2 id={`tv-user-${user.id}`}>{user.displayName}</h2>
                      <span>
                        {user.targets.length
                          ? `${user.completed} of ${user.targets.length} targets complete`
                          : 'No targets today'}
                      </span>
                    </div>
                    <strong className="tv-percentage">{progress}%</strong>
                  </header>
                  <div
                    className="progress-track"
                    role="progressbar"
                    aria-label={`${user.displayName}'s targets completed today`}
                    aria-valuenow={progress}
                    aria-valuemin={0}
                    aria-valuemax={100}
                  >
                    <span style={{ width: `${progress}%` }} />
                  </div>

                  <div className="streak-grid" aria-label={`${user.displayName}'s streaks through yesterday`}>
                    <div className="streak-tile">
                      <span className="streak-icon" aria-hidden="true">✦</span>
                      <div>
                        <strong>{user.allTargetsStreak} <small>{user.allTargetsStreak === 1 ? 'day' : 'days'}</small></strong>
                        <span>All targets cleared</span>
                      </div>
                    </div>
                    <div className="streak-tile">
                      <span className="streak-icon streak-icon-soft" aria-hidden="true">↗</span>
                      <div>
                        <strong>{user.atLeastOneStreak} <small>{user.atLeastOneStreak === 1 ? 'day' : 'days'}</small></strong>
                        <span>At least one done</span>
                      </div>
                    </div>
                  </div>

                  <div className="tv-target-list">
                    <h3>Today's targets</h3>
                    {user.targets.length ? user.targets.map((item) => (
                      <div className={`tv-plan-row${item.completedAt ? ' is-completed' : ''}`} key={item.id}>
                        <span className="tv-check" aria-hidden="true">{item.completedAt ? '✓' : ''}</span>
                        <span className="tv-target-title">{item.title}</span>
                        {item.dueAt && (
                          <time dateTime={item.dueAt}>
                            {new Intl.DateTimeFormat(undefined, {
                              hour: 'numeric',
                              minute: '2-digit',
                              timeZone: householdTimeZone,
                            }).format(new Date(item.dueAt))}
                          </time>
                        )}
                      </div>
                    )) : (
                      <p className="empty-state">No targets today. This is not counted as a completed day.</p>
                    )}
                  </div>
                </article>
              )
            })}
          </div>
          <p className="tv-streak-rule">
            Streaks are counted through yesterday in the household timezone. Only days with at least one target count;
            a no-target day breaks both streaks.
          </p>
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
                      const dayItems = itemsForDate(personalItems, key)
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
                    const dayItems = itemsForDate(personalItems, key)
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
