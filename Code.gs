/**
 * 여행 건강 지킴이 - 공공데이터포털 중계 (Google Apps Script)
 *
 * 인증키는 이 파일에 쓰지 않습니다.
 *   프로젝트 설정 → 스크립트 속성 → PUBLIC_API_KEY 에 공공데이터포털 인증키(Decoding 키 권장)를 넣으세요.
 *
 * 배포: 배포 → 새 배포 → 유형 "웹 앱" → 실행: 나 / 액세스: 모든 사용자 → …/exec 주소를 index.html 의 RELAY_URL 에.
 * 코드를 고친 뒤에는 배포 관리 → (연필) 편집 → 버전 "새 버전" → 배포. 이렇게 하면 …/exec 주소가 그대로 유지됩니다.
 *
 * 요청 예: …/exec?op=drug&itemName=타이레놀
 */

var CACHE_SECONDS = 600;      // 10분
var CHUNK_CHARS = 30000;      // CacheService 값 한도(100KB) 안에 들도록 나눠 저장
var MAX_ROWS = 50;

// 허용한 기능(op)만 받음. serviceKey 는 밖에서 받지 않음.
var ALLOWED_OPS = {
  ncst: {
    url: 'https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getUltraSrtNcst',
    fixed: { dataType: 'JSON', pageNo: '1', numOfRows: '60' }
  },
  fcst: {
    url: 'https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getUltraSrtFcst',
    fixed: { dataType: 'JSON', pageNo: '1', numOfRows: '60' }
  },
  tour: {
    url: 'https://apis.data.go.kr/B551011/KorService2/locationBasedList2',
    fixed: { MobileOS: 'ETC', MobileApp: 'TravelHealth', _type: 'json' },
    defaults: { numOfRows: '20', pageNo: '1', radius: '10000', arrange: 'E', contentTypeId: '12' }
  },
  festival: {
    url: 'https://apis.data.go.kr/B551011/KorService2/searchFestival2',
    fixed: { MobileOS: 'ETC', MobileApp: 'TravelHealth', _type: 'json' },
    defaults: { numOfRows: '20', pageNo: '1', arrange: 'C' }
  },
  pharmacy: {
    url: 'https://apis.data.go.kr/B552657/ErmctInsttInfoInqireService/getParmacyLcinfoInqire',
    fixed: {},
    defaults: { numOfRows: '20', pageNo: '1' }
  },
  er: {
    url: 'https://apis.data.go.kr/B552657/ErmctInfoInqireService/getEgytLcinfoInqire',
    fixed: {},
    defaults: { numOfRows: '20', pageNo: '1' }
  },
  sun: {
    // 한국천문연구원 출몰시각 정보 - 위치(위도·경도)별
    url: 'https://apis.data.go.kr/B090041/openapi/service/RiseSetInfoService/getLCRiseSetInfo',
    fixed: { dnYn: 'Y' }
  },
  drug: {
    // 식품의약품안전처 의약품개요정보(e약은요)
    url: 'https://apis.data.go.kr/1471000/DrbEasyDrugInfoService/getDrbEasyDrugList',
    fixed: { type: 'json' },
    defaults: { numOfRows: '10', pageNo: '1' }
  }
};

// 기능별로 밖에서 받을 수 있는 항목
var ALLOWED_PARAMS = {
  ncst: ['base_date', 'base_time', 'nx', 'ny'],
  fcst: ['base_date', 'base_time', 'nx', 'ny'],
  tour: ['mapX', 'mapY', 'radius', 'contentTypeId', 'arrange', 'numOfRows', 'pageNo'],
  festival: ['eventStartDate', 'eventEndDate', 'areaCode', 'sigunguCode', 'lDongRegnCd', 'arrange', 'numOfRows', 'pageNo'],
  pharmacy: ['WGS84_LON', 'WGS84_LAT', 'numOfRows', 'pageNo'],
  er: ['WGS84_LON', 'WGS84_LAT', 'numOfRows', 'pageNo'],
  sun: ['locdate', 'longitude', 'latitude'],
  drug: ['itemName', 'entpName', 'numOfRows', 'pageNo']
};

var VALUE_PATTERN = /^[0-9A-Za-z가-힣ㄱ-ㅎㅏ-ㅣ .\-_()]{1,60}$/;

function doGet(e) {
  var p = (e && e.parameter) || {};
  return json_(relay_(p.op, p));
}

