/* ============================================================
   GP Cloud Sync — Computer ↔ Mobile live sync (Firebase)
   ------------------------------------------------------------
   • पावत्या (receipts), Product Keys, पावती क्रमांक (counter) आणि Sheet links
     सगळ्या डिव्हाइसवर एकत्र राहतात.
   • Offline-first: इंटरनेट नसताना software आधीसारखाच चालतो; नेट आल्यावर आपोआप sync.
   • Cloud collections: receipts/{no}, productKeys/{key}, meta/counters, meta/cpConfig
   ============================================================ */
(function(){
  'use strict';

  var FB_CONFIG = {
    apiKey: "AIzaSyAu0fXj2aRVW0G1sx7hxMdFh44M7DHTjUk",
    authDomain: "gp-software-live.firebaseapp.com",
    projectId: "gp-software-live",
    storageBucket: "gp-software-live.firebasestorage.app",
    messagingSenderId: "671771279337",
    appId: "1:671771279337:web:9b3d90c477fe73e4271578"
  };

  var COL_R = 'receipts', COL_K = 'productKeys';
  var LS_EPOCH_R = 'gp_cloud_epoch_r', LS_EPOCH_K = 'gp_cloud_epoch_k', LS_CONFLICTS = 'gp_cloud_conflicts';
  var ALLOCATE_TIMEOUT_MS = 5000;

  var isNative = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  var CS = window.CloudSync = { source: isNative ? 'mobile' : 'desktop', user: null, status: 'off' };

  var db = null, auth = null, FV = null;
  var unsubs = [];
  var wiping = false, busyAdd = false, processingConflicts = false, bumping = false;
  var pushed = {};   // या session मध्ये आधीच पाठवलेल्या नोंदी (पुन्हा पाठवू नये म्हणून)
  var cloud = { rawR: null, rawK: null, receipts: null, keys: null, counters: null, rServer: false, kServer: false, epochOk: false };

  function $(id){ return document.getElementById(id); }
  function g(name){ return window[name]; }

  /* ---------- helpers ---------- */
  function cleanDoc(o){
    var c = {};
    Object.keys(o || {}).forEach(function(k){ if(k !== 'updatedAt' && k !== 'createdAt') c[k] = o[k]; });
    return c;
  }
  function num(v){
    var n = parseFloat(String(v == null ? '' : v).replace(/[^0-9.]/g, ''));
    return isNaN(n) ? 0 : n;
  }
  function normName(v){ return String(v || '').replace(/\s+/g, ' ').trim().toLowerCase(); }
  /* एकच नोंद आहे का (दोन डिव्हाइसवर सारखा क्रमांक पण वेगळी नोंद म्हणजे clash) */
  function sameRecord(a, b){ return normName(a.name) === normName(b.name) && num(a.amount) === num(b.amount); }
  function tailNo(no){ var m = /(\d+)\s*$/.exec(String(no || '')); return m ? parseInt(m[1], 10) : 0; }
  function sortReceipts(list){
    return list.sort(function(a, b){
      var d = tailNo(a.no) - tailNo(b.no);
      return d !== 0 ? d : String(a.no).localeCompare(String(b.no));
    });
  }
  function readJSON(key, fb){ try{ var v = JSON.parse(localStorage.getItem(key)); return v == null ? fb : v; }catch(e){ return fb; } }
  function loadConflicts(){ return readJSON(LS_CONFLICTS, []); }
  function saveConflicts(list){ localStorage.setItem(LS_CONFLICTS, JSON.stringify(list)); }
  function countersRef(){ return db.collection('meta').doc('counters'); }
  function cfgRef(){ return db.collection('meta').doc('cpConfig'); }
  function ready(){ return !!(db && CS.user); }

  /* "पिढी" (epoch): "सगळे मिटवा" केल्यावर वाढते. जुन्या पिढीच्या नोंदी (ep < सध्याची) दुर्लक्षित होतात,
     त्यामुळे delete आणि counter यांच्या येण्याचा क्रम कसाही असला तरी जुन्या नोंदी परत दिसत नाहीत. */
  function epochOf(field, lsKey){
    var c = (cloud.counters && cloud.counters[field]) || 0;
    var l = parseInt(localStorage.getItem(lsKey), 10) || 0;
    return Math.max(c, l);
  }
  function curEpochR(){ return epochOf('epochR', LS_EPOCH_R); }
  function curEpochK(){ return epochOf('epochK', LS_EPOCH_K); }
  function liveOnly(raw, epoch){
    var out = {};
    Object.keys(raw || {}).forEach(function(k){ if((raw[k].ep || 0) >= epoch) out[k] = raw[k]; });
    return out;
  }
  function recompute(){
    cloud.receipts = cloud.rawR ? liveOnly(cloud.rawR, curEpochR()) : null;
    cloud.keys = cloud.rawK ? liveOnly(cloud.rawK, curEpochK()) : null;
  }

  function refreshUI(){
    try{
      if(typeof renderPayTable === 'function') renderPayTable();
      if(typeof renderKeyTable === 'function') renderKeyTable();
      if(typeof renderDashboard === 'function') renderDashboard();
      if(typeof renderMaster === 'function') renderMaster();
      var pn = $('payNo');
      if(pn && typeof nextReceiptPreview === 'function') pn.value = nextReceiptPreview();
    }catch(e){ console.warn('refreshUI', e); }
  }

  /* ---------- status / UI ---------- */
  var STATUS_TXT = {
    off:        '☁️ लॉगिन करा',
    connecting: '☁️ जोडत आहे…',
    online:     '☁️ Live ✅',
    offline:    '☁️ Offline (नेट आल्यावर sync)',
    error:      '☁️ त्रुटी'
  };
  function setStatus(s, detail){
    CS.status = s;
    var pill = $('cloudPill');
    if(pill){
      pill.textContent = STATUS_TXT[s] || s;
      pill.className = 'cloud-pill ' + s;
    }
    var st = $('cloudStatusTxt');
    if(st) st.textContent = (STATUS_TXT[s] || s) + (detail ? ' — ' + detail : '');
  }
  function say(msg, isErr){
    var m = $('cloudMsg');
    if(!m) return;
    m.textContent = msg || '';
    m.style.color = isErr ? '#ff8a80' : '#8bc34a';
  }
  function authErrText(e){
    var c = (e && e.code) || '';
    if(/invalid-credential|wrong-password|user-not-found|invalid-email/.test(c)) return 'Email किंवा Password चुकीचा आहे.';
    if(c === 'auth/network-request-failed') return 'इंटरनेट चालू नाही — नेट चालू करून पुन्हा प्रयत्न करा.';
    if(c === 'auth/operation-not-allowed') return 'Firebase मध्ये Email/Password sign-in चालू केलेले नाही.';
    if(c === 'auth/too-many-requests') return 'खूप वेळा चुकीचा प्रयत्न झाला — थोड्या वेळाने पुन्हा करा.';
    return (e && e.message) ? e.message : String(e);
  }

  function buildUI(){
    if($('cloudCard')) return;
    var css = document.createElement('style');
    css.textContent =
      '.cloud-pill{display:inline-block;margin-top:8px;padding:4px 12px;border-radius:14px;font-size:12px;font-weight:700;cursor:pointer;background:#333;color:#ccc;border:1px solid #555}' +
      '.cloud-pill.online{background:#1b5e20;color:#c8e6c9;border-color:#2e7d32}' +
      '.cloud-pill.offline,.cloud-pill.connecting{background:#4e3b00;color:#ffe082;border-color:#8d6e00}' +
      '.cloud-pill.error{background:#5c1a1a;color:#ffcdd2;border-color:#b71c1c}' +
      '.cloud-pill.off{background:#0f3460;color:#ffd700;border-color:#1565c0}';
    document.head.appendChild(css);

    var hdr = document.querySelector('header');
    if(hdr){
      var pill = document.createElement('div');
      pill.id = 'cloudPill';
      pill.className = 'cloud-pill off';
      pill.textContent = STATUS_TXT.off;
      pill.addEventListener('click', function(){ if(typeof switchTab === 'function') switchTab('settings'); });
      hdr.appendChild(pill);
    }

    var tab = $('tab-settings');
    if(tab){
      var card = document.createElement('div');
      card.className = 'card';
      card.id = 'cloudCard';
      card.innerHTML =
        '<h2>☁️ Cloud Sync (Computer ↔ मोबाईल)</h2>' +
        '<div class="hint">दोन्हीकडे <b>एकच Email/Password</b> ने लॉगिन करा. पावत्या, Product Keys, पावती क्रमांक आणि Sheet links आपोआप एकत्र राहतात. ' +
        'इंटरनेट नसताना software आधीसारखाच चालतो; नेट आल्यावर आपोआप sync होते.</div>' +
        '<div id="cloudLoggedOut">' +
          '<div class="fgrid"><div class="fg"><label>Email</label><input type="email" id="cloudEmail" autocomplete="username" placeholder="you@example.com"></div>' +
          '<div class="fg"><label>Password</label><input type="password" id="cloudPass" autocomplete="current-password" placeholder="••••••••"></div></div>' +
          '<div class="row"><div class="btn btn-gen" id="cloudLoginBtn">🔐 लॉगिन करा</div></div>' +
        '</div>' +
        '<div id="cloudLoggedIn" style="display:none">' +
          '<div class="fg"><label>लॉगिन केलेले खाते</label><div id="cloudUser" style="font-weight:700;color:#ffd700"></div></div>' +
          '<div class="fg"><label>स्थिती</label><div id="cloudStatusTxt"></div></div>' +
          '<div class="row"><div class="btn" id="cloudDiagBtn" style="background:#0f3460;color:#fff">🔍 कनेक्शन तपासा</div>' +
          '<div class="btn" id="cloudLogoutBtn" style="background:#333;color:#fff">🚪 लॉगआऊट</div></div>' +
        '</div>' +
        '<div id="cloudMsg" style="margin-top:10px;font-size:13px;white-space:pre-line"></div>';
      tab.insertBefore(card, tab.firstChild);

      $('cloudLoginBtn').addEventListener('click', CS.login);
      $('cloudPass').addEventListener('keydown', function(e){ if(e.key === 'Enter') CS.login(); });
      $('cloudLogoutBtn').addEventListener('click', CS.logout);
      $('cloudDiagBtn').addEventListener('click', function(){ CS.diagnose(); });
    }
  }
  function showLoggedIn(on){
    var a = $('cloudLoggedOut'), b = $('cloudLoggedIn');
    if(a) a.style.display = on ? 'none' : 'block';
    if(b) b.style.display = on ? 'block' : 'none';
    var u = $('cloudUser');
    if(u) u.textContent = on && CS.user ? (CS.user.email || CS.user.uid) : '';
  }

  /* ---------- login / logout ---------- */
  CS.login = function(){
    if(!auth){ say('Cloud उपलब्ध नाही (Firebase लोड झाले नाही).', true); return; }
    var email = ($('cloudEmail').value || '').trim(), pass = $('cloudPass').value || '';
    if(!email || !pass){ say('Email आणि Password टाका.', true); return; }
    say('लॉगिन होत आहे…', false);
    auth.signInWithEmailAndPassword(email, pass).then(function(){
      $('cloudPass').value = '';
      say('✅ लॉगिन यशस्वी.', false);
    }).catch(function(e){ say('⚠️ ' + authErrText(e), true); });
  };
  CS.logout = function(){
    if(!auth) return;
    if(!confirm('लॉगआऊट करायचे? (या डिव्हाइसवरचा data तसाच राहील; live sync थांबेल.)')) return;
    auth.signOut();
  };

  /* ---------- कनेक्शन तपासणी ---------- */
  var diagRunning = false;
  /* SDK वगळून थेट Firestore REST ला विचारतो — Google स्वतः खरे कारण सांगते */
  function restProbe(){
    var tokenP = (CS.user && CS.user.getIdToken) ? CS.user.getIdToken() : Promise.resolve('');
    return tokenP.then(function(tok){
      var url = 'https://firestore.googleapis.com/v1/projects/' + FB_CONFIG.projectId +
                '/databases/(default)/documents/meta/counters?key=' + encodeURIComponent(FB_CONFIG.apiKey);
      return fetch(url, { headers: tok ? { 'Authorization': 'Bearer ' + tok } : {} });
    }).then(function(r){
      return r.text().then(function(t){
        var j = null; try{ j = JSON.parse(t); }catch(e){}
        var err = j && j.error ? j.error : null;
        var msg = err ? String(err.message || '') : '';
        if(r.status === 200) return { ok: true, text: '✅ REST: Firestore मधून data वाचता आला (Database तयार आहे, Rules परवानगी देतात) — अडचण फक्त software च्या जोडणीत आहे' };
        if(r.status === 404 && /database/i.test(msg) && /does not exist/i.test(msg))
          return { ok: false, text: '❌ REST: Firestore Database तयार केलेली नाही — Firebase → Firestore Database → "Create database" करा (' + msg.slice(0, 140) + ')' };
        if(r.status === 404) return { ok: true, text: '✅ REST: Database तयार आहे आणि Rules परवानगी देतात (meta/counters ही नोंद अजून नाही — सामान्य)' };
        if(r.status === 403 && /has not been used|is disabled|SERVICE_DISABLED/i.test(msg + t))
          return { ok: false, text: '❌ REST: Cloud Firestore API बंद आहे — Google Cloud Console → APIs → "Cloud Firestore API" Enable करा' };
        if(r.status === 403 && /blocked|API_KEY|referer|referrer/i.test(msg + t))
          return { ok: false, text: '❌ REST: API key वर restriction आहे — Google Cloud → Credentials → key → Restrictions तपासा (' + msg.slice(0, 120) + ')' };
        if(r.status === 403 || r.status === 401)
          return { ok: false, text: '❌ REST: परवानगी नाही (' + r.status + ') — Firestore Rules मध्ये तुमचा Email नाही, किंवा Rules चुकीचे आहेत. ' + msg.slice(0, 120) };
        return { ok: false, text: '❌ REST: HTTP ' + r.status + ' ' + msg.slice(0, 160) };
      });
    }).catch(function(e){
      return { ok: false, text: '❌ REST: request जाऊ शकली नाही (' + ((e && e.message) || e) + ') — या window मधून Firestore ला जोडणी अडवली जात आहे (CORS / Firewall / Antivirus)' };
    });
  }
  CS.diagnose = function(){
    if(!db || diagRunning) return;
    diagRunning = true;
    say('कनेक्शन तपासत आहे…', false);
    var parts = [];
    var p1 = fetch('https://firestore.googleapis.com/', { mode: 'no-cors' }).then(
      function(){ parts[0] = '✅ Google Firestore सर्व्हरपर्यंत इंटरनेट पोहोचत आहे'; },
      function(e){ parts[0] = '❌ firestore.googleapis.com पोहोचत नाही (' + ((e && e.message) || e) + ') — Firewall / Antivirus / Proxy / VPN तपासा'; });
    var p2 = restProbe().then(function(r){ parts[1] = r.text; });
    var p3 = Promise.race([
      countersRef().get({ source: 'server' }),
      timeout(12000)
    ]).then(
      function(){ parts[2] = '✅ SDK: Firestore मधून data वाचता आला'; },
      function(e){
        var c = (e && e.code) || '';
        parts[2] = '❌ SDK: Firestore वाचता आला नाही: ' + (c || '') + ' ' + ((e && e.message) || e);
      });
    return Promise.all([p1, p2, p3]).then(function(){
      diagRunning = false;
      parts.push('(आवृत्ती: ' + (location.protocol === 'file:' ? 'computer' : 'mobile') + ', long-polling)');
      say(parts.filter(Boolean).join('\n'), parts.some(function(x){ return x && x.indexOf('❌') === 0; }));
    });
  };

  /* ---------- listeners ---------- */
  function stopListeners(){
    unsubs.forEach(function(u){ try{ u(); }catch(e){} });
    unsubs = [];
    cloud = { rawR: null, rawK: null, receipts: null, keys: null, counters: null, rServer: false, kServer: false, epochOk: false };
    pushed = {};
  }
  function onListenErr(what){
    return function(err){
      console.warn('Cloud listen error', what, err);
      var code = (err && err.code) || '';
      if(code === 'permission-denied') setStatus('error', 'परवानगी नाही (Firestore Rules तपासा)');
      else setStatus('error', what + ': ' + (err && err.message ? err.message : code));
    };
  }
  function startListeners(){
    stopListeners();
    setStatus('connecting');
    unsubs.push(db.collection(COL_R).onSnapshot({ includeMetadataChanges: true }, onReceipts, onListenErr('पावत्या')));
    unsubs.push(db.collection(COL_K).onSnapshot({ includeMetadataChanges: true }, onKeys, onListenErr('Keys')));
    unsubs.push(countersRef().onSnapshot({ includeMetadataChanges: true }, onCounters, onListenErr('Counter')));
    unsubs.push(cfgRef().onSnapshot({ includeMetadataChanges: true }, onCfg, onListenErr('Config')));
    setTimeout(function(){
      if(CS.user && CS.status === 'connecting'){ setStatus('offline'); CS.diagnose(); }
    }, 8000);
  }
  function noteConnectivity(fromCache){
    if(!fromCache) setStatus('online');
    else if(CS.status === 'online') setStatus('offline');
  }

  /* ---------- receipts ---------- */
  function onReceipts(snap){
    var m = {};
    snap.forEach(function(d){
      var r = cleanDoc(d.data());
      if(r.no) m[r.no] = r;
    });
    cloud.rawR = m;
    cloud.rServer = !snap.metadata.fromCache;
    recompute();
    if(wiping) return;
    noteConnectivity(snap.metadata.fromCache);
    reconcileReceipts();
    reconcileCounter();
  }
  function serverOk(){ return cloud.epochOk && cloud.rServer && cloud.kServer; }

  function reconcileReceipts(){
    if(wiping || !cloud.receipts) return;
    var cm = cloud.receipts;
    var local = (g('allReceipts') || []).slice();
    var merged = {}, conflicts = loadConflicts(), newConf = [];

    local.forEach(function(r){ if(r && r.no) merged[r.no] = r; });
    Object.keys(cm).forEach(function(no){
      var c = cm[no];
      if(merged[no] && !sameRecord(merged[no], c)) newConf.push(merged[no]);   // क्रमांक clash
      merged[no] = c;                                                          // cloud चीच नोंद अंतिम
    });

    // cloud मध्ये नसलेल्या local नोंदी cloud ला पाठवा (फक्त server-confirmed असताना)
    if(serverOk()){
      local.forEach(function(r){
        if(r && r.no && !cm[r.no] && !pushed['r:' + r.no]){
          pushed['r:' + r.no] = true;
          CS.pushReceipt(r);
        }
      });
    }

    if(newConf.length){
      newConf.forEach(function(r){
        var dup = conflicts.some(function(x){ return sameRecord(x, r) && x.no === r.no; });
        if(!dup) conflicts.push(r);
      });
      saveConflicts(conflicts);
    }

    var arr = sortReceipts(Object.keys(merged).map(function(k){ return merged[k]; }));
    if(JSON.stringify(arr) !== JSON.stringify(g('allReceipts'))){
      window.allReceipts = arr;
      if(typeof lsSet === 'function') lsSet(g('LS_RECEIPTS'), arr);
      refreshUI();
    }
    if(conflicts.length) processConflicts();
  }

  /* दोन डिव्हाइसवर एकच क्रमांक वापरला गेला असेल तर दुसरीला नवीन क्रमांक देतो — कोणतीही नोंद हरवत नाही */
  function processConflicts(){
    if(processingConflicts || !serverOk()) return;
    var list = loadConflicts();
    if(!list.length) return;
    processingConflicts = true;
    var rec = list[0];
    CS.allocateNumber().then(function(n){
      var old = rec.no;
      rec = Object.assign({}, rec, { no: g('formatReceiptNo')(n) });
      return CS.pushReceipt(rec).then(function(){
        var rest = loadConflicts().filter(function(x){ return !(x.no === old && sameRecord(x, rec)); });
        saveConflicts(rest);
        pushed['r:' + rec.no] = true;
        var arr = (g('allReceipts') || []).slice();
        if(!arr.some(function(x){ return x.no === rec.no; })) arr.push(rec);
        window.allReceipts = sortReceipts(arr);
        g('lsSet')(g('LS_RECEIPTS'), window.allReceipts);
        refreshUI();
        say('ℹ️ एक पावती क्रमांक दोन ठिकाणी वापरला गेला होता — एका नोंदीला नवीन क्रमांक ' + rec.no + ' दिला.', false);
      });
    }).catch(function(e){ console.warn('conflict renumber failed', e); })
      .then(function(){ processingConflicts = false; if(loadConflicts().length) setTimeout(processConflicts, 500); });
  }

  /* ---------- keys ---------- */
  function onKeys(snap){
    var m = {};
    snap.forEach(function(d){
      var k = cleanDoc(d.data());
      if(k.key) m[k.key] = k;
    });
    cloud.rawK = m;
    cloud.kServer = !snap.metadata.fromCache;
    recompute();
    if(wiping) return;
    noteConnectivity(snap.metadata.fromCache);
    reconcileKeys();
  }
  function reconcileKeys(){
    if(wiping || !cloud.keys) return;
    var cm = cloud.keys;
    var local = (g('allKeys') || []).slice();
    var merged = {}, order = [];
    local.forEach(function(k){ if(k && k.key && !merged[k.key]){ merged[k.key] = k; order.push(k.key); } });
    Object.keys(cm).forEach(function(key){ if(!merged[key]) order.push(key); merged[key] = cm[key]; });

    if(serverOk()){
      local.forEach(function(k){
        if(k && k.key && !cm[k.key] && !pushed['k:' + k.key]){
          pushed['k:' + k.key] = true;
          CS.pushKey(k);
        }
      });
    }
    var arr = order.map(function(k){ return merged[k]; });
    arr.sort(function(a, b){ return String(b.generatedAt || '').localeCompare(String(a.generatedAt || '')); }); // नवीन आधी
    if(JSON.stringify(arr) !== JSON.stringify(g('allKeys'))){
      window.allKeys = arr;
      g('lsSet')(g('LS_KEYS'), arr);
      refreshUI();
    }
  }

  /* ---------- counter + epoch ---------- */
  function onCounters(snap){
    cloud.counters = snap.exists ? snap.data() : {};
    if(wiping) return;
    var fromCache = snap.metadata.fromCache;
    noteConnectivity(fromCache);
    if(!fromCache){
      var cr = cloud.counters.epochR || 0, ck = cloud.counters.epochK || 0;
      var lr = localStorage.getItem(LS_EPOCH_R), lk = localStorage.getItem(LS_EPOCH_K);
      // null = या डिव्हाइसची पहिली sync — local data cloud वर जाईल; नाहीतर दुसऱ्या डिव्हाइसवर "मिटवा" झाले असेल तर local mirror रिकामा
      if(lr !== null && cr > parseInt(lr, 10)) wipeLocalMirrors(true, false);
      if(lk !== null && ck > parseInt(lk, 10)) wipeLocalMirrors(false, true);
      localStorage.setItem(LS_EPOCH_R, String(Math.max(cr, parseInt(lr, 10) || 0)));
      localStorage.setItem(LS_EPOCH_K, String(Math.max(ck, parseInt(lk, 10) || 0)));
      cloud.epochOk = true;
    }
    recompute();
    reconcileReceipts();
    reconcileKeys();
    reconcileCounter();
  }
  function wipeLocalMirrors(r, k){
    if(r){
      window.allReceipts = [];
      g('lsSet')(g('LS_RECEIPTS'), []);
      localStorage.removeItem(g('LS_NEXT_NO'));
      saveConflicts([]);
    }
    if(k){
      window.allKeys = [];
      g('lsSet')(g('LS_KEYS'), []);
    }
    refreshUI();
  }
  function reconcileCounter(){
    if(wiping || !cloud.counters) return;
    var LSN = g('LS_NEXT_NO');
    var localNext = parseInt(localStorage.getItem(LSN), 10) || 1;
    var cloudNext = cloud.counters.nextReceiptNo || 1;
    var maxNo = 0;
    (g('allReceipts') || []).forEach(function(r){ maxNo = Math.max(maxNo, tailNo(r.no)); });
    var eff = Math.max(localNext, cloudNext, maxNo + 1);
    if(eff !== localNext){
      localStorage.setItem(LSN, String(eff));
      var pn = $('payNo');
      if(pn && typeof nextReceiptPreview === 'function') pn.value = nextReceiptPreview();
    }
    if(eff > cloudNext && serverOk()) bumpCounter(eff);
  }
  function bumpCounter(n){
    if(bumping) return;
    bumping = true;
    var ref = countersRef();
    db.runTransaction(function(tx){
      return tx.get(ref).then(function(d){
        var cur = (d.exists && d.data().nextReceiptNo) || 1;
        if(cur < n) tx.set(ref, { nextReceiptNo: n }, { merge: true });
      });
    }).catch(function(e){ console.warn('counter bump failed', e); })
      .then(function(){ bumping = false; });
  }

  /* नवीन पावती क्रमांक — दोन डिव्हाइसवर कधीही सारखा येत नाही (transaction) */
  CS.allocateNumber = function(){
    var ref = countersRef();
    var LSN = g('LS_NEXT_NO');
    return db.runTransaction(function(tx){
      return tx.get(ref).then(function(d){
        var cloudNext = (d.exists && d.data().nextReceiptNo) || 1;
        var localNext = parseInt(localStorage.getItem(LSN), 10) || 1;
        var n = Math.max(cloudNext, localNext);
        tx.set(ref, { nextReceiptNo: n + 1 }, { merge: true });
        return n;
      });
    });
  };

  /* ---------- pushes ---------- */
  CS.pushReceipt = function(rec){
    if(!ready() || !rec || !rec.no) return Promise.resolve();
    var d = Object.assign({}, rec, { source: rec.source || CS.source, ep: curEpochR(), updatedAt: FV.serverTimestamp() });
    return db.collection(COL_R).doc(rec.no).set(d)
      .catch(function(e){ console.warn('pushReceipt failed', e); });
  };
  CS.pushKey = function(k){
    if(!ready() || !k || !k.key) return Promise.resolve();
    var d = Object.assign({}, k, { ep: curEpochK(), updatedAt: FV.serverTimestamp() });
    return db.collection(COL_K).doc(k.key).set(d)
      .catch(function(e){ console.warn('pushKey failed', e); });
  };
  CS.pushConfig = function(){
    if(!ready()) return Promise.resolve();
    var c = g('config') || {};
    return cfgRef().set({ formUrl: c.formUrl || '', complaintUrl: c.complaintUrl || '' }, { merge: true })
      .catch(function(e){ console.warn('pushConfig failed', e); });
  };

  /* ---------- Sheet links ---------- */
  function onCfg(snap){
    if(wiping) return;
    var fromCache = snap.metadata.fromCache;
    var c = g('config');
    if(!snap.exists){
      if(!fromCache && (c.formUrl || c.complaintUrl)) CS.pushConfig();   // पहिल्यांदा — local links cloud ला
      return;
    }
    var d = snap.data(), changed = false;
    ['formUrl', 'complaintUrl'].forEach(function(k){
      if(typeof d[k] === 'string' && d[k] && d[k] !== c[k]){ c[k] = d[k]; changed = true; }
    });
    if(changed){
      g('lsSet')(g('LS_CONFIG'), c);
      if($('cfgFormUrl')) $('cfgFormUrl').value = c.formUrl || '';
      if($('cfgComplaintUrl')) $('cfgComplaintUrl').value = c.complaintUrl || '';
      if($('formSheetLink')) $('formSheetLink').href = c.formUrl || '#';
      if($('complaintSheetLink')) $('complaintSheetLink').href = c.complaintUrl || '#';
      if(typeof syncSheets === 'function') syncSheets(false);
    }
  }

  /* ---------- "सगळे मिटवा" cloud वर पोहोचवणे ---------- */
  function deleteAll(col){
    return db.collection(col).get().then(function(snap){
      var docs = []; snap.forEach(function(d){ docs.push(d.ref); });
      var p = Promise.resolve();
      for(var i = 0; i < docs.length; i += 400){
        (function(chunk){
          p = p.then(function(){
            var b = db.batch();
            chunk.forEach(function(ref){ b.delete(ref); });
            return b.commit();
          });
        })(docs.slice(i, i + 400));
      }
      return p;
    });
  }
  CS.wipe = function(r, k){
    if(!ready()) return Promise.resolve();
    wiping = true;
    var cref = countersRef();
    return db.runTransaction(function(tx){
      return tx.get(cref).then(function(d){
        var data = d.exists ? d.data() : {};
        var upd = {};
        if(r){ upd.epochR = (data.epochR || 0) + 1; upd.nextReceiptNo = 1; }
        if(k){ upd.epochK = (data.epochK || 0) + 1; }
        tx.set(cref, upd, { merge: true });
        return upd;
      });
    }).then(function(upd){
      if(upd.epochR !== undefined) localStorage.setItem(LS_EPOCH_R, String(upd.epochR));
      if(upd.epochK !== undefined) localStorage.setItem(LS_EPOCH_K, String(upd.epochK));
      var ps = [];
      if(r) ps.push(deleteAll(COL_R));
      if(k) ps.push(deleteAll(COL_K));
      return Promise.all(ps);
    }).catch(function(e){
      console.warn('wipe failed', e);
      alert('⚠️ Cloud वरील नोंदी मिटवता आल्या नाहीत (' + ((e && e.message) || e) + ').\nइंटरनेट चालू असताना पुन्हा प्रयत्न करा — नाहीतर नोंदी परत दिसतील.');
    }).then(function(){
      wiping = false;
      wipeLocalMirrors(!!r, !!k);
      pushed = {};
      recompute();
      reconcileReceipts(); reconcileKeys(); reconcileCounter();
    });
  };

  /* ---------- panel functions शी जोडणी ---------- */
  function timeout(ms){ return new Promise(function(_, rej){ setTimeout(function(){ rej(new Error('timeout')); }, ms); }); }
  function wrap(name, make){
    var orig = window[name];
    if(typeof orig !== 'function') return;
    window[name] = make(orig);
  }
  function hookPanel(){
    wrap('addPayment', function(orig){ return function(){
      var self = this, args = arguments;
      if(busyAdd) return;                                   // दुहेरी क्लिक टाळतो
      if(!ready()) return orig.apply(self, args);
      var name = ($('payName').value || '').trim();
      var mobile = g('normMobile')($('payMobile').value);
      var amount = ($('payAmount').value || '').trim();
      if(!name || !mobile || !amount || isNaN(parseFloat(amount))) return orig.apply(self, args); // original योग्य alert दाखवतो
      busyAdd = true;
      var useCloud = CS.status === 'online';
      var pre = useCloud
        ? Promise.race([CS.allocateNumber(), timeout(ALLOCATE_TIMEOUT_MS)]).then(function(n){
            localStorage.setItem(g('LS_NEXT_NO'), String(n));
          }).catch(function(){ /* नेट नाही/उशीर — local क्रमांक वापरू */ })
        : Promise.resolve();
      return pre.then(function(){
        var before = g('allReceipts').length;
        orig.apply(self, args);
        var arr = g('allReceipts');
        if(arr.length > before){ pushed['r:' + arr[arr.length - 1].no] = true; CS.pushReceipt(arr[arr.length - 1]); }
      }).then(function(){ busyAdd = false; }, function(e){ busyAdd = false; throw e; });
    }; });

    wrap('generateKeys', function(orig){ return function(){
      var before = g('allKeys').length;
      var res = orig.apply(this, arguments);
      var arr = g('allKeys');
      if(arr.length > before){ pushed['k:' + arr[0].key] = true; CS.pushKey(arr[0]); }
      return res;
    }; });

    function wipeWrapper(orig){ return function(){
      var hadR = g('allReceipts').length, hadK = g('allKeys').length;
      var res = orig.apply(this, arguments);
      var wr = hadR > 0 && g('allReceipts').length === 0;
      var wk = hadK > 0 && g('allKeys').length === 0;
      if((wr || wk) && ready()) CS.wipe(wr, wk);
      return res;
    }; }
    wrap('clearAllReceipts', wipeWrapper);
    wrap('clearAllKeys', wipeWrapper);
    wrap('clearAllData', wipeWrapper);

    wrap('importAllBackup', function(orig){ return function(){
      var res = orig.apply(this, arguments);
      // FileReader async आहे — थोड्या वेळाने union sync
      setTimeout(function(){ pushed = {}; reconcileReceipts(); reconcileKeys(); }, 1500);
      return res;
    }; });

    wrap('saveConfigAndSync', function(orig){ return function(){
      var res = orig.apply(this, arguments);
      CS.pushConfig();
      return res;
    }; });

    // storage event न आल्यास (दुसऱ्या window मधून बदल) — दर 3 सेकंदाला localStorage तपासतो
    var lastRaw = localStorage.getItem(g('LS_RECEIPTS'));
    setInterval(function(){
      var raw = localStorage.getItem(g('LS_RECEIPTS'));
      if(raw === lastRaw) return;
      lastRaw = raw;
      var arr = readJSON(g('LS_RECEIPTS'), []);
      if(JSON.stringify(arr) !== JSON.stringify(g('allReceipts'))){
        window.allReceipts = arr;
        reconcileReceipts(); reconcileCounter(); refreshUI();
      }
    }, 3000);

    // पावती विंडो (pavati) ने localStorage बदलल्यास — पॅनेलमध्ये उचलणे आणि cloud ला पाठवणे
    window.addEventListener('storage', function(e){
      if(e.key === g('LS_RECEIPTS')){
        window.allReceipts = readJSON(g('LS_RECEIPTS'), []);
        reconcileReceipts(); reconcileCounter(); refreshUI();
      } else if(e.key === g('LS_NEXT_NO')){
        var pn = $('payNo');
        if(pn && typeof nextReceiptPreview === 'function') pn.value = nextReceiptPreview();
        reconcileCounter();
      }
    });
  }

  /* ---------- boot ---------- */
  function boot(){
    buildUI();
    hookPanel();
    if(typeof firebase === 'undefined'){
      setStatus('error', 'Firebase लोड झाले नाही');
      say('Firebase फाईल्स सापडल्या नाहीत — Cloud sync बंद आहे. Software local मोडमध्ये चालेल.', true);
      return;
    }
    try{
      if(!firebase.apps.length) firebase.initializeApp(FB_CONFIG);
      db = firebase.firestore();
      FV = firebase.firestore.FieldValue;
      // Electron (file://) मध्ये नेहमीची streaming जोडणी अनेकदा अडते → long-polling; इतरत्र आपोआप ओळख
      try{
        db.settings(location.protocol === 'file:'
          ? { experimentalForceLongPolling: true, experimentalAutoDetectLongPolling: false, merge: true }
          : { experimentalAutoDetectLongPolling: true, merge: true });
      }catch(e){ console.warn('firestore settings', e); }
      auth = firebase.auth();
    }catch(e){
      setStatus('error', e.message);
      return;
    }
    auth.onAuthStateChanged(function(u){
      CS.user = u || null;
      showLoggedIn(!!u);
      if(u){
        say('', false);
        startListeners();
      } else {
        stopListeners();
        setStatus('off');
        if(typeof CS.onLoggedOut === 'function') CS.onLoggedOut();
      }
    });
  }

  CS.boot = boot;
  CS._t = { reconcileReceipts: reconcileReceipts, cloud: function(){ return cloud; }, sameRecord: sameRecord };
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
