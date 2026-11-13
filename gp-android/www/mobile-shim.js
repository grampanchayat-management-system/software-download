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
  /* फोटो + मेसेज थेट त्या नंबरच्या WhatsApp चॅटमध्ये (native WaSend plugin). नंबर नसेल / plugin नसेल / अयशस्वी → share sheet */
  function waSendImage(o){
    if(!P.Filesystem || !P.Share) return Promise.reject(new Error('हे फीचर फोनवर app मध्येच चालते.'));
    return P.Filesystem.writeFile({ path: 'export/' + o.filename, data: o.b64, directory: 'CACHE', recursive: true }).then(function(r){
      var phone = String(o.phone || '').replace(/\D/g, '');
      function shareSheet(reason){
        return P.Share.share({ title: o.title || o.filename, text: o.text || '', files: [r.uri], dialogTitle: 'WhatsApp निवडा' })
          .then(function(){ return { ok: true, hint: phone.length >= 10 ? ('📲 WhatsApp निवडा आणि ' + (o.name ? o.name + ' — ' : '') + phone + ' हा चॅट निवडा.' + (reason ? '\n[थेट चॅट न उघडण्याचे कारण: ' + reason + ']' : '')) : '' }; });
      }
      if(phone.length < 10) return shareSheet('नंबर बरोबर नाही: ' + (o.phone || 'रिकामा'));
      var WA = null, regErr = '';
      try{ WA = (C.registerPlugin ? C.registerPlugin('WaSend') : P.WaSend) || null; }catch(e){ WA = null; regErr = msgOf(e); }
      if(!WA || !WA.send) return shareSheet('WaSend plugin app मध्ये नाही ' + regErr);
      return WA.send({ phone: phone, text: o.text || '', fileUri: r.uri, mime: o.mime || 'image/jpeg' })
        .then(function(){ return { ok: true, hint: '✅ चॅट उघडला — फक्त WhatsApp मध्ये Send दाबा.' }; })
        .catch(function(e){ return isCancel(e) ? { ok: true } : shareSheet(msgOf(e)); });
    });
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
  /* पावतीचा फोटो — computer सारख्याच 720px रुंद मांडणीत.
     फोनच्या अरुंद स्क्रीनवर घेतला तर पावती उंच/अरुंद होते; म्हणून अदृश्य 820px रुंद चौकटीत प्रत्यक्ष layout करून फोटो घेतो. */
  function renderReceiptCanvas(win){
    var d = win.document;
    if(!d.getElementById('receipt')) return Promise.reject(new Error('पावती सापडली नाही'));
    if(typeof window.html2canvas !== 'function') return Promise.reject(new Error('html2canvas लोड झाले नाही'));
    var html = '<!DOCTYPE html>' + d.documentElement.outerHTML.replace(/<script[\s\S]*?<\/script>/gi, '');
    return new Promise(function(resolve, reject){
      var f = document.createElement('iframe');
      f.setAttribute('aria-hidden', 'true');
      f.style.cssText = 'position:fixed;left:-10000px;top:0;width:820px;height:1600px;border:0;pointer-events:none;';
      function done(){ if(f.parentNode) f.parentNode.removeChild(f); }
      f.onload = function(){
        var fd = f.contentDocument;
        Promise.resolve(fd.fonts && fd.fonts.ready)
          .then(function(){ return window.html2canvas(fd.getElementById('receipt'), { scale: 2.5, backgroundColor: '#ffffff', useCORS: true, logging: false }); })
          .then(function(c){ done(); resolve(c); }, function(e){ done(); reject(e); });
      };
      f.srcdoc = html;
      document.body.appendChild(f);
    });
  }
  function shareReceipt(win, text, phone, name){
    var no = (win.document.getElementById('receiptNo').textContent || 'pavati').trim().replace(/[^A-Za-z0-9_-]/g, '_');
    return renderReceiptCanvas(win).then(function(canvas){
      var b64 = canvas.toDataURL('image/png').split(',')[1];
      return waSendImage({ b64: b64, filename: no + '.png', mime: 'image/png', phone: phone || '', text: text || '', title: 'पावती ' + no, name: name || '' });
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
    overlay.style.cssText = 'position:fixed;left:0;top:0;right:0;bottom:0;z-index:99999;background:#eef2f8;display:flex;flex-direction:column;';
    var bar = document.createElement('div');
    bar.style.cssText = 'display:flex;align-items:center;gap:10px;padding:10px 12px;padding-top:calc(10px + env(safe-area-inset-top,0px));background:linear-gradient(115deg,#072a55,#0b3c78 55%,#1558ad);color:#fff;font-family:inherit;box-shadow:0 2px 10px rgba(7,42,85,.3);';
    bar.innerHTML =
      '<button id="rcBack" style="background:none;border:1px solid rgba(255,255,255,.45);color:#fff;border-radius:18px;padding:8px 14px;font-size:14px;font-weight:700">← मागे</button>' +
      '<div style="flex:1;font-weight:700;font-size:14px;color:#fff;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">🧾 ' + (rec.no || 'पावती') + '</div>' +
      '<button id="rcShare" style="background:#25D366;border:none;color:#04210f;border-radius:18px;padding:8px 14px;font-size:14px;font-weight:700">📤 शेअर / WhatsApp</button>';
    frame = document.createElement('iframe');
    frame.style.cssText = 'flex:1;border:0;width:100%;background:#eef2f8;';
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
      var mob = ((win.document.getElementById('fldMobile') || {}).textContent || rec.mobile || '').trim();
      shareReceipt(win, msg, mob, rec.name).then(function(res){ if(res && res.hint && window.gpToast) window.gpToast(res.hint); })
        .catch(function(e){ if(!isCancel(e)) alert('शेअर करता आले नाही: ' + msgOf(e)); });
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
    /* फॉर्म प्रतिसादातील "💬 WhatsApp" — त्या नंबरचा WhatsApp चॅट थेट उघडतो (फोटो + मेसेज भरून).
       native WaSend plugin नसेल/अयशस्वी झाला तर share sheet (जुनी पद्धत) वापरतो. */
    /* फक्त मजकूर (फोटो नाही) — त्या नंबरचा चॅट मेसेज भरून उघडतो; अयशस्वी झाल्यास wa.me */
    sendTextWhatsApp: function(payload){
      payload = payload || {};
      var phone = String(payload.mobile || '').replace(/\D/g, '');
      if(phone.length === 10) phone = '91' + phone;
      if(!phone) return Promise.resolve({ ok: false, error: 'मोबाईल नंबर नाही' });
      function viaBrowser(){
        var url = 'https://wa.me/' + phone + '?text=' + encodeURIComponent(payload.message || '');
        if(P.Browser && P.Browser.open) return P.Browser.open({ url: url }).then(function(){ return { ok: true, hint: '✅ चॅट उघडला — फक्त WhatsApp मध्ये Send दाबा.' }; });
        window.open(url, '_blank');
        return Promise.resolve({ ok: true });
      }
      var WA = null;
      try{ WA = (C.registerPlugin ? C.registerPlugin('WaSend') : P.WaSend) || null; }catch(e){ WA = null; }
      if(!WA || !WA.send) return viaBrowser().catch(function(e){ return { ok: false, error: msgOf(e) }; });
      return WA.send({ phone: phone, text: payload.message || '', fileUri: '' })
        .then(function(){ return { ok: true, hint: '✅ चॅट उघडला — फक्त WhatsApp मध्ये Send दाबा.' }; })
        .catch(function(){ return viaBrowser().catch(function(e){ return { ok: false, error: msgOf(e) }; }); });
    },
    /* "👁️ पहा" — त्या नंबरचा WhatsApp चॅट उघडतो (आधीचे मेसेज व रिप्लाय दिसतात) */
    openWhatsAppChat: function(payload){
      payload = payload || {};
      var phone = String(payload.mobile || '').replace(/\D/g, '');
      if(phone.length === 10) phone = '91' + phone;
      if(!phone) return Promise.resolve({ ok: false, error: 'मोबाईल नंबर नाही' });
      function viaBrowser(){
        var url = 'https://wa.me/' + phone;
        if(P.Browser && P.Browser.open) return P.Browser.open({ url: url }).then(function(){ return { ok: true }; });
        window.open(url, '_blank');
        return Promise.resolve({ ok: true });
      }
      var WA = null;
      try{ WA = (C.registerPlugin ? C.registerPlugin('WaSend') : P.WaSend) || null; }catch(e){ WA = null; }
      if(!WA || !WA.openChat) return viaBrowser().catch(function(e){ return { ok: false, error: msgOf(e) }; });
      return WA.openChat({ phone: phone })
        .then(function(){ return { ok: true }; })
        .catch(function(){ return viaBrowser().catch(function(e){ return { ok: false, error: msgOf(e) }; }); });
    },
    sendFlyerWhatsApp: function(payload){
      payload = payload || {};
      return fetch('gp-flyer.jpg')
        .then(function(r){ if(!r.ok) throw new Error('फोटो सापडला नाही'); return r.blob(); })
        .then(function(blob){
          return new Promise(function(resolve, reject){
            var fr = new FileReader();
            fr.onload = function(){ resolve(String(fr.result).split(',')[1]); };
            fr.onerror = function(){ reject(new Error('फोटो वाचता आला नाही')); };
            fr.readAsDataURL(blob);
          });
        })
        .then(function(b64){
          return waSendImage({ b64: b64, filename: 'gp-software.jpg', mime: 'image/jpeg', phone: payload.mobile, text: payload.message || '', title: 'ग्रामपंचायत सॉफ्टवेअर', name: payload.name });
        })
        .catch(function(e){ return isCancel(e) ? { ok: true } : { ok: false, error: msgOf(e) }; });
    },
    sendWhatsApp: function(payload){
      var win = frame && frame.contentWindow;
      if(!win) return Promise.resolve({ ok: false, error: 'पावती उघडलेली नाही' });
      payload = payload || {};
      return shareReceipt(win, payload.message || '', payload.mobile || '', '')
        .then(function(res){ return res || { ok: true }; })
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
    var sub = document.querySelector('header .sub');
    if(sub) sub.textContent += ' · आवृत्ती v19 (पेमेंट नोंदवा)';   // नवीन APK install झाला आहे का हे ओळखण्यासाठी
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
