/**
 * The automated pull-request reviewer behind .github/workflows/review.yml. Sends a PR's diff to a model and
 * writes the GitHub review to post: APPROVE on a clean verdict, COMMENT with the findings otherwise. It throws
 * on anything it cannot read as a verdict, so a failed run posts nothing and approves nothing.
 *
 *   node --experimental-strip-types review.ts --diff pr.diff --out review.json
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'

type Finding = { file: string; line: number; blocking: boolean; message: string }
type Verdict = { verdict: 'approve' | 'block'; summary: string; findings: Finding[] }

/** Who and what stands behind a review, printed in its body as the audit record. */
export type ReviewRecord = { model: string; reviewerSha: string; headSha: string; requestedBy: string }

// OpenAI strict structured output: every property required, no extras.
const VERDICT_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: ['verdict', 'summary', 'findings'],
    properties: {
        verdict: { type: 'string', enum: ['approve', 'block'] },
        summary: { type: 'string' },
        findings: {
            type: 'array',
            items: {
                type: 'object',
                additionalProperties: false,
                required: ['file', 'line', 'blocking', 'message'],
                properties: {
                    file: { type: 'string' },
                    line: { type: 'integer' },
                    blocking: { type: 'boolean' },
                    message: { type: 'string' },
                },
            },
        },
    },
}

const isFinding = (value: unknown): value is Finding => {
    const finding = value as Finding
    return (
        typeof finding === 'object' &&
        finding !== null &&
        typeof finding.file === 'string' &&
        typeof finding.line === 'number' &&
        typeof finding.blocking === 'boolean' &&
        typeof finding.message === 'string'
    )
}

export const parseVerdict = (text: string): Verdict => {
    const verdict = JSON.parse(text) as Verdict
    const valid =
        typeof verdict === 'object' &&
        verdict !== null &&
        (verdict.verdict === 'approve' || verdict.verdict === 'block') &&
        typeof verdict.summary === 'string' &&
        Array.isArray(verdict.findings) &&
        verdict.findings.every(isFinding)
    if (!valid) throw new Error(`The model's answer is not a verdict: ${text}`)
    return verdict
}

export const toReview = (verdict: Verdict, record: ReviewRecord) => {
    const approved = verdict.verdict === 'approve' && !verdict.findings.some((finding) => finding.blocking)
    const findings = verdict.findings.map(
        ({ file, line, blocking, message }) => `- ${blocking ? '**Blocking**' : 'Note'} \`${file}:${line}\` ${message}`,
    )
    const body = [
        `**Automated review: ${approved ? 'approved' : 'not approved'}**`,
        verdict.summary,
        ...(findings.length ? [findings.join('\n')] : []),
        '---',
        `This is an automated review by \`${record.model}\`, not a human review. ` +
            `Reviewer rules at ${record.reviewerSha}, commit reviewed ${record.headSha}. ` +
            `Requested by @${record.requestedBy}, who by adding the \`ai-review\` label states they reviewed ` +
            `this change and accept responsibility for merging it on automated approval.`,
    ].join('\n\n')
    return { commit_id: record.headSha, event: approved ? 'APPROVE' : 'COMMENT', body }
}

type ResponsesOutput = { output?: { content?: { type: string; text?: string }[] }[] }

export const requestVerdict = async (input: { apiKey: string; model: string; prompt: string; diff: string }) => {
    const response = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: { authorization: `Bearer ${input.apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({
            model: input.model,
            instructions: input.prompt,
            input: input.diff,
            text: { format: { type: 'json_schema', name: 'review_verdict', strict: true, schema: VERDICT_SCHEMA } },
        }),
    })
    if (!response.ok) throw new Error(`OpenAI answered ${response.status}: ${await response.text()}`)
    const { output = [] } = (await response.json()) as ResponsesOutput
    const text = output.flatMap((item) => item.content ?? []).find((part) => part.type === 'output_text')?.text
    if (!text) throw new Error('OpenAI returned no text (a refusal or an empty answer)')
    return parseVerdict(text)
}

const requireEnv = (name: string) => {
    const value = process.env[name]
    if (!value) throw new Error(`${name} is not set`)
    return value
}

export const main = async (args = process.argv.slice(2)) => {
    const { values } = parseArgs({ args, options: { diff: { type: 'string' }, out: { type: 'string' } } })
    if (!values.diff || !values.out) throw new Error('Usage: review.ts --diff <file> --out <file>')

    const model = requireEnv('AI_REVIEW_MODEL')
    const verdict = await requestVerdict({
        apiKey: requireEnv('OPENAI_API_KEY'),
        model,
        prompt: readFileSync(join(import.meta.dirname, 'prompt.md'), 'utf-8'),
        diff: readFileSync(values.diff, 'utf-8'),
    })
    const review = toReview(verdict, {
        model,
        reviewerSha: requireEnv('REVIEWER_SHA'),
        headSha: requireEnv('HEAD_SHA'),
        requestedBy: requireEnv('REQUESTED_BY'),
    })
    writeFileSync(values.out, JSON.stringify(review))
    console.log(`${review.event}: ${verdict.summary}`)
}

if (import.meta.main) void main()
