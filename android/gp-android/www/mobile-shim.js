/* ============================================================
   GP Software — Android (Capacitor) जोडणी
   Computer च्या software मधील Electron-आधारित भाग फोनसाठी:
   • Google Sheet वाचणे  • पावती दाखवणे/शेअर (WhatsApp)  • CSV/Backup export
   • LICENSE_SECRET कोडात नाही — एकदा टाकल्यावर फक्त या फोनवर साठवला जातो
   ============================================================ */
(function(){
  'use strict';
  var C = window.Capacitor || {};
  var P = C.Plugins || {};
  function $(id){ return document.getElementById(id); }
  function msgOf(e){ return (e && e.message) ? e.message : String(e); }
  function isCancel(e){ return /cancel|dismiss/i.test(msgOf(e)); }

  /* ---------- 1) LICENSE_SECRET ---------- */
  var LS_SECRET = 'gp_license_secret';
  window.getSecret = function(){
    var el = $('secretInput');
    var v = (el && el.value || '').trim();
    return v || localStorage.getItem(LS_SECRET) || '';
  };
  var _gen = window.generateKeys;
  if(typeof _gen === 'function'){
    window.generateKeys = function(){
      if(!window.getSecret()){
        alert('आधी LICENSE_SECRET टाका (Key Generator टॅब → Secret Key Configuration).\nComputer वरच्या Key Generator मधून तो copy करा. एकदा टाकला की या फोनवर साठवला जातो.');
        return;
      }
      return _gen.apply(this, arguments);
    };
  }

  /* ---------- 2) Google Sheet (CORS ची अडचण नको म्हणून native HTTP) ---------- */
  function fetchSheetCsv(url){
    var H = P.CapacitorHttp;
    if(!H){
      return fetch(url).then(function(r){
        return r.ok ? r.text().then(function(t){ return { ok: true, text: t }; }) : { ok: false, error: 'HTTP ' + r.status };
      }).catch(function(e){ return { ok: false, error: msgOf(e) }; });
    }
    return H.get({ url: url, responseType: 'text', headers: { 'Accept': 'text/csv,text/plain,*/*' } })
      .then(function(r){
        if(r.status !== 200) return { ok: false, error: 'HTTP ' + r.status };
        return { ok: true, text: typeof r.data === 'string' ? r.data : String(r.data) };
      })
      .catch(function(e){ return { ok: false, error: msgOf(e) }; });
  }

  /* ---------- 3) फाईल save / share ---------- */
  function b64utf8(s){ return btoa(unescape(encodeURIComponent(s))); }
  function saveAndShare(filename, b64, title, text){
    if(!P.Filesystem || !P.Share) return Promise.reject(new Error('हे फीचर फोनवर app मध्येच चालते.'));
    return P.Filesystem.writeFile({ path: 'export/' + filename, data: b64, directory: 'CACHE', recursive: true })
      .then(function(r){ return P.Share.share({ title: title || filename, text: text || '', files: [r.uri], dialogTitle: 'सेव्ह / शेअर करा' }); });
  }
  window.downloadFile = function(content, filename){
    saveAndShare(filename, b64utf8(content), filename).catch(function(e){
      if(!isCancel(e)) alert('फाईल तयार करता आली नाही: ' + msgOf(e));
    });
  };

  /* ---------- 4) पावती (pavati.html) ---------- */
  var overlay = null, frame = null;
  function toDDMMYYYY(s){
    s = String(s || '').trim();
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
    return m ? m[3] + '/' + m[2] + '/' + m[1] : s;
  }
  function shareReceipt(win, text){
    var d = win.document, el = d.getElementById('receipt');
    if(!el) return Promise.reject(new Error('पावती सापडली नाही'));
    if(typeof window.html2canvas !== 'function') return Promise.reject(new Error('html2canvas लोड झाले नाही'));
    var no = (d.getElementById('receiptNo').textContent || 'pavati').trim().replace(/[^A-Za-z0-9_-]/g, '_');
    win.scrollTo(0, 0);
    return Promise.resolve(d.fonts && d.fonts.ready)
      .then(function(){ return window.html2canvas(el, { scale: 3, backgroundColor: '#ffffff', useCORS: true, logging: false }); })
      .then(function(canvas){
        var b64 = canvas.toDataURL('image/png').split(',')[1];
        return saveAndShare(no + '.png', b64, 'पावती ' + no, text || '');
      });
  }
  function closeReceipt(){
    if(overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
    overlay = null; frame = null;
    document.body.style.overflow = '';
  }
  function fillReceipt(win, rec){
    var d = win.document;
    function set(id, v){ var e = d.getElementById(id); if(e) e.textContent = (v == null ? '' : String(v)); }
    set('receiptNo', rec.no);
    set('fldDate', toDDMMYYYY(rec.date));
    set('fldName', rec.name); set('fldVillage', rec.village); set('fldTaluka', rec.taluka); set('fldJilha', rec.jilha);
    set('fldMobile', rec.mobile); set('fldTotal', rec.amount);
    var amt = Number(rec.amount) || 0;
    set('fldTotalWords', typeof win.amountInMarathiWords === 'function' ? win.amountInMarathiWords(amt) : '');
    set('fldPayType', rec.payType);
    if(typeof win.saveCurrentReceipt === 'function') win.saveCurrentReceipt();   // रिकामी पावती जतन होत नाही
  }
  function openReceipt(rec){
    rec = rec || {};
    closeReceipt();
    overlay = document.createElement('div');
    overlay.id = 'rcOverlay';
    overlay.style.cssText = 'position:fixed;left:0;top:0;right:0;bottom:0;z-index:99999;background:#e9e4d6;display:flex;flex-direction:column;';
    var bar = document.createElement('div');
    bar.style.cssText = 'display:flex;align-items:center;gap:10px;padding:10px 12px;padding-top:calc(10px + env(safe-area-inset-top,0px));background:#16213e;color:#fff;font-family:inherit;';
    bar.innerHTML =
      '<button id="rcBack" style="background:none;border:1px solid #0f3460;color:#fff;border-radius:18px;padding:8px 14px;font-size:14px;font-weight:700">← मागे</button>' +
      '<div style="flex:1;font-weight:700;font-size:14px;color:#ffd700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">🧾 ' + (rec.no || 'पावती') + '</div>' +
      '<button id="rcShare" style="background:#25D366;border:none;color:#04210f;border-radius:18px;padding:8px 14px;font-size:14px;font-weight:700">📤 शेअर / WhatsApp</button>';
    frame = document.createElement('iframe');
    frame.style.cssText = 'flex:1;border:0;width:100%;background:#e9e4d6;';
    frame.setAttribute('title', 'पावती');
    frame.onload = function(){
      var win = frame && frame.contentWindow;
      if(!win) return;
      win.gpBridge = window.gpBridge;                       // पावती पानातील WhatsApp बटणासाठी
      win.print = function(){ shareReceipt(win, '').catch(function(e){ if(!isCancel(e)) alert('पावती तयार करता आली नाही: ' + msgOf(e)); }); };
      fillReceipt(win, rec);
    };
    frame.src = 'pavati.html';
    overlay.appendChild(bar); overlay.appendChild(frame);
    document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden';
    $('rcBack').onclick = closeReceipt;
    $('rcShare').onclick = function(){
      var win = frame && frame.contentWindow; if(!win) return;
      var msg = 'नमस्कार ' + (rec.name || '') + ',\nआपली पावती क्र. ' + (rec.no || '') + ' रक्कम ₹' + (rec.amount || '') + ' साठी सोबत जोडत आहे. धन्यवाद — ग्रामपंचायत सॉफ्टवेअर.';
      shareReceipt(win, msg).catch(function(e){ if(!isCancel(e)) alert('शेअर करता आले नाही: ' + msgOf(e)); });
    };
  }
  window.openBlankReceipt = function(){
    var n = typeof nextReceiptPreview === 'function' ? nextReceiptPreview() : '';
    var t = new Date().toISOString().slice(0, 10);
    openReceipt({ no: n, date: t });
  };

  /* पावती पानातील "WhatsApp" बटण — फोनवर share sheet उघडतो */
  window.gpBridge = {
    fetchSheetCsv: fetchSheetCsv,
    printReceipt: function(rec){ openReceipt(rec); },
    sendWhatsApp: function(payload){
      var win = frame && frame.contentWindow;
      if(!win) return Promise.resolve({ ok: false, error: 'पावती उघडलेली नाही' });
      return shareReceipt(win, payload && payload.message || '')
        .then(function(){ return { ok: true }; })
        .catch(function(e){ return isCancel(e) ? { ok: true } : { ok: false, error: msgOf(e) }; });
    }
  };

  /* ---------- 5) Android back बटण + बाहेरच्या links ---------- */
  if(P.App && P.App.addListener){
    P.App.addListener('backButton', function(){
      if(overlay){ closeReceipt(); return; }
      var act = document.querySelector('#tabNav button.active');
      if(act && act.getAttribute('data-tab') !== 'dash' && typeof switchTab === 'function'){ switchTab('dash'); return; }
      if(P.App.exitApp) P.App.exitApp();
    });
  }
  document.addEventListener('click', function(e){
    var a = e.target && e.target.closest ? e.target.closest('a[target="_blank"]') : null;
    if(!a) return;
    var href = a.getAttribute('href') || '';
    if(!/^https?:/i.test(href)){ e.preventDefault(); return; }
    if(P.Browser && P.Browser.open){ e.preventDefault(); P.Browser.open({ url: href }); }
  }, true);

  /* ---------- 6) सुरुवात ---------- */
  function start(){
    var app = $('app'); if(app) app.style.display = 'block';   // computer प्रमाणे — पासवर्ड नाही; खरे संरक्षण = Cloud लॉगिन
    if(typeof initAll === 'function') initAll();
    var s = $('secretInput');
    if(s){
      s.value = localStorage.getItem(LS_SECRET) || '';
      s.addEventListener('input', function(){ localStorage.setItem(LS_SECRET, s.value.trim()); });
    }
    if(window.CloudSync){
      window.CloudSync.onLoggedOut = function(){ if(typeof switchTab === 'function') switchTab('settings'); };
    }
  }
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
