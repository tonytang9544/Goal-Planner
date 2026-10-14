import { useCallback, useEffect, useState, type CSSProperties, type FormEvent } from 'react'
import { PlanItemEditor } from './components/PlanItemEditor'
import type {
  HouseholdCompetition,
  HouseholdToday,
  PlanItem,
  User,
  YearlyGoal,
} from './types/planner'
import './App.css'

type PlannerView = 'month' | 'week' | 'day' | 'year'
type AuthStatus = 'loading' | 'signed-out' | 'signed-in'
type GoalDraft = { title: string; weekStarts: string[] }

function utcDate(year: number, month: number, day: number): Date {
  const date = new Date(0)
  date.setUTCFullYear(year, month, day)
  date.setUTCHours(0, 0, 0, 0)
  return date
}

interface GoalPayload {
  year: number
  title: string
  objectives: GoalDraft[]
}

interface ObjectiveDraft extends GoalDraft {
  key: string
}

function weeksForYear(year: number): Date[] {
  const firstWeek = startOfWeek(utcDate(year, 0, 1))
  const lastWeek = startOfWeek(utcDate(year, 11, 31))
  const weeks: Date[] = []
  for (let week = firstWeek; week <= lastWeek; week = addDays(week, 7)) {
    weeks.push(week)
  }
  return weeks
}

function weekOverlapsMonth(week: Date, year: number, month: number): boolean {
  const monthStart = utcDate(year, month, 1)
  const monthEnd = utcDate(year, month + 1, 0)
  const weekEnd = addDays(week, 6)
  return week <= monthEnd && weekEnd >= monthStart
}

function monthForWeekMap(week: Date, year: number): number {
  const thursday = addDays(week, 3)
  if (thursday.getUTCFullYear() < year) return 0
  if (thursday.getUTCFullYear() > year) return 11
  return thursday.getUTCMonth()
}

function dateRangeLabel(weekStart: string, formatter: Intl.DateTimeFormat): string {
  const start = dateFromKey(weekStart)
  return `${formatter.format(start)} – ${formatter.format(addDays(start, 6))}`
}

function objectiveDateRange(weekStarts: string[], formatter: Intl.DateTimeFormat): string {
  const sortedWeeks = [...weekStarts].sort()
  if (sortedWeeks.length === 0) return 'No weeks scheduled'
  const firstWeek = dateFromKey(sortedWeeks[0])
  const lastWeekEnd = addDays(dateFromKey(sortedWeeks[sortedWeeks.length - 1]), 6)
  return `${formatter.format(firstWeek)} – ${formatter.format(lastWeekEnd)}`
}

function objectiveColor(index: number): string {
  return `hsl(${(index * 137.508) % 360} 58% 43%)`
}

function YearlyGoalsList({
  goals,
  year,
  formatter,
  readOnly = true,
}: {
  goals: YearlyGoal[]
  year: number
  formatter: Intl.DateTimeFormat
  readOnly?: boolean
}) {
  const yearGoals = goals.filter((goal) => goal.year === year)
  return (
    <div className="yearly-goals-list">
      {yearGoals.length ? yearGoals.map((goal) => (
        <article className="yearly-goal-card" key={goal.id}>
          <header className="yearly-goal-header">
            <h2>{goal.title}</h2>
            {!readOnly && <span>{goal.objectives.length} objectives</span>}
          </header>
          <ol className="yearly-objective-list">
            {goal.objectives.map((objective) => (
              <li key={objective.id}>
                <div>
                  <strong>{objective.title}</strong>
                  <span>{objectiveDateRange(objective.weekStarts, formatter)}</span>
                </div>
              </li>
            ))}
          </ol>
        </article>
      )) : (
        <p className="yearly-goals-empty">No goals for {year} yet. Use the goal wizard to add one.</p>
      )}
    </div>
  )
}

