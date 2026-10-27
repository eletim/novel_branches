import { randomBytes } from 'node:crypto';
import { Store } from '../src/store.mjs';
const store = new Store();
try {
  if(store.db.prepare('SELECT 1 FROM stories LIMIT 1').get()) throw Error('作品があるためサンプルを追加しません。');
  const a = store.addUser('sample-author','サンプル作者',randomBytes(32).toString('hex'));
  const b = store.addUser('sample-branch','サンプル分岐作者',randomBytes(32).toString('hex'));
  const root = store.createStory(a.id,{title:'夜明けを待つ図書館',summary:'夜になると、まだ書かれていない本が届く。図書館で働く少女が見つけたのは、自分の明日の物語だった。\nこれは操作を試すためのサンプル作品です。',chapterTitle:'まだ白い最後のページ',body:'閉館の鐘が鳴ったとき、返却箱の底で、一冊の本が光っていた。\n\n「返却期限、明日？」\n\n栞は表紙を撫でた。そこには確かに、自分の名前が書かれている。開いたページに、今しがた口にした言葉が、ゆっくり浮かび上がった。\n\n最後のページだけが白かった。\n\n窓の向こうには、東へ続く橋と、西へ下る階段が見えた。'});
  store.append(a.id,root.branchId,{expectedHeadId:root.chapterId,title:'東の橋へ',body:'栞は本を鞄に入れ、橋へ向かった。\n\n夜明けまでに、この本の書き手に会いたかった。橋の中央に、同じ本を持つ少年が立っていた。\n\n「君の本も、最後は白い？」'});
  store.fork(b.id,root.chapterId,{branchTitle:'西の階段の世界',title:'階段の下の朝',body:'栞は西の階段を選んだ。\n\n一段降りるたび、本の文字が一行ずつ消えていく。いちばん下まで着いたとき、表紙の名前も消えていた。\n\n「これで、好きに書ける」\n\n誰かがそう言った。声は、栞自身のものだった。'});
  console.log('サンプル作品と2つの展開を追加しました。サンプル作者のログイン用パスワードは発行しません。');
} catch(e) {console.error(e.message);process.exitCode=1;} finally {store.close();}
