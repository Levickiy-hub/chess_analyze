import test from 'node:test';
import assert from 'node:assert/strict';
import { learningViewHTML } from '../public/learning-view.mjs';

test('scheduled repetitions remain available after the daily goal and reflected data is escaped',()=>{
  const report={cycle:{format:'rapid',focus:'safety',startedAt:'2026-11-26T12:00:00Z',dailyGoal:3,baseline:{analysed:20,games:20,evaluated:100,errors:20,errorRate:20,reached:0}},progress:{games:0,analysed:0,evaluated:0,reached:0},ready:false,note:'<img src=x onerror=alert(1)>'};
  const practice={today:{completed:3,clean:1},queue:['p'],repeatQueue:['p'],due:1,mastered:0,puzzles:[],total:1,archive:[]};
  const html=learningViewHTML(report,practice);
  assert.match(html,/Повторить назначенные позиции/);assert.doesNotMatch(html,/data-action="practice-session" disabled/);assert.doesNotMatch(html,/<img/);
  const empty=learningViewHTML(report,{...practice,queue:[],repeatQueue:[],due:0});assert.match(empty,/data-action="practice-session" disabled/);
});