function GoalWizardPage({
  initialYear,
  goals,
  onSave,
  onDelete,
}: {
  initialYear: number
  goals: YearlyGoal[]
  onSave: (goalId: string | null, payload: GoalPayload) => Promise<void>
  onDelete: (goalId: string) => Promise<void>
}) {
  const [action, setAction] = useState<'choose' | 'add' | 'edit' | 'edit-form' | 'remove' | 'saved'>('choose')
  const [year, setYear] = useState(initialYear)
  const [goalId, setGoalId] = useState('')
  const [title, setTitle] = useState('')
  const [objectives, setObjectives] = useState<ObjectiveDraft[]>([])
  const [activeObjective, setActiveObjective] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const mapYear = Number.isInteger(year) && year >= 1 && year <= 9999 ? year : initialYear
  const weekDates = weeksForYear(mapYear)
  const weekdayFormatter = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' })

  function beginAdd() {
    setGoalId('')
    setTitle('')
    const firstObjective = { key: crypto.randomUUID(), title: '', weekStarts: [] }
    setObjectives([firstObjective])
    setActiveObjective(firstObjective.key)
    setYear(initialYear)
    setError(null)
    setAction('add')
  }

  function selectGoal(goal: YearlyGoal) {
    setGoalId(goal.id)
    setTitle(goal.title)
    setYear(goal.year)
    const nextObjectives = goal.objectives.map((objective) => ({
      key: objective.id,
      title: objective.title,
      weekStarts: [...objective.weekStarts],
    }))
    setObjectives(nextObjectives)
    setActiveObjective(nextObjectives[0]?.key ?? null)
    setError(null)
  }

  function addObjective() {
    const objective = { key: crypto.randomUUID(), title: '', weekStarts: [] }
    setObjectives((current) => [...current, objective])
    setActiveObjective(objective.key)
  }

  function updateObjective(key: string, update: (objective: ObjectiveDraft) => ObjectiveDraft) {
    setObjectives((current) => current.map((objective) => objective.key === key ? update(objective) : objective))
  }

  function toggleWeek(weekStart: string) {
    if (!activeObjective) return
    updateObjective(activeObjective, (objective) => ({
      ...objective,
      weekStarts: objective.weekStarts.includes(weekStart)
        ? objective.weekStarts.filter((week) => week !== weekStart)
        : [...objective.weekStarts, weekStart].sort(),
    }))
  }

  function toggleMonth(month: number) {
    if (!activeObjective) return
    const monthWeeks = weekDates
      .filter((week) => weekOverlapsMonth(week, mapYear, month))
      .map(dateKey)
    updateObjective(activeObjective, (objective) => {
      const allSelected = monthWeeks.every((week) => objective.weekStarts.includes(week))
      const weekSet = new Set(objective.weekStarts)
      for (const week of monthWeeks) {
        if (allSelected) weekSet.delete(week)
        else weekSet.add(week)
      }
      return { ...objective, weekStarts: [...weekSet].sort() }
    })
  }

  function moveObjective(key: string, offset: -1 | 1) {
    setObjectives((current) => {
      const index = current.findIndex((objective) => objective.key === key)
      const target = index + offset
      if (index < 0 || target < 0 || target >= current.length) return current
      const reordered = [...current]
      const [objective] = reordered.splice(index, 1)
      reordered.splice(target, 0, objective)
      return reordered
    })
  }

  async function submitGoal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    if (!Number.isInteger(year) || year < 1 || year > 9999) {
      setError('Enter a year between 1 and 9999.')
      return
    }
    if (objectives.length === 0 || objectives.some((objective) => !objective.title.trim())) {
      setError('Add at least one objective and give each objective a title.')
      return
    }
    setSaving(true)
    try {
      await onSave(goalId || null, {
        year,
        title,
        objectives: objectives.map(({ title: objectiveTitle, weekStarts }) => ({
          title: objectiveTitle,
          weekStarts,
        })),
      })
      setAction('saved')
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not save goal')
    } finally {
      setSaving(false)
    }
  }

  async function confirmDelete() {
    if (!goalId) return
    const selected = goals.find((goal) => goal.id === goalId)
    if (!selected || !window.confirm(`Permanently remove “${selected.title}” and all its objectives?`)) return
    setSaving(true)
    setError(null)
    try {
      await onDelete(goalId)
      setAction('saved')
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Could not remove goal')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="goal-wizard" aria-labelledby="goal-wizard-title">
      <a className="goal-back-link" href="/">← Back to planner</a>
      <p className="eyebrow">YEARLY PLANNING</p>
      <h1 id="goal-wizard-title">Goal wizard</h1>
      {action === 'choose' ? (
        <div className="wizard-choice">
          <h2>What would you like to do?</h2>
          <button className="button button-primary" type="button" onClick={beginAdd}>Add a goal</button>
          <button className="button button-quiet" type="button" onClick={() => { setAction('edit'); setError(null) }}>Modify an existing goal</button>
          <button className="button button-quiet button-danger" type="button" onClick={() => { setAction('remove'); setError(null) }}>Remove a goal</button>
        </div>
      ) : action === 'edit' || action === 'remove' ? (
        <div className="wizard-goal-selection">
          <h2>{action === 'edit' ? 'Choose a goal to modify' : 'Choose a goal to remove'}</h2>
          {goals.length ? goals.map((goal) => (
            <button
              className={`wizard-goal-option${goalId === goal.id ? ' is-selected' : ''}`}
              key={goal.id}
              type="button"
              aria-pressed={goalId === goal.id}
              onClick={() => selectGoal(goal)}
            >
              <strong>{goal.title}</strong><span>{goal.year} · {goal.objectives.length} objectives</span>
            </button>
          )) : <p>No existing goals are available.</p>}
          {error && <p className="error-banner" role="alert">{error}</p>}
          <div className="wizard-actions">
            <button className="button button-quiet" type="button" onClick={() => setAction('choose')}>Back</button>
            {action === 'edit' && goalId && (
              <button className="button button-primary" type="button" onClick={() => setAction('edit-form')}>Continue editing</button>
            )}
            {action === 'remove' && goalId && (
              <button className="button button-danger" type="button" disabled={saving} onClick={() => void confirmDelete()}>
                {saving ? 'Removing…' : 'Remove selected goal'}
              </button>
            )}
          </div>
        </div>
      ) : action === 'saved' ? (
        <div className="wizard-saved">
          <h2>Goals updated</h2>
          <p>Your yearly goals and planner objectives are saved.</p>
          <a className="button button-primary" href="/yearly-goals">View yearly goals</a>
        </div>
      ) : (
        <form className="goal-editor" onSubmit={(event) => void submitGoal(event)}>
          <label className="form-field">
            <span>Goal name</span>
            <input required maxLength={120} value={title} onChange={(event) => setTitle(event.target.value)} />
          </label>
          <label className="form-field goal-year-field">
            <span>Year</span>
            <input
              required
              type="number"
              min={1}
              max={9999}
              value={year}
              onChange={(event) => setYear(Number(event.target.value))}
            />
          </label>
          <div className="objective-editor">
            <div className="objective-editor-heading">
              <div>
                <h2>Ordered objectives</h2>
                <p>Choose an objective, then assign it to weeks below.</p>
              </div>
              <button className="button button-quiet" type="button" onClick={addObjective}>Add objective</button>
            </div>
            {objectives.map((objective, index) => (
              <div
                className={`objective-draft${activeObjective === objective.key ? ' is-active' : ''}`}
                key={objective.key}
                style={{ '--objective-color': objectiveColor(index) } as CSSProperties}
              >
                <button
                  className="objective-select"
                  type="button"
                  aria-pressed={activeObjective === objective.key}
                  onClick={() => setActiveObjective(objective.key)}
                >
                  {index + 1}
                </button>
                <input
                  aria-label={`Objective ${index + 1}`}
                  required
                  maxLength={160}
                  placeholder="Describe an objective"
                  value={objective.title}
                  onChange={(event) => updateObjective(objective.key, (current) => ({ ...current, title: event.target.value }))}
                />
                <button type="button" aria-label={`Move objective ${index + 1} up`} disabled={index === 0} onClick={() => moveObjective(objective.key, -1)}>↑</button>
                <button type="button" aria-label={`Move objective ${index + 1} down`} disabled={index === objectives.length - 1} onClick={() => moveObjective(objective.key, 1)}>↓</button>
                <button
                  type="button"
                  aria-label={`Remove objective ${index + 1}`}
                  onClick={() => {
                    setObjectives((current) => current.filter((item) => item.key !== objective.key))
                    if (activeObjective === objective.key) setActiveObjective(objectives.find((item) => item.key !== objective.key)?.key ?? null)
                  }}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
          <section className="year-map" aria-labelledby="year-map-title">
            <h2 id="year-map-title">Choose weeks for {activeObjective ? `objective ${objectives.findIndex((objective) => objective.key === activeObjective) + 1}` : 'an objective'}</h2>
            <p>Weeks start on Monday. Select a month to toggle all overlapping weeks, or refine the selection square by square.</p>
            <div className="year-map-content">
              {Array.from({ length: 12 }, (_, month) => {
                const monthWeeks = weekDates.filter((week) => monthForWeekMap(week, mapYear) === month)
                return (
                  <div className="year-map-month-row" key={month}>
                    <button
                      className="year-map-month"
                      type="button"
                      aria-label={`Toggle all weeks overlapping ${new Intl.DateTimeFormat(undefined, { month: 'long', timeZone: 'UTC' }).format(utcDate(year, month, 1))}`}
                      onClick={() => toggleMonth(month)}
                    >
                      {new Intl.DateTimeFormat(undefined, { month: 'short', timeZone: 'UTC' }).format(utcDate(year, month, 1))}
                    </button>
                    <div className="year-map-weeks">
                      {monthWeeks.map((week) => {
                        const key = dateKey(week)
                        const assignedObjectives = objectives
                          .map((objective, index) => ({ objective, index }))
                          .filter(({ objective }) => objective.weekStarts.includes(key))
                        const weekEnd = addDays(week, 6)
                        const crossesYear = week.getUTCFullYear() !== mapYear || weekEnd.getUTCFullYear() !== mapYear
                        const crossesMonth = week.getUTCMonth() !== weekEnd.getUTCMonth()
                        const activeAssignment = assignedObjectives.some(({ objective }) => objective.key === activeObjective)
                        const assignmentNames = assignedObjectives
                          .map(({ objective }) => objective.title || 'Untitled objective')
                          .join(', ')
                        return (
                          <button
                            className={`year-map-week${assignedObjectives.length ? ' is-assigned' : ''}${activeAssignment ? ' is-active-objective' : ''}${crossesYear ? ' crosses-year' : ''}${crossesMonth ? ' marks-month-boundary' : ''}`}
                            key={key}
                            type="button"
                            style={{
                              background: assignedObjectives.length
                                ? `linear-gradient(90deg, ${assignedObjectives.map(({ index }, colorIndex) => `${objectiveColor(index)} ${colorIndex * 100 / assignedObjectives.length}% ${(colorIndex + 1) * 100 / assignedObjectives.length}%`).join(', ')})`
                                : undefined,
                            }}
                            aria-label={`Week ${dateRangeLabel(key, weekdayFormatter)}${crossesYear ? ', overlaps another year' : ''}${assignmentNames ? `, assigned to ${assignmentNames}` : ', unassigned'}`}
                            aria-pressed={activeAssignment}
                            disabled={!activeObjective}
                            onClick={() => toggleWeek(key)}
                          >
                            <span>{weekDates.indexOf(week) + 1}</span>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
            <div className="year-map-legend">
              <span>Each square is one Monday-start week</span>
              <span className="year-map-year-boundary">Dashed outline overlaps another year</span>
            </div>
          </section>
          {error && <p className="error-banner" role="alert">{error}</p>}
          <div className="wizard-actions">
            <button className="button button-quiet" type="button" onClick={() => setAction('choose')}>Back</button>
            <button className="button button-primary" type="submit" disabled={saving}>
              {saving ? 'Saving…' : 'Save goal'}
            </button>
          </div>
        </form>
      )}
    </section>
  )
}

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
  return utcDate(year, month - 1, day)
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
  const isTvMode = window.location.pathname.replace(/\/+$/, '') === '/tv'
  const isAccountManagement = window.location.pathname.replace(/\/+$/, '') === '/accounts'
  const isYearlyGoalsPage = window.location.pathname.replace(/\/+$/, '') === '/yearly-goals'
  const isGoalWizardPage = window.location.pathname.replace(/\/+$/, '') === '/goal-wizard'
  const [clock, setClock] = useState(() => new Date())
  const [items, setItems] = useState<PlanItem[]>([])
  const [accounts, setAccounts] = useState<User[]>([])
  const [goals, setGoals] = useState<YearlyGoal[]>([])
  const [user, setUser] = useState<User | null>(null)
  const [household, setHousehold] = useState<HouseholdToday | null>(null)
  const [competition, setCompetition] = useState<HouseholdCompetition | null>(null)
  const [tvPage, setTvPage] = useState<'targets' | 'competition'>('targets')
  const [competitionPeriod, setCompetitionPeriod] = useState<'week' | 'month'>('week')
  const [householdTimeZone, setHouseholdTimeZone] = useState(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone,
  )
  const [authStatus, setAuthStatus] = useState<AuthStatus>(isTvMode ? 'signed-out' : 'loading')
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login')
  const [username, setUsername] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmNewPassword, setConfirmNewPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [deletingAccountId, setDeletingAccountId] = useState<string | null>(null)
  const [changingPassword, setChangingPassword] = useState(false)
  const initialToday = dateKeyInTimeZone(clock, householdTimeZone)
  const [selectedDate, setSelectedDate] = useState(initialToday)
  const [view, setView] = useState<PlannerView>('month')
  const [editingItem, setEditingItem] = useState<PlanItem | null | undefined>(undefined)

  useEffect(() => {
    const timer = window.setInterval(() => setClock(new Date()), 60_000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (isTvMode) return
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
  }, [isTvMode])

  const today = household?.date ?? dateKeyInTimeZone(clock, householdTimeZone)
  const selectedDateValue = dateFromKey(selectedDate)
  const selectedYear = selectedDateValue.getUTCFullYear()
  const monthStart = utcDate(selectedDateValue.getUTCFullYear(), selectedDateValue.getUTCMonth(), 1)
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

  const refreshCompetition = useCallback(async () => {
    const summary = await apiRequest<HouseholdCompetition>(
      `/api/household/competition?period=${competitionPeriod}`,
    )
    setCompetition(summary)
  }, [competitionPeriod])

  const refreshAccounts = useCallback(async () => {
    const result = await apiRequest<User[]>('/api/accounts')
    setAccounts(result)
  }, [])

  const refreshGoals = useCallback(async () => {
    const result = await apiRequest<YearlyGoal[]>('/api/goals')
    setGoals(result)
  }, [])

  const refreshPlans = useCallback(async () => {
    const monthStart = dateFromKey(selectedDate)
    const gridStart = startOfWeek(
      utcDate(monthStart.getUTCFullYear(), monthStart.getUTCMonth(), 1),
    )
    const start = dateKey(gridStart)
    const end = dateKey(addDays(gridStart, 41))
    const result = await apiRequest<PlanItem[]>(
      `/api/plans?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`,
    )
    setItems(result)
  }, [selectedDate])

  useEffect(() => {
    if (!isTvMode && authStatus !== 'signed-in') return
    let active = true
    const refresh = async () => {
      try {
        if (isTvMode) {
          await refreshHousehold()
          if (tvPage === 'competition') await refreshCompetition()
        } else if (isAccountManagement) {
          await refreshAccounts()
        } else if (isYearlyGoalsPage || isGoalWizardPage) {
          await refreshGoals()
        } else {
          await Promise.all([refreshPlans(), refreshHousehold(), refreshGoals()])
        }
        if (active) setError(null)
      } catch (requestError) {
        if (!active) return
        if (!isTvMode && requestError instanceof Error && requestError.message === 'Sign in to continue') {
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
  }, [
    authStatus,
    isAccountManagement,
    isGoalWizardPage,
    isTvMode,
    isYearlyGoalsPage,
    tvPage,
    refreshPlans,
    refreshHousehold,
    refreshAccounts,
    refreshCompetition,
    refreshGoals,
  ])

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
      setAuthStatus('signed-out')
      setError(null)
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not sign out')
    }
  }

  async function removeAccount(account: User) {
    if (!user || account.id === user.id) return
    if (!window.confirm(`Permanently delete ${account.displayName}'s account and all of their plans and history? This cannot be undone.`)) {
      return
    }
    setDeletingAccountId(account.id)
    setError(null)
    setNotice(null)
    try {
      await apiRequest<void>(`/api/accounts/${account.id}`, { method: 'DELETE' })
      setAccounts((current) => current.filter((candidate) => candidate.id !== account.id))
      setNotice(`${account.displayName}'s account and planner data were deleted.`)
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not remove account')
    } finally {
      setDeletingAccountId(null)
    }
  }

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setNotice(null)
    if (newPassword !== confirmNewPassword) {
      setError('New password and confirmation do not match')
      return
    }

    setChangingPassword(true)
    try {
      await apiRequest<void>('/api/account/password', {
        method: 'PUT',
        body: JSON.stringify({
          currentPassword,
          newPassword,
        }),
      })
      setCurrentPassword('')
      setNewPassword('')
      setConfirmNewPassword('')
      setNotice('Your password was changed. Other signed-in sessions have been signed out.')
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not change password')
    } finally {
      setChangingPassword(false)
    }
  }

  async function saveGoal(goalId: string | null, payload: GoalPayload) {
    const saved = await apiRequest<YearlyGoal>(
      goalId ? `/api/goals/${goalId}` : '/api/goals',
      {
        method: goalId ? 'PUT' : 'POST',
        body: JSON.stringify(payload),
      },
    )
    setGoals((current) => [...current.filter((goal) => goal.id !== saved.id), saved])
  }

  async function removeGoal(goalId: string) {
    await apiRequest<void>(`/api/goals/${goalId}`, { method: 'DELETE' })
    setGoals((current) => current.filter((goal) => goal.id !== goalId))
  }

  function navigatePeriod(direction: -1 | 1) {
    const nextDate = new Date(selectedDateValue)
    if (view === 'year') nextDate.setUTCFullYear(nextDate.getUTCFullYear() + direction, 1, 1)
    else if (view === 'month') nextDate.setUTCMonth(nextDate.getUTCMonth() + direction, 1)
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
    view === 'year'
      ? String(selectedYear)
      : view === 'month'
      ? monthFormatter.format(selectedDateValue)
      : view === 'week'
        ? `${shortDateFormatter.format(weekStart)} – ${shortDateFormatter.format(weekDays[6])}`
        : longDateFormatter.format(selectedDateValue)
  const rankedCompetitionUsers = [...(competition?.users ?? [])].sort((first, second) =>
    second.allTargetsStreak - first.allTargetsStreak
    || second.atLeastOneStreak - first.atLeastOneStreak
    || first.user.displayName.localeCompare(second.user.displayName),
  )
  const competitionRangeLabel = competition
    ? competition.period === 'week'
      ? `${shortDateFormatter.format(dateFromKey(competition.startDate))} – ${shortDateFormatter.format(dateFromKey(competition.endDate))}`
      : monthFormatter.format(dateFromKey(competition.startDate))
    : ''
  const monthEnd = utcDate(selectedYear, selectedDateValue.getUTCMonth() + 1, 0)
  const selectedWeekStart = dateKey(weekStart)
  const visibleObjectives = goals
    .filter((goal) => goal.year === selectedYear)
    .flatMap((goal) => goal.objectives
      .filter((objective) => objective.weekStarts.some((assignedWeek) => {
        const weekStartDate = dateFromKey(assignedWeek)
        if (view === 'week') return assignedWeek === selectedWeekStart
        const weekEnd = addDays(weekStartDate, 6)
        return weekStartDate <= monthEnd && weekEnd >= monthStart
      }))
      .map((objective) => ({ goal, objective })))

  if (!isTvMode && authStatus === 'loading') {
    return <main className="auth-shell" aria-live="polite">Loading your planner…</main>
  }

  if (!isTvMode && authStatus === 'signed-out') {
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
                pattern={'[A-Za-z0-9_\\-]+'}
                value={username}
                onChange={(event) => setUsername(event.target.value)}
              />
            </label>
            <label className="form-field">
              <span>Password</span>
              <input
                autoComplete={authMode === 'register' ? 'new-password' : 'current-password'}
                required
                minLength={4}
                maxLength={128}
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
              {authMode === 'register' && <small className="field-hint">Use at least 4 characters.</small>}
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
          {isTvMode ? (
            <span className="brand" aria-label="Home planner">
              <span className="brand-mark" aria-hidden="true">h</span>
              <span className="brand-copy">
                <span className="brand-name">Home planner</span>
                <span className="brand-tagline">A little progress goes a long way.</span>
              </span>
            </span>
          ) : (
            <a className="brand" href="/" aria-label="Home planner">
              <span className="brand-mark" aria-hidden="true">h</span>
              <span className="brand-copy">
                <span className="brand-name">Home planner</span>
              </span>
            </a>
          )}
          {isTvMode && (
            <h1 className="tv-date" id="tv-title" aria-live="polite">
              {longDateFormatter.format(dateFromKey(today))}
            </h1>
          )}
        </div>
        <div className="header-actions">
          {isTvMode && (
            <button
              className="button button-quiet tv-view-toggle"
              type="button"
              aria-label={`Show ${tvPage === 'targets' ? 'competition' : "today's targets"}`}
              onClick={() => setTvPage((page) => page === 'targets' ? 'competition' : 'targets')}
            >
              {tvPage === 'targets' ? 'Competition' : "Today's targets"}
            </button>
          )}
          {!isTvMode && (
            <div className="profile-chip" aria-label={`Signed in as ${user?.displayName ?? ''}`}>
              <span className="avatar" aria-hidden="true">{user?.displayName.slice(0, 1).toUpperCase()}</span>
              <span className="profile-name">{user?.displayName}<small>@{user?.username}</small></span>
            </div>
          )}
          {!isTvMode && (
            <a className="button button-quiet account-management-link" href="/accounts">
              Manage accounts
            </a>
          )}
          {!isTvMode && <button className="button button-quiet sign-out-button" type="button" onClick={() => void signOut()}>Sign out</button>}
        </div>
      </header>

      {isTvMode ? (
        <section className="tv-summary" aria-labelledby="tv-title">
          {tvPage === 'targets' ? (
            <>
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
            </>
          ) : (
            <div className="tv-competition">
              <header className="tv-competition-header">
                <div>
                  <h2>Household competition</h2>
                  <p>{competitionRangeLabel || 'Loading scores…'} · ranked by current streaks</p>
                </div>
                <div className="tv-period-switcher" role="group" aria-label="Competition period">
                  {(['week', 'month'] as const).map((period) => (
                    <button
                      key={period}
                      type="button"
                      aria-pressed={competitionPeriod === period}
                      onClick={() => setCompetitionPeriod(period)}
                    >
                      {period === 'week' ? 'This week' : 'This month'}
                    </button>
                  ))}
                </div>
              </header>
              {rankedCompetitionUsers.length ? (
                <ol className="tv-leaderboard">
                  {rankedCompetitionUsers.map((entry, index) => (
                    <li className="tv-leaderboard-row" key={entry.user.id}>
                      <span className="tv-rank" aria-label={`Rank ${index + 1}`}>{index + 1}</span>
                      <div className="tv-rank-user">
                        <strong>{entry.user.displayName}</strong>
                        <span>
                          {entry.allTargetsStreak} all-cleared · {entry.atLeastOneStreak} any-done streak
                        </span>
                      </div>
                      <div className="tv-completion">
                        <div className="tv-completion-label">
                          <span>{entry.completed} / {entry.planned} targets completed</span>
                          <strong>{entry.completionPercent}%</strong>
                        </div>
                        <div
                          className="progress-track"
                          role="progressbar"
                          aria-label={`${entry.user.displayName}'s ${competitionPeriod} completion`}
                          aria-valuenow={entry.completionPercent}
                          aria-valuemin={0}
                          aria-valuemax={100}
                        >
                          <span style={{ width: `${entry.completionPercent}%` }} />
                        </div>
                      </div>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="tv-empty-competition">No household accounts to rank yet.</p>
              )}
              <p className="tv-streak-rule">
                Ranked by all-targets-cleared streak, then at-least-one streak. Completion totals cover target-days in the
                selected period; closed days keep their end-of-day score, while today is live.
              </p>
            </div>
          )}
        </section>
      ) : isAccountManagement ? (
        <section className="account-management" aria-labelledby="account-management-title">
          <a className="goal-back-link" href="/">← Back to planner</a>
          <p className="eyebrow">HOUSEHOLD SETTINGS</p>
          <h1 id="account-management-title">Manage accounts</h1>
          <p className="account-management-description">
            Remove accounts that are no longer needed. Deleting an account permanently removes its plans and progress history.
            You cannot remove your own account.
          </p>
          {notice && <p className="success-banner" role="status">{notice}</p>}
          <section className="account-password-section" aria-labelledby="account-password-title">
            <h2 id="account-password-title">Change your password</h2>
            <p>Enter your current password, then choose a new password of at least 4 characters.</p>
            <form className="account-password-form" onSubmit={(event) => void changePassword(event)}>
              <label className="form-field">
                <span>Current password</span>
                <input
                  autoComplete="current-password"
                  required
                  maxLength={128}
                  type="password"
                  value={currentPassword}
                  onChange={(event) => setCurrentPassword(event.target.value)}
                />
              </label>
              <label className="form-field">
                <span>New password</span>
                <input
                  autoComplete="new-password"
                  required
                  minLength={4}
                  maxLength={128}
                  type="password"
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                />
              </label>
              <label className="form-field">
                <span>Confirm new password</span>
                <input
                  autoComplete="new-password"
                  required
                  minLength={4}
                  maxLength={128}
                  type="password"
                  value={confirmNewPassword}
                  onChange={(event) => setConfirmNewPassword(event.target.value)}
                />
              </label>
              <button className="button button-primary" type="submit" disabled={changingPassword}>
                {changingPassword ? 'Changing password…' : 'Change password'}
              </button>
            </form>
          </section>
          <div className="account-list" aria-live="polite">
            {accounts.map((account) => {
              const isCurrentAccount = account.id === user?.id
              return (
                <article className="account-row" key={account.id}>
                  <span className="avatar" aria-hidden="true">{account.displayName.slice(0, 1).toUpperCase()}</span>
                  <div className="account-row-identity">
                    <strong>{account.displayName}{isCurrentAccount ? ' (you)' : ''}</strong>
                    <span>@{account.username}</span>
                  </div>
                  {isCurrentAccount ? (
                    <span className="account-protected">Your account</span>
                  ) : (
                    <button
                      className="button button-danger"
                      type="button"
                      disabled={deletingAccountId === account.id}
                      onClick={() => void removeAccount(account)}
                    >
                      {deletingAccountId === account.id ? 'Removing…' : 'Remove'}
                    </button>
                  )}
                </article>
              )
            })}
          </div>
        </section>
      ) : isYearlyGoalsPage ? (
        <section className="yearly-goals-page" aria-labelledby="yearly-goals-title">
          <a className="goal-back-link" href="/">← Back to planner</a>
          <p className="eyebrow">YEARLY PLANNING</p>
          <div className="yearly-page-heading">
            <div>
              <h1 id="yearly-goals-title">{selectedYear} goals</h1>
              <p>View your goals and the ordered objectives scheduled throughout the year.</p>
            </div>
            <a className="button button-primary" href="/goal-wizard">Open goal wizard</a>
          </div>
          <YearlyGoalsList goals={goals} year={selectedYear} formatter={shortDateFormatter} />
        </section>
      ) : isGoalWizardPage ? (
        <GoalWizardPage
          initialYear={selectedYear}
          goals={goals}
          onSave={saveGoal}
          onDelete={removeGoal}
        />
      ) : (
        <>
          <section className="planner-heading" aria-labelledby="planner-title">
            <div>
              <p className="eyebrow">MAKE SPACE FOR WHAT MATTERS</p>
              <h1 id="planner-title">My planner</h1>
              <p className="planner-subtitle">A calmer way to plan the days ahead.</p>
            </div>
          </section>

          <div className={`planner-layout${view === 'month' || view === 'week' ? ' has-objectives' : ''}`}>
            {(view === 'month' || view === 'week') && (
              <aside className="objectives-panel" aria-labelledby="objectives-panel-title">
                <p className="eyebrow">{view === 'month' ? 'MONTH OBJECTIVES' : 'WEEK OBJECTIVES'}</p>
                <h2 id="objectives-panel-title">
                  {view === 'month' ? monthFormatter.format(selectedDateValue) : rangeLabel}
                </h2>
                {visibleObjectives.length ? (
                  <ol>
                    {visibleObjectives.map(({ goal, objective }) => (
                      <li key={objective.id}>
                        <strong>{objective.title}</strong>
                        <span>{goal.title}</span>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="objectives-empty">No objectives scheduled for this {view}.</p>
                )}
                <a href="/goal-wizard">Plan objectives</a>
              </aside>
            )}
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
                {(['year', 'month', 'week', 'day'] as const).map((option) => (
                  <button
                    key={option}
                    type="button"
                    aria-pressed={view === option}
                    onClick={() => setView(option)}
                  >
                    {option === 'year' ? 'Yearly goals' : option[0].toUpperCase() + option.slice(1)}
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
              {view === 'year' && (
                <section className="planner-year-view" aria-label={`${selectedYear} yearly goals`}>
                  <header className="planner-year-heading">
                    <div>
                      <h3>{selectedYear} goals</h3>
                      <p>Your goals and their ordered objectives. This view is read-only.</p>
                    </div>
                    <a className="button button-quiet" href="/goal-wizard">Open goal wizard</a>
                  </header>
                  <YearlyGoalsList goals={goals} year={selectedYear} formatter={shortDateFormatter} />
                </section>
              )}
            </div>
            </section>
          </div>
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
