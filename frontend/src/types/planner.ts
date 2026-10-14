export interface User {
  id: string
  username: string
  displayName: string
  createdAt: string
  updatedAt: string
}

export interface SessionInfo {
  id: string
  userId: string
  expiresAt: string
  createdAt: string
}

export interface PlanItem {
  id: string
  userId: string
  /** Calendar date in YYYY-MM-DD form, interpreted in the household's local time. */
  date: string
  title: string
  notes: string | null
  dueAt: string | null
  position: number
  completedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface GoalObjective {
  id: string
  title: string
  position: number
  weekStarts: string[]
}

export interface YearlyGoal {
  id: string
  userId: string
  year: number
  title: string
  objectives: GoalObjective[]
  createdAt: string
  updatedAt: string
}

export interface CompletionEvent {
  id: string
  planItemId: string
  changedByUserId: string
  isCompleted: boolean
  occurredAt: string
}

export interface MonthView {
  userId: string
  year: number
  /** Calendar month, from 1 through 12. */
  month: number
  weeks: WeekView[]
}

export interface WeekView {
  startDate: string
  endDate: string
  days: DayView[]
}

export interface DayView {
  date: string
  items: PlanItem[]
}

export interface HouseholdTarget {
  id: string
  title: string
  dueAt: string | null
  completedAt: string | null
  position: number
}

export interface HouseholdUserDay {
  user: User
  targets: HouseholdTarget[]
  completed: number
  allTargetsStreak: number
  atLeastOneStreak: number
}

export interface HouseholdToday {
  date: string
  timeZone: string
  users: HouseholdUserDay[]
}

export interface HouseholdCompetitionUser {
  user: User
  allTargetsStreak: number
  atLeastOneStreak: number
  planned: number
  completed: number
  completionPercent: number
}

export interface HouseholdCompetition {
  period: 'week' | 'month'
  startDate: string
  endDate: string
  timeZone: string
  users: HouseholdCompetitionUser[]
}
