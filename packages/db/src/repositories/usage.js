import { query } from '../client.js'

export async function track({ orgId, userId, model, tokensIn, tokensOut, costUsd }) {
  await query(
    `INSERT INTO usage (org_id, user_id, model, tokens_in, tokens_out, cost_usd)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [orgId, userId, model, tokensIn, tokensOut, costUsd]
  )
}

export async function getMonthlyByOrg(orgId) {
  const { rows } = await query(
    `SELECT
       SUM(tokens_in)::int AS total_tokens_in,
       SUM(tokens_out)::int AS total_tokens_out,
       SUM(cost_usd)::numeric AS total_cost,
       COUNT(*)::int AS total_requests
     FROM usage
     WHERE org_id = $1
       AND created_at >= date_trunc('month', now())`,
    [orgId]
  )
  return rows[0]
}

export async function getMonthlyByUser(userId) {
  const { rows } = await query(
    `SELECT
       model,
       SUM(tokens_in)::int AS total_tokens_in,
       SUM(tokens_out)::int AS total_tokens_out,
       SUM(cost_usd)::numeric AS total_cost,
       COUNT(*)::int AS total_requests
     FROM usage
     WHERE user_id = $1
       AND created_at >= date_trunc('month', now())
     GROUP BY model`,
    [userId]
  )
  return rows
}
