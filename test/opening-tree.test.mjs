import test from 'node:test';
import assert from 'node:assert/strict';
import { openingMoveLabel, openingTreeDiagram } from '../public/opening-tree.mjs';

const node=(san,games,wins,children={})=>({san,games,wins,children});
const root=node('Начальная позиция',10,5,{
  d2d4:node('d4',3,1),
  e2e4:node('e4',6,4,{e7e5:node('e5',4,3),c7c5:node('c5',2,1)}),
  c2c4:node('c4',1,0),
});

test('opening diagram shows real branches ordered by frequency and own win rates',()=>{
  const html=openingTreeDiagram(root);
  assert.ok(html.indexOf('1. e4')<html.indexOf('1. d4'));
  assert.match(html,/66,7% побед/);assert.match(html,/data-tree-path="e2e4 e7e5"/);
  assert.match(html,/1… e5/);assert.match(html,/class="opening-node winning/);
  assert.match(html,/class="opening-node losing/);assert.match(html,/Другие ходы: 1/);
  assert.equal((html.match(/class="opening-node /g)??[]).length,5);
});

test('depth, subtree paths and move numbering remain correct',()=>{
  const html=openingTreeDiagram(root.children.e2e4,{path:['e2e4'],depth:1});
  assert.match(html,/aria-current="step"/);assert.match(html,/data-tree-path="e2e4 c7c5"/);
  assert.equal(openingMoveLabel('Nf3',3),'2. Nf3');
  assert.equal(openingMoveLabel('Nc6',4),'2… Nc6');
  assert.doesNotMatch(openingTreeDiagram(root,{depth:1}),/data-tree-path="e2e4 e7e5"/);
});

test('diagram escapes imported move names and handles an empty sample',()=>{
  const html=openingTreeDiagram(node('<img src=x onerror=alert(1)>',1,0),{path:['e2e4']});
  assert.doesNotMatch(html,/<img/);assert.match(html,/&lt;img/);
  assert.match(openingTreeDiagram(node('',0,0)),/Нет партий/);
});

test('depth and breadth are bounded even for a large opening trie',()=>{
  const make=depth=>node('a3',10,5,depth?Object.fromEntries(Array.from({length:8},(_,i)=>['key'+i,make(depth-1)])):{});
  const html=openingTreeDiagram(make(4),{depth:3,branches:4});
  assert.equal((html.match(/class="opening-node /g)??[]).length,85);
});
