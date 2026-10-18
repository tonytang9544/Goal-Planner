export function utcDate(year: number, month: number, day: number): Date {
  const date = new Date(0)
  date.setUTCFullYear(year, month, day)
  date.setUTCHours(0, 0, 0, 0)
  return date
}

export function dateKey(date: Date): string {
  const year = String(date.getUTCFullYear()).padStart(4, '0')
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function isDateKey(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false

  const [year, month, day] = value.split('-').map(Number)
  const date = utcDate(year, month - 1, day)
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day
}

export function dateFromKey(value: string): Date {
  if (!isDateKey(value)) throw new RangeError(`Invalid calendar date: ${value}`)
  const [year, month, day] = value.split('-').map(Number)
  return utcDate(year, month - 1, day)
}

export function dateKeyInTimeZone(date: Date, timeZone: string): string {
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
  return `${year.padStart(4, '0')}-${month}-${day}`
}

export function addDays(date: Date, amount: number): Date {
  const result = new Date(date)
  result.setUTCDate(result.getUTCDate() + amount)
  return result
}

export function startOfWeek(date: Date): Date {
  const offset = (date.getUTCDay() + 6) % 7
  return addDays(date, -offset)
}

export function weeksForYear(year: number): Date[] {
  const firstWeek = startOfWeek(utcDate(year, 0, 1))
  const lastWeek = startOfWeek(utcDate(year, 11, 31))
  const weeks: Date[] = []
  for (let week = firstWeek; week <= lastWeek; week = addDays(week, 7)) {
    weeks.push(week)
  }
  return weeks
}

export function weekOverlapsMonth(week: Date, year: number, month: number): boolean {
  const monthStart = utcDate(year, month, 1)
  const monthEnd = utcDate(year, month + 1, 0)
  const weekEnd = addDays(week, 6)
  return week <= monthEnd && weekEnd >= monthStart
}

export function monthForWeekMap(week: Date, year: number): number {
  const thursday = addDays(week, 3)
  if (thursday.getUTCFullYear() < year) return 0
  if (thursday.getUTCFullYear() > year) return 11
  return thursday.getUTCMonth()
}
