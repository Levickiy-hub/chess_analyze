import { Chess } from 'chess.js';
// Small original reference set, not a claim of exhaustive opening theory.
const LINES=[
 ['B20','Сицилианская защита','1. e4 c5'],['B01','Скандинавская защита','1. e4 d5'],
 ['B10','Защита Каро — Канн','1. e4 c6'],['C00','Французская защита','1. e4 e6'],
 ['C20','Открытая игра','1. e4 e5'],['C40','Дебют королевского коня','1. e4 e5 2. Nf3'],
 ['C50','Итальянская партия','1. e4 e5 2. Nf3 Nc6 3. Bc4'],
 ['C60','Испанская партия','1. e4 e5 2. Nf3 Nc6 3. Bb5'],
 ['C44','Шотландская партия','1. e4 e5 2. Nf3 Nc6 3. d4'],
 ['C41','Защита Филидора','1. e4 e5 2. Nf3 d6'],['C42','Русская партия','1. e4 e5 2. Nf3 Nf6'],
 ['D00','Дебют ферзевых пешек','1. d4 d5'],['D06','Ферзевый гамбит','1. d4 d5 2. c4'],
 ['D02','Лондонская система · схема','1. d4 d5 2. Nf3 Nf6 3. Bf4'],
 ['A10','Английское начало','1. c4'],['A04','Дебют Рети','1. Nf3'],
 ['B07','Защита Пирца — Уфимцева','1. e4 d6 2. d4 Nf6'],
 ['E60','Староиндийская защита','1. d4 Nf6 2. c4 g6'],
];
const key=fen=>fen.split(' ').slice(0,4).join(' ');
const BOOK=new Map(LINES.map(([eco,name,pgn])=>{const c=new Chess();c.loadPgn(pgn+' *');return [key(c.fen()),{eco,name,plies:c.history().length}];}));
export function identifyOpening(moves){let match=null;for(const m of moves.slice(0,30)){const found=BOOK.get(key(m.after));if(found)match=found;}return match;}
