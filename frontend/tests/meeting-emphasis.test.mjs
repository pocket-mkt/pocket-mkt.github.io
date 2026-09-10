import test from 'node:test';
import assert from 'node:assert/strict';
import { meetingLine } from '../src/meetingEmphasis.js';
test('explicit important overrides owner body color without losing responsibility', () => {
  assert.deepEqual(meetingLine('- [중요] NS: 마감 확인'), { text:'마감 확인',bullet:'- ',important:true,owners:['ns'],tone:'important' });
});
test('owner colors and shared ownership are explicit', () => {
  assert.equal(meetingLine('포켓: 자료 전달').tone,'pocket');
  assert.equal(meetingLine('NS: 결과 확인').tone,'ns');
  assert.deepEqual(meetingLine('NS·포켓: 협의').owners,['ns','pocket']);
  assert.equal(meetingLine('NS·포켓: 협의').tone,'plain');
});
test('normal text, mentions, unknown tags and markup remain text', () => {
  for(const text of ['NS가 설명함','포켓 업무를 NS가 확인','[미정] 확인','<script>alert(1)</script>']) assert.equal(meetingLine(text).text,text);
  assert.equal(meetingLine('NS가 설명함').tone,'plain');
  assert.equal(meetingLine(null).text,'');
});
