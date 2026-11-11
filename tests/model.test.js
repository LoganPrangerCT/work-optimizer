import test from 'node:test';
import assert from 'node:assert/strict';
import {parseDuration,duration} from '../public/model.js';
test('duration accepts explicit units and rejects invalid input',()=>{assert.equal(parseDuration('2 hours'),120);assert.equal(parseDuration('1.5 h'),90);assert.equal(parseDuration('45 min'),45);assert.equal(parseDuration('30'),30);for(const value of ['-2','0','2 days','abc','25 h'])assert.equal(parseDuration(value),null);assert.equal(duration(145),'2h 25m');});
