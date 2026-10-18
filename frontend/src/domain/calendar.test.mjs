import assert from 'node:assert/strict'
import test from 'node:test'
import {
  dateFromKey,
  dateKey,
  dateKeyInTimeZone,
  isDateKey,
  startOfWeek,
  weekOverlapsMonth,
  weeksForYear,
} from './calendar.ts'

test('date keys accept real Gregorian dates only', () => {
  assert.equal(isDateKey('2024-02-29'), true)
  assert.equal(isDateKey('2025-02-29'), false)
  assert.equal(isDateKey('2026-13-01'), false)
  assert.equal(dateKey(dateFromKey('0001-01-01')), '0001-01-01')
  assert.throws(() => dateFromKey('2026-02-30'), RangeError)
})

test('calendar arithmetic uses Monday-start UTC weeks', () => {
  const sunday = dateFromKey('2026-10-18')
  assert.equal(dateKey(startOfWeek(sunday)), '2026-10-12')
  assert.equal(weekOverlapsMonth(dateFromKey('2026-09-28'), 2026, 9), true)
  assert.equal(weeksForYear(2021).length, 53)
})

test('timezone conversion uses the household-local calendar day', () => {
  const instant = new Date('2026-01-01T01:00:00.000Z')
  assert.equal(dateKeyInTimeZone(instant, 'America/Los_Angeles'), '2025-12-31')
  assert.equal(dateKeyInTimeZone(instant, 'Europe/London'), '2026-01-01')
})