function relay_(op, params) {
  if (!op || !ALLOWED_OPS.hasOwnProperty(op)) {
    return { ok: false, error: '허용되지 않은 op: ' + op, ops: Object.keys(ALLOWED_OPS) };
  }
  var key = PropertiesService.getScriptProperties().getProperty('PUBLIC_API_KEY');
  if (!key) return { ok: false, op: op, error: '스크립트 속성 PUBLIC_API_KEY 가 비어 있습니다.' };

  var conf = ALLOWED_OPS[op];
  var q = {};
  var k;
  for (k in (conf.defaults || {})) q[k] = conf.defaults[k];
  var allowed = ALLOWED_PARAMS[op] || [];
  for (var i = 0; i < allowed.length; i++) {
    var name = allowed[i];
    if (params[name] === undefined || params[name] === '') continue;
    var v = String(params[name]).trim();
    if (!VALUE_PATTERN.test(v)) return { ok: false, op: op, error: '값 형식이 올바르지 않음: ' + name };
    q[name] = v;
  }
  if (q.numOfRows && Number(q.numOfRows) > MAX_ROWS) q.numOfRows = String(MAX_ROWS);
  for (k in (conf.fixed || {})) q[k] = conf.fixed[k];

  var qs = Object.keys(q).sort().map(function (n) {
    return encodeURIComponent(n) + '=' + encodeURIComponent(q[n]);
  }).join('&');

  var cacheKey = 'r_' + md5_(op + '?' + qs);
  var cached = cacheGet_(cacheKey);
  if (cached) {
    var c = JSON.parse(cached);
    c.cached = true;
    return c;
  }

  // 인증키: Encoding 키(%가 들어 있음)를 넣었으면 그대로, Decoding 키면 인코딩해서 붙임
  var sk = key.indexOf('%') >= 0 ? key : encodeURIComponent(key);
  var url = conf.url + '?serviceKey=' + sk + '&' + qs;

  var res, text;
  try {
    res = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true });
    text = res.getContentText('UTF-8');
  } catch (err) {
    return { ok: false, op: op, error: '요청 실패: ' + err };
  }

  var out = normalize_(text);
  out.op = op;
  out.http = res.getResponseCode();
  if (out.ok) cachePut_(cacheKey, JSON.stringify(out));
  return out;
}

/** 어떤 모양의 응답이든 {ok, response:{header, body}} 로 맞춤 */
function normalize_(text) {
  var t = String(text || '').trim();
  var resp = null;
  try {
    if (t.charAt(0) === '<') {
      resp = xmlToResponse_(t);
    } else if (t.charAt(0) === '{' || t.charAt(0) === '[') {
      var o = JSON.parse(t);
      if (o.response) resp = o.response;
      else if (o.header || o.body) resp = { header: o.header || {}, body: o.body || {} };
      else resp = { header: {}, body: o };
    }
  } catch (err) {
    return { ok: false, error: '응답 해석 실패: ' + err, raw: t.substring(0, 300) };
  }
  if (!resp) return { ok: false, error: '알 수 없는 응답', raw: t.substring(0, 300) };

  var h = resp.header || {};
  var code = String(h.resultCode == null ? '' : h.resultCode);
  var ok = code === '00' || code === '0000' || code === '0';
  return { ok: ok, resultCode: code, resultMsg: h.resultMsg || '', response: { header: h, body: resp.body || {} } };
}

function xmlToResponse_(xml) {
  var root = XmlService.parse(xml).getRootElement();
  var o = xmlToObj_(root);
  if (root.getName() === 'OpenAPI_ServiceResponse') {
    var m = o.cmmMsgHeader || {};
    return {
      header: { resultCode: m.returnReasonCode || 'ERR', resultMsg: m.returnAuthMsg || m.errMsg || 'SERVICE ERROR' },
      body: {}
    };
  }
  if (typeof o !== 'object') return { header: {}, body: { text: o } };
  return { header: o.header || {}, body: o.body || {} };
}

function xmlToObj_(el) {
  var kids = el.getChildren();
  if (!kids.length) return el.getText();
  var o = {};
  for (var i = 0; i < kids.length; i++) {
    var n = kids[i].getName();
    var v = xmlToObj_(kids[i]);
    if (n === 'item') {
      (o.item = o.item || []).push(v);
    } else if (o.hasOwnProperty(n)) {
      if (!Array.isArray(o[n])) o[n] = [o[n]];
      o[n].push(v);
    } else {
      o[n] = v;
    }
  }
  return o;
}

