import { isDateKey } from '../domain/calendar.ts'
import type {
  HouseholdCompetition,
  HouseholdCompetitionUser,
  HouseholdToday,
  HouseholdTarget,
  HouseholdUserDay,
  GoalObjective,
  PlanItem,
  PlanItemInput,
  User,
  YearlyGoal,
  YearlyGoalInput,
} from '../types/planner'

export interface AuthResponse {
  user: User
  expiresAt: string
  householdTimeZone: string
}

type Decoder<T> = (value: unknown) => T

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isString(value: unknown): value is string {
  return typeof value === 'string'
}

function isNullableString(value: unknown): value is string | null {
  return value === null || isString(value)
}

function isTimestamp(value: unknown): value is string {
  return isString(value)
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    && Number.isFinite(Date.parse(value))
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function isTimeZone(value: unknown): value is string {
  if (!isString(value) || value.length === 0) return false
  try {
    new Intl.DateTimeFormat('en', { timeZone: value })
    return true
  } catch (error) {
    if (error instanceof RangeError) return false
    throw error
  }
}

function invalidResponse(): never {
  throw new Error('The planner server returned data in an unexpected format.')
}

function decodeUser(value: unknown): User {
  if (
    !isRecord(value)
    || !isString(value.id)
    || !isString(value.username)
    || !isString(value.displayName)
    || !isTimestamp(value.createdAt)
    || !isTimestamp(value.updatedAt)
  ) {
    return invalidResponse()
  }
  return {
    id: value.id,
    username: value.username,
    displayName: value.displayName,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  }
}

function decodePlanItem(value: unknown): PlanItem {
  if (
    !isRecord(value)
    || !isString(value.id)
    || !isString(value.userId)
    || !isDateKey(value.date)
    || !isString(value.title)
    || !isNullableString(value.notes)
    || !isNullableString(value.dueAt)
    || (value.dueAt !== null && !isTimestamp(value.dueAt))
    || !isNonNegativeInteger(value.position)
    || !isNullableString(value.completedAt)
    || (value.completedAt !== null && !isTimestamp(value.completedAt))
    || !isTimestamp(value.createdAt)
    || !isTimestamp(value.updatedAt)
  ) {
    return invalidResponse()
  }
  return {
    id: value.id,
    userId: value.userId,
    date: value.date,
    title: value.title,
    notes: value.notes,
    dueAt: value.dueAt,
    position: value.position,
    completedAt: value.completedAt,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  }
}

function decodeYearlyGoal(value: unknown): YearlyGoal {
  if (
    !isRecord(value)
    || !isString(value.id)
    || !isString(value.userId)
    || !isNonNegativeInteger(value.year)
    || value.year === 0
    || !isString(value.title)
    || !Array.isArray(value.objectives)
    || !isTimestamp(value.createdAt)
    || !isTimestamp(value.updatedAt)
  ) {
    return invalidResponse()
  }

  const objectives = value.objectives.map((objective): GoalObjective => {
    if (
      !isRecord(objective)
      || !isString(objective.id)
      || !isString(objective.title)
      || !isNonNegativeInteger(objective.position)
      || !Array.isArray(objective.weekStarts)
      || !objective.weekStarts.every(isDateKey)
    ) {
      return invalidResponse()
    }
    return {
      id: objective.id,
      title: objective.title,
      position: objective.position,
      weekStarts: objective.weekStarts,
    }
  })
  return {
    id: value.id,
    userId: value.userId,
    year: value.year,
    title: value.title,
    objectives,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  }
}

function decodeAuthResponse(value: unknown): AuthResponse {
  if (
    !isRecord(value)
    || !isTimestamp(value.expiresAt)
    || !isTimeZone(value.householdTimeZone)
  ) {
    return invalidResponse()
  }
  return { user: decodeUser(value.user), expiresAt: value.expiresAt, householdTimeZone: value.householdTimeZone }
}

function decodeUsers(value: unknown): User[] {
  if (!Array.isArray(value)) return invalidResponse()
  return value.map(decodeUser)
}

function decodePlanItems(value: unknown): PlanItem[] {
  if (!Array.isArray(value)) return invalidResponse()
  return value.map(decodePlanItem)
}

function decodeYearlyGoals(value: unknown): YearlyGoal[] {
  if (!Array.isArray(value)) return invalidResponse()
  return value.map(decodeYearlyGoal)
}

function decodeHouseholdToday(value: unknown): HouseholdToday {
  if (
    !isRecord(value)
    || !isDateKey(value.date)
    || !isTimeZone(value.timeZone)
    || !Array.isArray(value.users)
  ) {
    return invalidResponse()
  }

  const users = value.users.map((member): HouseholdUserDay => {
    if (
      !isRecord(member)
      || !Array.isArray(member.targets)
      || !isNonNegativeInteger(member.completed)
      || !isNonNegativeInteger(member.allTargetsStreak)
      || !isNonNegativeInteger(member.atLeastOneStreak)
    ) {
      return invalidResponse()
    }
    const targets = member.targets.map((target): HouseholdTarget => {
      if (
        !isRecord(target)
        || !isString(target.id)
        || !isString(target.title)
        || !isNullableString(target.dueAt)
        || (target.dueAt !== null && !isTimestamp(target.dueAt))
        || !isNullableString(target.completedAt)
        || (target.completedAt !== null && !isTimestamp(target.completedAt))
        || !isNonNegativeInteger(target.position)
      ) {
        return invalidResponse()
      }
      return {
        id: target.id,
        title: target.title,
        dueAt: target.dueAt,
        completedAt: target.completedAt,
        position: target.position,
      }
    })
    if (member.completed > targets.length) return invalidResponse()
    return {
      user: decodeUser(member.user),
      targets,
      completed: member.completed,
      allTargetsStreak: member.allTargetsStreak,
      atLeastOneStreak: member.atLeastOneStreak,
    }
  })
  return { date: value.date, timeZone: value.timeZone, users }
}

function decodeHouseholdCompetition(value: unknown): HouseholdCompetition {
  if (
    !isRecord(value)
    || (value.period !== 'week' && value.period !== 'month')
    || !isDateKey(value.startDate)
    || !isDateKey(value.endDate)
    || !isTimeZone(value.timeZone)
    || !Array.isArray(value.users)
  ) {
    return invalidResponse()
  }

  const users = value.users.map((entry): HouseholdCompetitionUser => {
    if (
      !isRecord(entry)
      || !isNonNegativeInteger(entry.allTargetsStreak)
      || !isNonNegativeInteger(entry.atLeastOneStreak)
      || !isNonNegativeInteger(entry.planned)
      || !isNonNegativeInteger(entry.completed)
      || !isNonNegativeInteger(entry.completionPercent)
    ) {
      return invalidResponse()
    }
    if (entry.completed > entry.planned || entry.completionPercent > 100) return invalidResponse()
    return {
      user: decodeUser(entry.user),
      allTargetsStreak: entry.allTargetsStreak,
      atLeastOneStreak: entry.atLeastOneStreak,
      planned: entry.planned,
      completed: entry.completed,
      completionPercent: entry.completionPercent,
    }
  })
  return {
    period: value.period,
    startDate: value.startDate,
    endDate: value.endDate,
    timeZone: value.timeZone,
    users,
  }
}

function decodeNoContent(value: unknown): void {
  if (value !== undefined) return invalidResponse()
}

async function request<T>(
  path: string,
  decoder: Decoder<T>,
  init: RequestInit = {},
): Promise<T> {
  let response: Response
  try {
    response = await fetch(path, {
      ...init,
      credentials: 'same-origin',
      headers: {
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...init.headers,
      },
    })
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error('Could not connect to the planner server.', { cause: error })
    }
    throw error
  }

  if (!response.ok) {
    const body = await response.text()
    if (body.length === 0) throw new Error(`Planner request failed (${response.status}).`)
    let errorBody: unknown
    try {
      errorBody = JSON.parse(body)
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new Error(`Planner request failed (${response.status}) with an invalid error response.`)
      }
      throw error
    }
    const message = isRecord(errorBody) && isString(errorBody.error) && errorBody.error.length > 0
      ? errorBody.error
      : `Planner request failed (${response.status}).`
    throw new Error(message)
  }

  if (response.status === 204) return decoder(undefined)
  let body: unknown
  try {
    body = await response.json() as unknown
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error('The planner server returned invalid JSON.')
    }
    throw error
  }
  return decoder(body)
}

