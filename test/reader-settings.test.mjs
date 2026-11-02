import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_READER_SETTINGS,normalizeReaderSettings,loadReaderSettings,saveReaderSettings,READER_SETTINGS_KEY} from '../public/reader-settings.mjs';
test('読書設定は許可した値のみ使い、壊れた保存値やCSS入力を初期設定へ戻す',()=>{
 for(const value of [null,[],true,'dark',{font:'url(evil)',theme:'<script>',size:1000}])assert.deepEqual(normalizeReaderSettings(value),DEFAULT_READER_SETTINGS);
 assert.deepEqual(normalizeReaderSettings({font:'mincho',theme:'dark',size:28,extra:'ignored'}),{font:'mincho',theme:'dark',size:28});
 assert.deepEqual(loadReaderSettings({getItem(){return '{broken';}}),DEFAULT_READER_SETTINGS);
 assert.deepEqual(loadReaderSettings({getItem(){throw Error('blocked');}}),DEFAULT_READER_SETTINGS);
});
test('読書設定を独立したブラウザキーへ保存し、保存不可でも例外にしない',()=>{
 const values=new Map(),storage={getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v)};
 assert.equal(saveReaderSettings({font:'mincho',theme:'white',size:24},storage),true);assert.equal(values.size,1);assert.ok(values.has(READER_SETTINGS_KEY));assert.deepEqual(loadReaderSettings(storage),{font:'mincho',theme:'white',size:24});
 assert.equal(saveReaderSettings(DEFAULT_READER_SETTINGS,storage),true);assert.deepEqual(loadReaderSettings(storage),DEFAULT_READER_SETTINGS);
 assert.equal(saveReaderSettings(DEFAULT_READER_SETTINGS,{setItem(){throw Error('quota');}}),false);
});

test('旧v1設定のフォントと色を保持し、旧20pxを大24pxへ移す',()=>{
 for(const size of [16,18,24,28])assert.deepEqual(normalizeReaderSettings({font:'mincho',theme:'dark',size}),{font:'mincho',theme:'dark',size});
 assert.deepEqual(normalizeReaderSettings({font:'gothic',theme:'white',size:20}),{font:'gothic',theme:'white',size:24});
 assert.deepEqual(loadReaderSettings({getItem(){return JSON.stringify({font:'mincho',theme:'paper',size:20});}}),{font:'mincho',theme:'paper',size:24});
 assert.deepEqual(normalizeReaderSettings({font:'meiryo',theme:'blue',size:24}),{font:'meiryo',theme:'blue',size:24});
});
