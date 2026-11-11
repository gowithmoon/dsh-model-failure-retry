// OpenAI-compatible mock LLM for live smoke tests (from the #2 prototype).
// Models:
//   fail  — always 429 (rate limit)
//   flaky — first step returns a bash tool call; the step after the tool result returns 429
//   rl2   — 429 with Retry-After: 1 for the first $MOCK_RL_FAILS (default 2) requests, then like ok
//   daily — always 429 "daily limit reached" (quota by the default classification rules, #5)
//   ok    — replies with a text summary of what it saw (so we can inspect model-visible context)
// Every request body is appended to $MOCK_LOG (default /tmp/mock-llm/requests.jsonl).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const PORT = Number(process.env.MOCK_PORT ?? 3999);
const LOG = process.env.MOCK_LOG ?? '/tmp/mock-llm/requests.jsonl';
fs.mkdirSync(path.dirname(LOG), { recursive: true });

function sse(res, chunks) {
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  for (const c of chunks) res.write(`data: ${JSON.stringify(c)}\n\n`);
  res.end('data: [DONE]\n\n');
}
const base = (model) => ({ id: 'cmpl-' + Date.now(), object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model });
const text = (model, t) => [
  { ...base(model), choices: [{ index: 0, delta: { role: 'assistant', content: t }, finish_reason: null }] },
  { ...base(model), choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } },
];
const toolCall = (model) => [
  { ...base(model), choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0, id: 'call_' + Date.now(), type: 'function', function: { name: 'bash', arguments: '' } }] }, finish_reason: null }] },
  { ...base(model), choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: JSON.stringify({ description: 'Print marker text', command: 'echo TOOL_RAN' }) } }] }, finish_reason: null }] },
  { ...base(model), choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } },
];
let rl2Count = 0;
const RL_FAILS = Number(process.env.MOCK_RL_FAILS ?? 2);
function rateLimit(res, retryAfter) {
  res.writeHead(429, { 'content-type': 'application/json', 'x-should-retry': 'false', ...(retryAfter ? { 'retry-after': String(retryAfter) } : {}) });
  res.end(JSON.stringify({ error: { message: 'mock: 429 rate limit exceeded', type: 'rate_limit_error', code: 'rate_limit_exceeded' } }));
}
const contentText = (c) => typeof c === 'string' ? c : Array.isArray(c) ? c.map((p) => p.text ?? '').join('') : '';

http.createServer((req, res) => {
  let body = '';
  req.on('data', (d) => (body += d));
  req.on('end', () => {
    if (!req.url.endsWith('/chat/completions')) { res.writeHead(404); return res.end(); }
    const j = JSON.parse(body);
    const msgs = j.messages ?? [];
    const last = msgs[msgs.length - 1];
    fs.appendFileSync(LOG, JSON.stringify({ at: new Date().toISOString(), model: j.model, messages: msgs.map((m) => ({ role: m.role, text: contentText(m.content).slice(0, 400), tool_calls: m.tool_calls?.map((t) => t.function?.name) })) }) + '\n');
    if (j.model === 'fail') return rateLimit(res);
    if (j.model === 'daily') {
      res.writeHead(429, { 'content-type': 'application/json', 'x-should-retry': 'false' });
      return res.end(JSON.stringify({ error: { message: 'mock: 429 daily limit reached for this model', type: 'rate_limit_error' } }));
    }
    if (j.model === 'rl2' && rl2Count++ < RL_FAILS) return rateLimit(res, 1);
    if (j.model === 'flaky') return last?.role === 'tool' ? rateLimit(res) : sse(res, toolCall(j.model));
    // ok: describe the tail of the conversation it was given
    const tail = msgs.slice(-4).map((m) => `${m.role}${m.tool_calls ? '[tool_calls]' : ''}: ${contentText(m.content).replace(/\s+/g, ' ').slice(0, 160)}`).join(' | ');
    return sse(res, text(j.model, `OK-MODEL saw ${msgs.length} messages. tail => ${tail}`));
  });
}).listen(PORT, '127.0.0.1', () => console.log(`mock-llm on http://127.0.0.1:${PORT}/v1`));