function jsonBody(value: unknown): string {
  return JSON.stringify(value)
}

export const plannerApi = {
  getSession: () => request('/api/session', decodeAuthResponse),
  signIn: (username: string, password: string) => request('/api/login', decodeAuthResponse, {
    method: 'POST',
    body: jsonBody({ username, password }),
  }),
  register: (username: string, password: string, displayName: string) =>
    request('/api/register', decodeAuthResponse, {
      method: 'POST',
      body: jsonBody({ username, password, displayName }),
    }),
  signOut: () => request('/api/logout', decodeNoContent, { method: 'POST' }),
  listAccounts: () => request('/api/accounts', decodeUsers),
  deleteAccount: (accountId: string) =>
    request(`/api/accounts/${encodeURIComponent(accountId)}`, decodeNoContent, { method: 'DELETE' }),
  changePassword: (currentPassword: string, newPassword: string) =>
    request('/api/account/password', decodeNoContent, {
      method: 'PUT',
      body: jsonBody({ currentPassword, newPassword }),
    }),
  listGoals: () => request('/api/goals', decodeYearlyGoals),
  saveGoal: (goalId: string | null, payload: YearlyGoalInput) =>
    request(
      goalId ? `/api/goals/${encodeURIComponent(goalId)}` : '/api/goals',
      decodeYearlyGoal,
      { method: goalId ? 'PUT' : 'POST', body: jsonBody(payload) },
    ),
  deleteGoal: (goalId: string) =>
    request(`/api/goals/${encodeURIComponent(goalId)}`, decodeNoContent, { method: 'DELETE' }),
  listPlans: (start: string, end: string) => {
    const query = new URLSearchParams({ start, end })
    return request(`/api/plans?${query}`, decodePlanItems)
  },
  savePlan: (itemId: string | null, payload: PlanItemInput) =>
    request(
      itemId ? `/api/plans/${encodeURIComponent(itemId)}` : '/api/plans',
      decodePlanItem,
      { method: itemId ? 'PUT' : 'POST', body: jsonBody(payload) },
    ),
  setCompletion: (itemId: string, completed: boolean) =>
    request(`/api/plans/${encodeURIComponent(itemId)}/completion`, decodePlanItem, {
      method: 'PATCH',
      body: jsonBody({ completed }),
    }),
  deletePlan: (itemId: string) =>
    request(`/api/plans/${encodeURIComponent(itemId)}`, decodeNoContent, { method: 'DELETE' }),
  reorderPlans: (date: string, itemIds: string[]) =>
    request('/api/plans/order', decodeNoContent, {
      method: 'PUT',
      body: jsonBody({ date, itemIds }),
    }),
  getHouseholdToday: () => request('/api/household/today', decodeHouseholdToday),
  getHouseholdCompetition: (period: 'week' | 'month') => {
    const query = new URLSearchParams({ period })
    return request(`/api/household/competition?${query}`, decodeHouseholdCompetition)
  },
}
