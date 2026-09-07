import { parseGroqResetDuration, getGroqResetInfo } from './routes/ai.js';

function runTests() {
  console.log('========== GROQ RATE LIMIT EXTENDED UNIT TESTS ==========');

  // TEST A: Provider returns Retry-After header
  const tA = getGroqResetInfo({ 'retry-after': '37' }, '');
  console.log('TEST A (Retry-After header "37"):', tA.parsedSeconds === 37 ? 'PASS' : `FAIL (got ${tA.parsedSeconds})`);

  // TEST B: Provider returns reset timestamp header x-ratelimit-reset (Unix timestamp in future)
  const futureUnixSecs = Math.floor(Date.now() / 1000) + 42;
  const tB = getGroqResetInfo({ 'x-ratelimit-reset': String(futureUnixSecs) }, '');
  console.log('TEST B (Reset Unix timestamp header):', (tB.parsedSeconds >= 41 && tB.parsedSeconds <= 43) ? 'PASS' : `FAIL (got ${tB.parsedSeconds})`);

  // TEST C: Provider returns ISO reset timestamp
  const futureIso = new Date(Date.now() + 25000).toISOString();
  const tC = parseGroqResetDuration(futureIso);
  console.log('TEST C (ISO reset timestamp):', (tC >= 24 && tC <= 26) ? 'PASS' : `FAIL (got ${tC})`);

  // TEST D: Provider returns 429 with NO reset info
  const tD = getGroqResetInfo({}, '');
  console.log('TEST D (No reset info returns null):', tD.parsedSeconds === null ? 'PASS' : `FAIL (got ${tD.parsedSeconds})`);

  // TEST E: Provider returns 1m2s format
  const tE = parseGroqResetDuration('1m2s');
  console.log('TEST E (1m2s -> 62s):', tE === 62 ? 'PASS' : `FAIL (got ${tE})`);

  // TEST F: Provider returns 1500ms format
  const tF = parseGroqResetDuration('1500ms');
  console.log('TEST F (1500ms -> 2s):', tF === 2 ? 'PASS' : `FAIL (got ${tF})`);

  console.log('===========================================================');
}

runTests();
