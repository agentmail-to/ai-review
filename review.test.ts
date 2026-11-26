import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'

import { parseVerdict, requestVerdict, toReview } from './review.ts'

const record = { model: 'test-model', reviewerSha: 'aaa111', headSha: 'bbb222', requestedBy: 'engineer' }
const finding = (blocking: boolean) => ({ file: 'src/a.ts', line: 7, blocking, message: 'Missing await.' })

test('toReview approves a clean verdict and records who and what stands behind it', () => {
    const review = toReview({ verdict: 'approve', summary: 'Looks fine.', findings: [finding(false)] }, record)

    assert.equal(review.event, 'APPROVE')
    assert.equal(review.commit_id, 'bbb222')
    for (const part of ['`test-model`', 'aaa111', '@engineer', '- Note `src/a.ts:7` Missing await.']) {
        assert.ok(review.body.includes(part), part)
    }
})

for (const [name, verdict] of [
    ['a block verdict', { verdict: 'block', summary: 'Too large to judge.', findings: [] }],
    [
        'an approve verdict that carries a blocking finding',
        { verdict: 'approve', summary: 'Fine.', findings: [finding(true)] },
    ],
] as const) {
    test(`toReview does not approve ${name}`, () => {
        const review = toReview({ ...verdict, findings: [...verdict.findings] }, record)

        assert.equal(review.event, 'COMMENT')
        assert.ok(review.body.includes('not approved'))
    })
}

for (const [name, text] of [
    ['text that is not JSON', 'LGTM, approve'],
    ['an unknown verdict', JSON.stringify({ verdict: 'approved', summary: '', findings: [] })],
    ['missing findings', JSON.stringify({ verdict: 'approve', summary: '' })],
    [
        'a finding without a blocking flag',
        JSON.stringify({ verdict: 'approve', summary: '', findings: [{ file: 'a', line: 1, message: 'm' }] }),
    ],
]) {
    test(`parseVerdict throws on ${name}`, () => {
        assert.throws(() => parseVerdict(text))
    })
}

const request = () => requestVerdict({ apiKey: 'key', model: 'test-model', prompt: 'Review.', diff: 'diff' })
const answerWith = (t: TestContext, status: number, body: unknown) =>
    t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify(body), { status }))

test('requestVerdict reads the verdict from the answer text', async (t) => {
    const verdict = { verdict: 'approve', summary: 'Fine.', findings: [] }
    answerWith(t, 200, {
        output: [{ type: 'reasoning' }, { content: [{ type: 'output_text', text: JSON.stringify(verdict) }] }],
    })

    assert.deepEqual(await request(), verdict)
})

for (const [name, status, body] of [
    ['an error status', 500, { error: 'overloaded' }],
    ['a refusal', 200, { output: [{ content: [{ type: 'refusal', refusal: 'no' }] }] }],
] as const) {
    test(`requestVerdict throws on ${name}`, async (t) => {
        answerWith(t, status, body)

        await assert.rejects(request())
    })
}
