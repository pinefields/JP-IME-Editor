/* speech.js — 音声入力 (Web Speech API) をエディタに接続する
 *
 *  - ブラウザの SpeechRecognition(Chrome / Edge / Safari) で日本語を連続認識し、認識途中の文字列(interim)は
 *    IME の未確定文字と同じ見た目でカーソル位置に表示、確定(isFinal)した文字列はカーソル位置に挿入する。
 *  - 認識方式:  local = 端末内でのみ認識(processLocally。音声を外部に送らない。Chrome 139 以降・言語パック要)
 *              auto  = 端末内認識が使えればそれを使い、無ければクラウド認識
 *              cloud = クラウド認識(Chrome: Google、Edge: Microsoft、Safari: Apple のサーバーに音声が送られる)
 *  - 認識結果の後処理: 音声コマンド(かいぎょう/まる/てん)、句読点・数字・カタカナの IME 設定への追従。
 *  - 誤認識(同音語)は、文字列を選択して [変換] キー(または Ctrl+Alt+R)で内蔵 IME で再変換できる(editor.js 側)。
 */
const Speech = {
  ed: null, rec: null, on: false, interim: '', restartTimer: null, usingLocal: false, soundOn: false, statusText: '',
  langs: ['ja-JP'],

  get SR() { return window.SpeechRecognition || window.webkitSpeechRecognition || null; },
  supported() { return !!this.SR; },

  /** 端末内認識の状態: 'available' | 'downloadable' | 'downloading' | 'unavailable' | 'unsupported'(API が古い) */
  async localStatus() {
    const SR = this.SR;
    if (!SR || typeof SR.available !== 'function') return 'unsupported';
    try { return await SR.available({ langs: this.langs, processLocally: true }); } catch (e) { return 'unavailable'; }
  },
  /** 端末内認識の言語パックをインストールする(ユーザー操作から呼ぶこと) */
  async installLocal() {
    const SR = this.SR;
    if (!SR || typeof SR.install !== 'function') return false;
    try { return await SR.install({ langs: this.langs, processLocally: true }); } catch (e) { return false; }
  },

  async toggle(ed) { if (this.on) this.stop(); else await this.start(ed); },

  async start(ed) {
    this.ed = ed;
    if (!this.supported()) { ed.flash('このブラウザは音声認識(Web Speech API)に対応していません (Chrome / Edge を使ってください)'); return false; }
    const mode = Settings.data.speechMode || 'local';
    let local = false;
    if (mode === 'local' || mode === 'auto') {
      const st = await this.localStatus();
      if (st === 'available') local = true;
      else if (mode === 'local') {
        if (st === 'downloadable' || st === 'downloading') {
          ed.flash(st === 'downloading' ? '端末内認識の言語パックをダウンロード中です。しばらく待ってからもう一度どうぞ' : '端末内認識の言語パックが未インストールです。動作環境→音声入力 の「インストール」を押してください');
        } else {
          ed.flash('このブラウザでは端末内(オフライン)の日本語音声認識が使えません。動作環境→音声入力 で認識方式を変更できます');
        }
        return false;
      }
    }
    this.usingLocal = local;
    const SR = this.SR;
    const rec = new SR();
    rec.lang = this.langs[0];
    rec.continuous = Settings.data.speechContinuous !== false;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    try { rec.processLocally = local; } catch (e) {}
    rec.onresult = (ev) => this._onResult(ev);
    rec.onerror = (ev) => this._onError(ev);
    rec.onend = () => this._onEnd();
    rec.onsoundstart = () => { this.soundOn = true; this._status(); };
    rec.onsoundend = () => { this.soundOn = false; this._status(); };
    rec.onstart = () => { this.statusText = local ? '端末内認識' : 'クラウド認識'; this._status(); };
    this.rec = rec; this.on = true; this.interim = '';
    try { rec.start(); } catch (e) { this.on = false; this.rec = null; ed.flash('音声認識を開始できません: ' + e.message); this._status(); return false; }
    ed.flash(local ? '音声入力 ON (端末内認識: 音声は外部に送られません)' : '音声入力 ON (クラウド認識: 音声がブラウザ提供元のサーバーに送られます)');
    this._status();
    return true;
  },

  stop(silent) {
    this.on = false;
    clearTimeout(this.restartTimer); this.restartTimer = null;
    if (this.rec) { try { this.rec.onend = null; this.rec.stop(); } catch (e) {} this.rec = null; }
    this._setInterim('');
    this.soundOn = false; this.statusText = '';
    if (!silent && this.ed) this.ed.flash('音声入力 OFF');
    this._status();
  },

  _onResult(ev) {
    let finalText = '', interim = '';
    for (let i = ev.resultIndex; i < ev.results.length; i++) {
      const r = ev.results[i];
      if (r.isFinal) finalText += r[0].transcript; else interim += r[0].transcript;
    }
    if (finalText) {
      const t = this.postprocess(finalText);
      this._setInterim('');
      if (t) this.ed.insertSpeech(t);
    }
    this._setInterim(interim ? this.cleanup(interim) : '');
  },
  _onError(ev) {
    const e = ev.error;
    if (e === 'no-speech' || e === 'aborted') return;        // 無音・中断は自動再開に任せる
    const msg = {
      'not-allowed': 'マイクの使用が許可されていません(アドレスバーのマイク許可を確認。file:// で許可できない場合は http://localhost で開いてください)',
      'service-not-allowed': '音声認識サービスの利用が許可されていません',
      'audio-capture': 'マイクが見つかりません',
      'network': 'ネットワークエラー(クラウド認識はインターネット接続が必要です)',
      'language-not-supported': '端末内認識の日本語言語パックがありません(動作環境→音声入力 でインストール)',
    }[e] || ('音声認識エラー: ' + e);
    this.ed.flash(msg);
    if (e === 'not-allowed' || e === 'service-not-allowed' || e === 'audio-capture' || e === 'language-not-supported') this.stop(true);
  },
  _onEnd() {
    // 連続認識でも無音が続くと止まるので、ON の間は自動で再開する
    if (!this.on) return;
    this._setInterim('');
    clearTimeout(this.restartTimer);
    this.restartTimer = setTimeout(() => { if (this.on && this.rec) { try { this.rec.start(); } catch (e) {} } }, 250);
  },
  _setInterim(t) { if (this.interim === t) return; this.interim = t; if (this.ed) this.ed.render(); },
  _status() { if (this.ed) this.ed.renderStatus(); },

  /** 認識文字列の整形(途中表示にも使う): 日本語間の空白を除去 */
  cleanup(t) {
    return t.replace(/([^\x20-\x7e])\s+(?=[^\x20-\x7e])/g, '$1').replace(/^\s+/, '');
  },
  /** 確定文字列の後処理: 音声コマンド、句読点・数字・カタカナを IME の既定設定に合わせる */
  postprocess(t) {
    const d = Settings.data;
    t = this.cleanup(t);
    if (d.speechCommands !== false) {
      t = t.replace(/(改行|かいぎょう)/g, '\n')
           .replace(/(まる|丸|句点|くてん)$/, '。')
           .replace(/(てん|点|読点|とうてん)$/, '、')
           .replace(/(スペース|すぺーす)$/, d.spaceZen ? '　' : ' ');
    }
    if (d.speechKuten && t && !/[。．.！？!?、\n]$/.test(t)) t += '。';
    // 句読点の種類を IME 設定に合わせる
    if (d.kuten && d.kuten !== '。') t = t.replace(/。/g, d.kuten);
    if (d.touten && d.touten !== '、') t = t.replace(/、/g, d.touten);
    if (d.digitsZen) t = t.replace(/[0-9]/g, c => String.fromCharCode(c.charCodeAt(0) + 0xFEE0));
    if (d.kataHankaku && typeof JP !== 'undefined') t = JP.kataToHankaku(t);
    return t;
  },
};
