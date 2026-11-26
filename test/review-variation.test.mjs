import test from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from 'chess.js';
import { normalizeGame } from '../app/domain.mjs';
import { ReviewTree } from '../public/review-tree.mjs';
import { positionRequest } from '../app/position-request.mjs';

const game=(moves='1. e4 e5 2. Nf3 Nc6 *',headers='')=>normalizeGame({pgn:'[White "tester"]\n[Black "opponent"]\n'+headers+'\n'+moves},'tester');

test('alternative line keeps its own history and never changes the source game',()=>{
 const g=game(),original=JSON.stringify(g),tree=new ReviewTree(g,Chess,2);
 const origin=tree.cursor;tree.play('f1c4');tree.play('g8f6');const end=tree.cursor;
 assert.equal(tree.current.san,'Nf6');assert.equal(tree.current.original,false);
 tree.previous();assert.equal(tree.current.san,'Bc4');tree.next();assert.equal(tree.cursor,end);
 const request=tree.request();assert.deepEqual(request.moves,['e2e4','e7e5','f1c4','g8f6']);assert.equal(positionRequest(request).fen,tree.current.fen);
 tree.returnToGame();assert.equal(tree.cursor,origin);tree.next();assert.equal(tree.current.san,'Nf3');
 assert.equal(JSON.stringify(g),original);assert.equal(tree.leaves().length,1);
});

test('multiple sibling branches can be revisited without losing either line',()=>{
 const tree=new ReviewTree(game(),Chess,1);tree.play('c7c5');const sicilian=tree.cursor;
 tree.previous();tree.play('c7c6');const caro=tree.cursor;assert.notEqual(sicilian,caro);assert.equal(tree.leaves().length,2);
 tree.go(sicilian);tree.previous();tree.next();assert.equal(tree.cursor,sicilian);
 tree.goMain(1);tree.returnToGame();tree.next();assert.equal(tree.current.san,'e5');
});

test('local persistence restores legal branches and ignores malformed data',()=>{
 const g=game(),tree=new ReviewTree(g,Chess,2);tree.play('d2d4');tree.play('e5d4');
 const saved=JSON.parse(JSON.stringify(tree.serialize())),restored=new ReviewTree(g,Chess,2);restored.restore(saved);
 assert.equal(restored.current.mainPly,2);assert.equal(restored.leaves().length,1);assert.equal(restored.leaves()[0].fen,tree.current.fen);
 restored.next();assert.equal(restored.current.san,'Nf3');
 const clean=new ReviewTree(g,Chess);clean.restore({version:1,lines:[['e2e5'],['<script>']]});assert.equal(clean.leaves().length,0);
});

test('invalid moves and invalid PVs do not leave partially changed trees',()=>{
 const tree=new ReviewTree(game(),Chess),before=tree.current.fen,size=tree.nodes.size;
 assert.throws(()=>tree.play('e2e5'));assert.equal(tree.current.fen,before);
 assert.throws(()=>tree.playLine(['d2d4','e7e9']));assert.equal(tree.current.fen,before);assert.equal(tree.nodes.size,size);
});

test('castling, en passant and promotion survive branch navigation',()=>{
 const castle=new ReviewTree(game('1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 *'),Chess,6);castle.play('e1g1');assert.equal(castle.board().get('f1').type,'r');const castled=castle.current.fen;castle.previous();castle.next();assert.equal(castle.current.fen,castled);
 const ep=new ReviewTree(game('1. e4 a6 2. e5 d5 *'),Chess,4);ep.play('e5d6');assert.equal(ep.board().get('d5'),undefined);assert.equal(ep.board().get('d6').type,'p');
 const promote=new ReviewTree(game('*','[SetUp "1"]\n[FEN "k7/4P3/8/8/8/8/8/7K w - - 0 1"]\n'),Chess);promote.play('e7e8n');assert.equal(promote.board().get('e8').type,'n');promote.previous();promote.next();assert.equal(promote.board().get('e8').type,'n');
});

test('PGN export represents current hypothetical line and respects initial FEN and turn',()=>{
 const g=game('1. e4 e5 2. Nf3 Nc6 1-0'),tree=new ReviewTree(g,Chess,2);tree.play('d2d4');
 const board=new Chess();board.loadPgn(tree.pgn());assert.deepEqual(board.history(),['e4','e5','d4']);assert.equal(board.getHeaders().Result,'*');assert.equal(g.headers.Result,'1-0');
 const custom=game('20... Kf7 *','[SetUp "1"]\n[FEN "4k3/8/8/8/8/8/4P3/4K3 b - - 0 20"]\n'),line=new ReviewTree(custom,Chess);line.play('e8d7');
 const replay=new Chess();replay.loadPgn(line.pgn());assert.equal(replay.getHeaders().FEN,custom.initialFen);assert.equal(replay.history()[0],'Kd7');assert.equal(replay.fen(),line.current.fen);
});

test('repetition history is retained, with optional claims and mandatory draws distinguished',()=>{
 const tree=new ReviewTree(game('*'),Chess),cycle=['g1f3','g8f6','f3g1','f6g8'];
 tree.playLine([...cycle,...cycle]);assert.equal(tree.status().terminal,false);assert.match(tree.status().text,/заявка на ничью/);
 tree.playLine([...cycle,...cycle]);assert.equal(tree.status().terminal,true);assert.match(tree.status().text,/пятикратное/);assert.throws(()=>tree.play('e2e4'),/завершён/);
 assert.equal(tree.request().moves.length,16);
});

test('position API input validates complete history before engine execution',()=>{
 const board=new Chess();board.move('e4');const request={fen:board.fen(),initialFen:new Chess().fen(),moves:['e2e4']};
 assert.equal(positionRequest(request).fen,board.fen());assert.equal(positionRequest({fen:board.fen()}).fen,board.fen());
 assert.throws(()=>positionRequest({...request,moves:['d2d4']}),/не соответствует/);
 assert.throws(()=>positionRequest({...request,moves:['e2e5']}));
 assert.throws(()=>positionRequest({...request,moves:Array(2049).fill('e2e4')}));
 assert.throws(()=>positionRequest({fen:board.fen(),moves:['e2e4']}),/начальная FEN/);
});