/* ---------- 캐시 (큰 응답은 나눠 저장) ---------- */

function cachePut_(key, str) {
  try {
    var c = CacheService.getScriptCache();
    if (str.length <= CHUNK_CHARS) { c.put(key, str, CACHE_SECONDS); return; }
    var n = Math.ceil(str.length / CHUNK_CHARS);
    if (n > 20) return; // 너무 크면 저장하지 않음
    var m = {};
    for (var i = 0; i < n; i++) m[key + '_' + i] = str.substr(i * CHUNK_CHARS, CHUNK_CHARS);
    m[key] = '__chunks__' + n;
    c.putAll(m, CACHE_SECONDS);
  } catch (err) { /* 캐시 실패는 무시 */ }
}

function cacheGet_(key) {
  try {
    var c = CacheService.getScriptCache();
    var v = c.get(key);
    if (!v) return null;
    if (v.indexOf('__chunks__') !== 0) return v;
    var n = Number(v.substring(10));
    var keys = [];
    for (var i = 0; i < n; i++) keys.push(key + '_' + i);
    var parts = c.getAll(keys);
    var s = '';
    for (var j = 0; j < n; j++) {
      if (parts[keys[j]] == null) return null;
      s += parts[keys[j]];
    }
    return s;
  } catch (err) { return null; }
}

function md5_(s) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, s, Utilities.Charset.UTF_8)
    .map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

/* ---------- 점검용 (편집기에서 함수 선택 → 실행 → 실행 로그 확인) ---------- */

/** e약은요 1건으로 인증키가 동작하는지 확인 */
function checkSetup() {
  var r = relay_('drug', { itemName: '타이레놀', numOfRows: '1' });
  Logger.log(JSON.stringify(r).substring(0, 1500));
  Logger.log(r.ok ? '✅ 인증키 정상' : '❌ 오류: ' + (r.error || r.resultCode + ' ' + r.resultMsg));
}

/** 기능마다 한 번씩 요청해서 결과 요약 */
function checkAll() {
  var kst = new Date(Date.now() - 40 * 60000);
  var ymd = Utilities.formatDate(kst, 'Asia/Seoul', 'yyyyMMdd');
  var hh = Utilities.formatDate(kst, 'Asia/Seoul', 'HH');
  var fk = new Date(Date.now() - 45 * 60000);
  var fymd = Utilities.formatDate(fk, 'Asia/Seoul', 'yyyyMMdd');
  var fhh = Utilities.formatDate(fk, 'Asia/Seoul', 'HH');
  var today = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyyMMdd');

  var tests = {
    ncst: { base_date: ymd, base_time: hh + '00', nx: '60', ny: '127' },
    fcst: { base_date: fymd, base_time: fhh + '30', nx: '60', ny: '127' },
    tour: { mapX: '126.9780', mapY: '37.5665', radius: '5000', numOfRows: '3' },
    festival: { eventStartDate: today, areaCode: '1', numOfRows: '3' },
    pharmacy: { WGS84_LON: '126.9780', WGS84_LAT: '37.5665', numOfRows: '3' },
    er: { WGS84_LON: '126.9780', WGS84_LAT: '37.5665', numOfRows: '3' },
    sun: { locdate: today, longitude: '126.98', latitude: '37.57' },
    drug: { itemName: '타이레놀', numOfRows: '1' }
  };

  Object.keys(tests).forEach(function (op) {
    var r = relay_(op, tests[op]);
    var count = countItems_(r);
    var line = '[' + op + '] ' + (r.ok ? '✅ ' : '❌ ') +
      (r.error ? r.error : (r.resultCode + ' ' + r.resultMsg + ' / 항목 ' + count + '개'));
    if (op === 'sun' && r.ok && count) {
      line += ' / 첫 항목 칸: ' + Object.keys(itemsOf_(r)[0]).join(', ');
    }
    if (!r.ok && r.raw) line += ' / ' + r.raw.substring(0, 150);
    Logger.log(line);
  });
}

function itemsOf_(r) {
  var b = r && r.response && r.response.body;
  if (!b || !b.items) return [];
  if (Array.isArray(b.items)) return b.items;
  var it = b.items.item;
  if (!it) return [];
  return Array.isArray(it) ? it : [it];
}

function countItems_(r) { return itemsOf_(r).length; }
