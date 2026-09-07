import { parseGroqResetDuration, getGroqResetInfo } from './routes/ai.js';

function runTests() {
  console.log('========== GROQ RATE LIMIT PARSER UNIT TESTS ==========');

  // TEST 1: retry-after: 37s
  const t1 = parseGroqResetDuration('37s');
  console.log('TEST 1 (37s):', t1 === 37 ? 'PASS' : `FAIL (got ${t1})`);

  // TEST 2: retry-after: 1m2s
  const t2 = parseGroqResetDuration('1m2s');
  console.log('TEST 2 (1m2s -> 62s):', t2 === 62 ? 'PASS' : `FAIL (got ${t2})`);

  // TEST 3: retry-after: 1500ms
  const t3 = parseGroqResetDuration('1500ms');
  console.log('TEST 3 (1500ms -> 2s):', t3 === 2 ? 'PASS' : `FAIL (got ${t3})`);

  // TEST 4: No reset headers
  const t4 = getGroqResetInfo({}, '');
  console.log('TEST 4 (No headers):', t4.parsedSeconds === null ? 'PASS' : `FAIL (got ${t4.parsedSeconds})`);

  // TEST 5: Daily quota exhaustion error body
  const t5 = getGroqResetInfo({}, 'Rate limit exceeded: Today\'s daily limit reached for model');
  console.log('TEST 5 (Daily quota):', t5.isQuotaExceeded === true ? 'PASS' : `FAIL (got ${t5.isQuotaExceeded})`);

  // TEST 6: Pure integer string
  const t6 = parseGroqResetDuration('45');
  console.log('TEST 6 (Pure number "45"):', t6 === 45 ? 'PASS' : `FAIL (got ${t6})`);

  // TEST 7: Case-insensitive headers
  const t7 = getGroqResetInfo({ 'X-RateLimit-Reset-Requests': '12s' }, '');
  console.log('TEST 7 (Case-insensitive header):', t7.parsedSeconds === 12 ? 'PASS' : `FAIL (got ${t7.parsedSeconds})`);

  console.log('=======================================================');
}

runTests();
