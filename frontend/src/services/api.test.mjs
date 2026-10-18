import assert from 'node:assert/strict'
import test from 'node:test'
import { plannerApi } from './api.ts'

const planItem = {
  id: 'plan-1',
  userId: 'user-1',
  date: '2026-10-18',
  title: 'Water the plants',
  notes: null,
  dueAt: null,
  position: 0,
  completedAt: null,
  createdAt: '2026-10-18T09:00:00Z',
  updatedAt: '2026-10-18T09:00:00Z',
}

test('plan responses are decoded and requests use same-origin credentials', async () => {
  const originalFetch = globalThis.fetch
  let requestUrl
  let requestOptions
  globalThis.fetch = async (url, options) => {
    requestUrl = url
    requestOptions = options
    return new Response(JSON.stringify([planItem]), {
      headers: { 'Content-Type': 'application/json' },
    })
  }

  try {
    const plans = await plannerApi.listPlans('2026-10-01', '2026-10-31')
    assert.deepEqual(plans, [planItem])
    assert.equal(requestUrl, '/api/plans?start=2026-10-01&end=2026-10-31')
    assert.equal(requestOptions.credentials, 'same-origin')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('malformed server data is rejected instead of trusted as a typed response', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => new Response(JSON.stringify([
    { ...planItem, date: '2026-02-30' },
  ]), {
    headers: { 'Content-Type': 'application/json' },
  })

  try {
    await assert.rejects(
      plannerApi.listPlans('2026-10-01', '2026-10-31'),
      /unexpected format/,
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('server error messages are surfaced to callers', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => new Response(
    JSON.stringify({ error: 'Sign in to continue' }),
    { status: 401, headers: { 'Content-Type': 'application/json' } },
  )

  try {
    await assert.rejects(plannerApi.getSession(), /Sign in to continue/)
  } finally {
    globalThis.fetch = originalFetch
  }
})
