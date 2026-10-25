
import { createServer } from 'node:http'
import path from 'node:path'

import { FileStore } from '../../../packages/store/dist/index.js'
import { EvaluationHistory } from '../../../packages/heae/dist/persistence/evaluation-history.js'

const HOST = '127.0.0.1'
const PORT = 4174

// Matches the HEAE CLI's default evaluation history location.
// Run this server from the repository root.
const historyDirectory = path.resolve('.heae/history')

const store = new FileStore(historyDirectory)
const history = new EvaluationHistory(store)

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  })

  response.end(JSON.stringify(body))
}

function summarize(record) {
  const ruleReport = record.result.ruleReport

  return {
    traceId: record.traceId,
    outcome: ruleReport.outcome,
    categories: [
      ...new Set(
        ruleReport.observations.map((finding) => finding.category),
      ),
    ],
    observationCount: ruleReport.observations.length,
    hypothesisCount: ruleReport.hypotheses.length,
    judgeStatus: record.result.judgeStatus,
    traceFingerprint: record.traceFingerprint ?? null,
  }
}

const server = createServer(async (request, response) => {
  if (request.method !== 'GET') {
    sendJson(response, 405, {
      error: 'Only GET requests are supported.',
    })
    return
  }

  let url

  try {
    url = new URL(
      request.url ?? '/',
      `http://${HOST}:${PORT}`,
    )
  } catch {
    sendJson(response, 400, { error: 'Invalid request URL.' })
    return
  }

  try {
    if (url.pathname === '/api/health') {
      sendJson(response, 200, {
        status: 'ok',
        service: 'heae-dashboard-api',
        mode: 'read_only',
      })
      return
    }

    if (url.pathname === '/api/evaluations') {
      const records = await history.list()

      const evaluations = records
        .map(summarize)
        .sort((a, b) => a.traceId.localeCompare(b.traceId))

      sendJson(response, 200, {
        count: evaluations.length,
        evaluations,
      })
      return
    }

    const match = /^\/api\/evaluations\/([0-9a-f]{32})$/.exec(
      url.pathname,
    )

    if (match) {
      const record = await history.load(match[1])

      if (!record) {
        sendJson(response, 404, {
          error: 'Evaluation not found.',
        })
        return
      }

      sendJson(response, 200, record)
      return
    }

    sendJson(response, 404, {
      error: 'Endpoint not found.',
    })
  } catch (error) {
    console.error('HEAE API error:', error)

    sendJson(response, 500, {
      error: 'Unable to read HEAE evaluation data.',
    })
  }
})

server.listen(PORT, HOST, () => {
  console.log(`HEAE read-only API: http://${HOST}:${PORT}`)
  console.log(`Evaluation history: ${historyDirectory}`)
})
