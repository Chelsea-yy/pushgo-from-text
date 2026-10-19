import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import test from 'node:test';
import { generateWithModel } from '../src/generation/index.js';
import { textSource } from '../src/ingest/index.js';

const source = textSource('活动名称：星河读书会\n地点：审核后通知\n报名方式：待公布');
const content = () => ({ title: '星河读书会', summary: '阅读与交流', facts: { venue: { value: '审核后通知', sourceBlockIds: ['b2'], status: 'extracted' } }, blocks: [{ id: 'intro', type: 'paragraph', text: '星河读书会', sourceBlockIds: ['b1'] }] });
const options = (baseUrl: string) => ({ apiKey: 'synthetic-test-key', model: 'synthetic-test-model', baseUrl });
async function mock(handler: (req: IncomingMessage, res: ServerResponse) => void, run: (url: string) => Promise<void>): Promise<void> {
  const server = createServer(handler);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  try { await run(`http://127.0.0.1:${address.port}/v1`); }
  finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
}

test('explicit model request uses sources as data and returns unconfirmed draft', async () => {
  let requests = 0;
  await mock((req, res) => {
    requests++;
    assert.equal(req.url, '/v1/chat/completions');
    assert.equal(req.headers.authorization, 'Bearer synthetic-test-key');
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', () => {
      const parsed = JSON.parse(body);
      assert.equal(parsed.model, 'synthetic-test-model');
      assert.match(parsed.messages[0].content, /不可信数据/);
      assert.match(parsed.messages[1].content, /审核后通知/);
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content()) } }] }));
    });
  }, async url => {
    const draft = await generateWithModel(source, 'formal', ['简洁'], options(url));
    assert.equal(draft.mode, 'model');
    assert.equal(draft.reviewStatus, 'needs-review');
    assert.equal(draft.facts.venue?.value, '审核后通知');
  });
  assert.equal(requests, 1);
});

test('invented facts and unknown source IDs reject model output', async () => {
  await mock((_req, res) => {
    const value = content();
    value.facts.venue = { value: '新会场999号', sourceBlockIds: ['unknown'], status: 'extracted' };
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(value) } }] }));
  }, async url => { await assert.rejects(generateWithModel(source, 'campus', [], options(url)), /未通过/); });
});

test('missing model citations and unsolicited remote images are rejected', async () => {
  for (const block of [
    { id: 'unsourced', type: 'paragraph', text: 'All invited guests attended.' },
    { id: 'image', type: 'image', sourceBlockIds: ['b1'], image: { src: 'https://example.com/track.png', alt: 'test' } },
  ]) {
    await mock((_req, res) => {
      res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ ...content(), blocks: [block] }) } }] }));
    }, async url => { await assert.rejects(generateWithModel(source, 'campus', [], options(url)), /格式/); });
  }
});

test('HTTP failure is redacted, has no retry or silent fallback', async () => {
  let requests = 0;
  await mock((_req, res) => { requests++; res.writeHead(401); res.end('secret echo synthetic-test-key'); }, async url => {
    await assert.rejects(generateWithModel(source, 'campus', [], options(url)), error => {
      assert.match((error as Error).message, /HTTP 401/);
      assert.doesNotMatch((error as Error).message, /synthetic-test-key/);
      return true;
    });
  });
  assert.equal(requests, 1);
});

test('redirects are rejected rather than forwarding credentials', async () => {
  await mock((_req, res) => { res.writeHead(302, { Location: 'https://example.com/steal' }); res.end(); }, async url => {
    await assert.rejects(generateWithModel(source, 'campus', [], options(url)), /请求失败/);
  });
});

test('malformed JSON and oversized model response fail', async () => {
  for (const response of ['not json', 'a'.repeat(2_000_001)]) {
    await mock((_req, res) => res.end(response), async url => {
      await assert.rejects(generateWithModel(source, 'campus', [], options(url)), /格式|过大/);
    });
  }
});

test('timeouts, no credentials, unsafe endpoints and too-long material fail', async () => {
  await mock(() => undefined, async url => {
    await assert.rejects(generateWithModel(source, 'campus', [], { ...options(url), timeoutMs: 20 }), /超时/);
  });
  await assert.rejects(generateWithModel(source, 'campus', [], { ...options('https://example.com/v1'), apiKey: '' }), /要求/);
  for (const url of ['http://example.com/v1', 'https://user:password@example.com/v1', 'https://example.com/v1?key=x']) {
    await assert.rejects(generateWithModel(source, 'campus', [], options(url)), /HTTPS|地址/);
  }
  await assert.rejects(generateWithModel(textSource('长'.repeat(40_001)), 'campus', [], options('https://example.com/v1')), /40000/);
});
