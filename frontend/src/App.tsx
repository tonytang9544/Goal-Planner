import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { PlanItemEditor } from './components/PlanItemEditor'
import type { HouseholdToday, PlanItem, User } from './types/planner'
import './App.css'

type PlannerView = 'month' | 'week' | 'day'
type AuthStatus = 'loading' | 'signed-out' | 'signed-in'

const weekdayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const refreshIntervalMs = 15_000

interface AuthResponse {
  user: User
  expiresAt: string
  householdTimeZone: string
}

async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: 'same-origin',
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  })
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: string } | null
    throw new Error(body?.error ?? `Request failed (${response.status})`)
  }
  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

function dateKey(date: Date): string {
  const year = date.getUTCFullYear()
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function dateFromKey(value: string): Date {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day))
}

function dateKeyInTimeZone(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone,
  }).formatToParts(date)
  const part = (type: string) => parts.find((entry) => entry.type === type)?.value
  const year = part('year')
  const month = part('month')
  const day = part('day')
  if (!year || !month || !day) throw new Error('Could not determine the date')
  return `${year}-${month}-${day}`
}

function addDays(date: Date, amount: number): Date {
  const result = new Date(date)
  result.setUTCDate(result.getUTCDate() + amount)
  return result
}

function startOfWeek(date: Date): Date {
  const offset = (date.getUTCDay() + 6) % 7
  return addDays(date, -offset)
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
  const [clock, setClock] = useState(() => new Date())
  const [items, setItems] = useState<PlanItem[]>([])
  const [user, setUser] = useState<User | null>(null)
  const [household, setHousehold] = useState<HouseholdToday | null>(null)
  const [householdTimeZone, setHouseholdTimeZone] = useState(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone,
  )
  const [authStatus, setAuthStatus] = useState<AuthStatus>('loading')
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login')
  const [username, setUsername] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const initialToday = dateKeyInTimeZone(clock, householdTimeZone)
  const [selectedDate, setSelectedDate] = useState(initialToday)
  const [view, setView] = useState<PlannerView>('month')
  const [isTvMode, setIsTvMode] = useState(false)
  const [editingItem, setEditingItem] = useState<PlanItem | null | undefined>(undefined)

  useEffect(() => {
    const timer = window.setInterval(() => setClock(new Date()), 60_000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    let active = true
    apiRequest<AuthResponse>('/api/session')
      .then((response) => {
        if (!active) return
        setUser(response.user)
        setHouseholdTimeZone(response.householdTimeZone)
        setSelectedDate(dateKeyInTimeZone(new Date(), response.householdTimeZone))
        setAuthStatus('signed-in')
      })
      .catch((requestError: unknown) => {
        if (!active) return
        if (requestError instanceof Error && requestError.message !== 'Sign in to continue') {
          setError(requestError.message)
        }
        setAuthStatus('signed-out')
      })
    return () => {
      active = false
    }
  }, [])

  const today = household?.date ?? dateKeyInTimeZone(clock, householdTimeZone)
  const selectedDateValue = dateFromKey(selectedDate)
  const monthStart = new Date(Date.UTC(selectedDateValue.getUTCFullYear(), selectedDateValue.getUTCMonth(), 1))
  const monthGridStart = startOfWeek(monthStart)
  const monthDays = Array.from({ length: 42 }, (_, index) => addDays(monthGridStart, index))
  const weekStart = startOfWeek(selectedDateValue)
  const weekDays = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index))
  const selectedItems = itemsForDate(items, selectedDate)
  const completedCount = selectedItems.filter((item) => item.completedAt).length
  const monthFormatter = new Intl.DateTimeFormat(undefined, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })
  const longDateFormatter = new Intl.DateTimeFormat(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  })
  const shortDateFormatter = new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })

  const refreshHousehold = useCallback(async () => {
    const summary = await apiRequest<HouseholdToday>('/api/household/today')
    setHousehold(summary)
    setHouseholdTimeZone(summary.timeZone)
  }, [])

  const refreshPlans = useCallback(async () => {
    const monthStart = dateFromKey(selectedDate)
    const gridStart = startOfWeek(
      new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth(), 1)),
    )
    const start = dateKey(gridStart)
    const end = dateKey(addDays(gridStart, 41))
    const result = await apiRequest<PlanItem[]>(
      `/api/plans?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`,
    )
    setItems(result)
  }, [selectedDate])

  useEffect(() => {
    if (authStatus !== 'signed-in') return
    let active = true
    const refresh = async () => {
      try {
        await Promise.all([refreshPlans(), refreshHousehold()])
        if (active) setError(null)
      } catch (requestError) {
        if (!active) return
        if (requestError instanceof Error && requestError.message === 'Sign in to continue') {
          setUser(null)
          setItems([])
          setHousehold(null)
          setAuthStatus('signed-out')
        } else {
          setError(requestError instanceof Error ? requestError.message : 'Could not refresh planner data')
        }
      }
    }
    void refresh()
    const timer = window.setInterval(() => void refresh(), refreshIntervalMs)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [authStatus, refreshPlans, refreshHousehold])

  async function submitAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    try {
      const response = await apiRequest<AuthResponse>(
        authMode === 'register' ? '/api/register' : '/api/login',
        {
          method: 'POST',
          body: JSON.stringify({
            username,
            password,
            ...(authMode === 'register' ? { displayName } : {}),
          }),
        },
      )
      setUser(response.user)
      setHouseholdTimeZone(response.householdTimeZone)
      setSelectedDate(dateKeyInTimeZone(new Date(), response.householdTimeZone))
      setAuthStatus('signed-in')
      setPassword('')
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not sign in')
    }
  }

  async function signOut() {
    try {
      await apiRequest<void>('/api/logout', { method: 'POST' })
      setUser(null)
      setItems([])
      setHousehold(null)
      setIsTvMode(false)
      setAuthStatus('signed-out')
      setError(null)
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not sign out')
    }
  }

  function navigatePeriod(direction: -1 | 1) {
    const nextDate = new Date(selectedDateValue)
    if (view === 'month') nextDate.setUTCMonth(nextDate.getUTCMonth() + direction, 1)
    else if (view === 'week') nextDate.setUTCDate(nextDate.getUTCDate() + direction * 7)
    else nextDate.setUTCDate(nextDate.getUTCDate() + direction)
    setSelectedDate(dateKey(nextDate))
  }

  function selectDate(date: Date, nextView: PlannerView = view) {
    setSelectedDate(dateKey(date))
    setView(nextView)
  }

  async function saveItem(values: Omit<PlanItem, 'id' | 'userId' | 'createdAt' | 'updatedAt' | 'position'>) {
    try {
      const saved = await apiRequest<PlanItem>(
        editingItem ? `/api/plans/${editingItem.id}` : '/api/plans',
        {
          method: editingItem ? 'PUT' : 'POST',
          body: JSON.stringify(values),
        },
      )
      setItems((current) => [...current.filter((item) => item.id !== saved.id), saved])
      setSelectedDate(saved.date)
      setEditingItem(undefined)
      setError(null)
      await refreshHousehold()
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not save plan')
    }
  }

  async function toggleCompletion(item: PlanItem) {
    try {
      const updated = await apiRequest<PlanItem>(`/api/plans/${item.id}/completion`, {
        method: 'PATCH',
        body: JSON.stringify({ completed: !item.completedAt }),
      })
      setItems((current) => current.map((candidate) => candidate.id === item.id ? updated : candidate))
      await refreshHousehold()
      setError(null)
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not update completion')
    }
  }

  async function deleteItem(item: PlanItem) {
    try {
      await apiRequest<void>(`/api/plans/${item.id}`, { method: 'DELETE' })
      setItems((current) => current.filter((candidate) => candidate.id !== item.id))
      await refreshHousehold()
      setError(null)
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not delete plan')
    }
  }

  async function reorderItem(item: PlanItem, direction: -1 | 1) {
    const dayItems = itemsForDate(items, item.date)
    const index = dayItems.findIndex((candidate) => candidate.id === item.id)
    const targetIndex = Math.max(0, Math.min(index + direction, dayItems.length - 1))
    if (index === targetIndex) return
    const reordered = [...dayItems]
    const [moved] = reordered.splice(index, 1)
    reordered.splice(targetIndex, 0, moved)
    try {
      await apiRequest<void>('/api/plans/order', {
        method: 'PUT',
        body: JSON.stringify({ date: item.date, itemIds: reordered.map((candidate) => candidate.id) }),
      })
      setItems((current) => current.map((candidate) => {
        const position = reordered.findIndex((ordered) => ordered.id === candidate.id)
        return position < 0 ? candidate : { ...candidate, position }
      }))
      setError(null)
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not reorder plans')
    }
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

  if (authStatus === 'loading') {
    return <main className="auth-shell" aria-live="polite">Loading your planner…</main>
  }

  if (authStatus === 'signed-out') {
    return (
      <main className="auth-shell">
        <section className="auth-card" aria-labelledby="auth-title">
          <a className="brand auth-brand" href="/" aria-label="Home planner">
            <span className="brand-mark" aria-hidden="true">h</span>
            <span className="brand-copy">
              <span className="brand-name">Home planner</span>
              <span className="brand-tagline">A little progress goes a long way.</span>
            </span>
          </a>
          <p className="eyebrow">{authMode === 'register' ? 'START YOUR HOUSEHOLD PLANNER' : 'WELCOME BACK'}</p>
          <h1 id="auth-title">{authMode === 'register' ? 'Create your account' : 'Sign in'}</h1>
          <p className="auth-description">
            Your plans are private to your account. The shared TV view displays daily target titles and progress.
          </p>
          {error && <p className="error-banner" role="alert">{error}</p>}
          <form className="auth-form" onSubmit={submitAuth}>
            {authMode === 'register' && (
              <label className="form-field">
                <span>Your name</span>
                <input
                  autoComplete="name"
                  required
                  maxLength={60}
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                />
              </label>
            )}
            <label className="form-field">
              <span>Username</span>
              <input
                autoComplete="username"
                required
                minLength={3}
                maxLength={32}
                pattern="[A-Za-z0-9_\\-]+"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
              />
            </label>
            <label className="form-field">
              <span>Password</span>
              <input
                autoComplete={authMode === 'register' ? 'new-password' : 'current-password'}
                required
                minLength={12}
                maxLength={128}
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
              {authMode === 'register' && <small className="field-hint">Use at least 12 characters.</small>}
            </label>
            <button className="button button-primary auth-submit" type="submit">
              {authMode === 'register' ? 'Create account' : 'Sign in'}
            </button>
          </form>
          <p className="auth-switch">
            {authMode === 'register' ? 'Already have an account?' : 'New to this household planner?'}
            {' '}
            <button
              type="button"
              onClick={() => {
                setAuthMode((mode) => mode === 'login' ? 'register' : 'login')
                setError(null)
              }}
            >
              {authMode === 'register' ? 'Sign in' : 'Create an account'}
            </button>
          </p>
          <p className="local-network-note">Account creation is open to devices that can reach this home-network app.</p>
        </section>
      </main>
    )
  }

  return (
    <main className={`app-shell${isTvMode ? ' tv-mode' : ''}`}>
      {error && <p className="error-banner app-error" role="alert">{error}</p>}
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
            <div className="profile-chip" aria-label={`Signed in as ${user?.displayName ?? ''}`}>
              <span className="avatar" aria-hidden="true">{user?.displayName.slice(0, 1).toUpperCase()}</span>
              <span className="profile-name">{user?.displayName}<small>@{user?.username}</small></span>
            </div>
          )}
          {!isTvMode && <button className="button button-quiet sign-out-button" type="button" onClick={() => void signOut()}>Sign out</button>}
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
            {(household?.users ?? []).map((member) => {
              const progress = member.targets.length
                ? Math.round((member.completed / member.targets.length) * 100)
                : 0
              return (
                <article className="tv-user-card" key={member.user.id} aria-labelledby={`tv-user-${member.user.id}`}>
                  <header className="tv-user-header">
                    <span className="avatar avatar-large" aria-hidden="true">{member.user.displayName.slice(0, 1).toUpperCase()}</span>
                    <div className="tv-user-identity">
                      <h2 id={`tv-user-${member.user.id}`}>{member.user.displayName}</h2>
                      <span>
                        {member.targets.length
                          ? `${member.completed} of ${member.targets.length} targets complete`
                          : 'No targets today'}
                      </span>
                    </div>
                    <strong className="tv-percentage">{progress}%</strong>
                  </header>
                  <div
                    className="progress-track"
                    role="progressbar"
                    aria-label={`${member.user.displayName}'s targets completed today`}
                    aria-valuenow={progress}
                    aria-valuemin={0}
                    aria-valuemax={100}
                  >
                    <span style={{ width: `${progress}%` }} />
                  </div>

                  <div className="streak-grid" aria-label={`${member.user.displayName}'s streaks through yesterday`}>
                    <div className="streak-tile">
                      <span className="streak-icon" aria-hidden="true">✦</span>
                      <div>
                        <strong>{member.allTargetsStreak} <small>{member.allTargetsStreak === 1 ? 'day' : 'days'}</small></strong>
                        <span>All targets cleared</span>
                      </div>
                    </div>
                    <div className="streak-tile">
                      <span className="streak-icon streak-icon-soft" aria-hidden="true">↗</span>
                      <div>
                        <strong>{member.atLeastOneStreak} <small>{member.atLeastOneStreak === 1 ? 'day' : 'days'}</small></strong>
                        <span>At least one done</span>
                      </div>
                    </div>
                  </div>

                  <div className="tv-target-list">
                    <h3>Today's targets</h3>
                    {member.targets.length ? member.targets.map((item) => (
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
                      const dayItems = itemsForDate(items, key)
                      const isOutsideMonth = date.getUTCMonth() !== selectedDateValue.getUTCMonth()
                      return (
                        <button
                          className={`month-day${isOutsideMonth ? ' outside-month' : ''}${key === today ? ' is-today' : ''}${key === selectedDate ? ' is-selected' : ''}`}
                          key={key}
                          type="button"
                          aria-label={`${longDateFormatter.format(date)}, ${dayItems.length} plans`}
                          aria-pressed={key === selectedDate}
                          onClick={() => selectDate(date, 'day')}
                        >
                          <span className="month-day-number">{date.getUTCDate()}</span>
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
