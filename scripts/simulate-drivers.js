'use strict';
// Tạo tài xế ảo quanh một vị trí và giữ họ trực tuyến để thử chức năng đặt xe.
//
//   node scripts/simulate-drivers.js --address "96A Trần Phú, Hà Đông"        (cần Google Maps key trong frontend/.env.local)
//   node scripts/simulate-drivers.js --lat 20.9809 --lng 105.7875 --count 6 --radius 2
//
// Mỗi tài xế: đăng ký tài khoản (sim-driver-N@rideflow.test, mật khẩu Password@123), khai báo xe,
// gửi vị trí ngẫu nhiên trong bán kính, bật nhận cuốc. Sau đó script giả lập GPS: mỗi 60 giây
// mỗi tài xế di chuyển nhẹ và gửi lại vị trí (Driver Service bỏ vị trí cũ hơn 300 giây).
// Ctrl+C: tắt nhận cuốc cho tất cả tài xế ảo rồi thoát. Chạy lại dùng lại đúng các tài khoản cũ.
const fs = require('node:fs');
const path = require('node:path');

const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, arg, i, all) => (arg.startsWith('--') ? [...pairs, [arg.slice(2), all[i + 1]?.startsWith('--') ? 'true' : all[i + 1] ?? 'true']] : pairs), []),
);
const GATEWAY = (args.gateway || `http://127.0.0.1:${process.env.GATEWAY_PORT || 8080}`).replace(/\/$/, '');
const COUNT = Math.min(Math.max(Number(args.count) || 5, 1), 20);
const RADIUS_KM = Math.min(Math.max(Number(args.radius) || 1.5, 0.1), 5);
const PASSWORD = 'Password@123';
const HEARTBEAT_MS = 60_000;
const sleep = ms => new Promise(r => setTimeout(r, ms));

const NAMES = ['Nguyễn Văn Hùng', 'Trần Quốc Bảo', 'Lê Minh Tuấn', 'Phạm Đức Long', 'Hoàng Văn Nam', 'Vũ Thành Công', 'Đặng Hữu Phước', 'Bùi Anh Khoa', 'Đỗ Mạnh Cường', 'Ngô Gia Huy', 'Dương Văn Sơn', 'Lý Quang Vinh', 'Mai Xuân Trường', 'Trịnh Đình Khải', 'Phan Văn Tài', 'Hồ Sỹ Thắng', 'Tạ Minh Hiếu', 'Lương Văn Đạt', 'Chu Văn Lâm', 'Kiều Anh Tú'];
const VEHICLES = ['MOTORCYCLE', 'MOTORCYCLE', 'CAR_4_SEAT', 'MOTORCYCLE', 'CAR_7_SEAT'];

// Thử lại khi Gateway báo service tạm quá tải (502/503/504) hoặc lỗi mạng; tối đa 4 lần.
async function call(url, { method = 'GET', body, token } = {}) {
  let last;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const response = await fetch(GATEWAY + url, {
        method,
        signal: AbortSignal.timeout(15000),
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      const text = await response.text();
      let data;
      try { data = JSON.parse(text); } catch { data = text; }
      last = { status: response.status, data };
      if (![502, 503, 504].includes(response.status)) return last;
    } catch (error) {
      last = { status: 0, data: String(error) };
    }
    await sleep(2000 * attempt);
  }
  return last;
}

function googleKey() {
  try {
    const env = fs.readFileSync(path.join(__dirname, '../frontend/.env.local'), 'utf8');
    return env.match(/^NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=(.+)$/m)?.[1]?.trim() || null;
  } catch { return null; }
}

async function geocode(address) {
  const key = googleKey();
  if (!key) throw new Error('Cần NEXT_PUBLIC_GOOGLE_MAPS_API_KEY trong frontend/.env.local để dùng --address; hoặc truyền --lat và --lng.');
  const url = `https://maps.googleapis.com/maps/api/geocode/json?language=vi&region=vn&address=${encodeURIComponent(address)}&key=${key}`;
  // Key bị giới hạn theo trang web nên gửi kèm Referer của web đặt xe.
  const data = await (await fetch(url, { headers: { Referer: 'http://localhost:3001/' } })).json();
  const hit = data.results?.[0];
  if (!hit) throw new Error(`Không tìm thấy địa chỉ "${address}" (${data.status}${data.error_message ? `: ${data.error_message}` : ''})`);
  return { lat: hit.geometry.location.lat, lng: hit.geometry.location.lng, label: hit.formatted_address };
}

// Điểm ngẫu nhiên phân bố đều trong hình tròn bán kính r km quanh tâm.
function randomAround(center, km) {
  const r = km * Math.sqrt(Math.random()), angle = Math.random() * 2 * Math.PI;
  return {
    lat: Number((center.lat + (r / 111.32) * Math.cos(angle)).toFixed(6)),
    lng: Number((center.lng + (r / (111.32 * Math.cos((center.lat * Math.PI) / 180))) * Math.sin(angle)).toFixed(6)),
  };
}

const km = (a, b) => {
  const rad = d => (d * Math.PI) / 180;
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
};

async function login(driver) {
  const r = await call('/auth/login', { method: 'POST', body: { email: driver.email, password: PASSWORD } });
  if (r.status !== 200) throw new Error(`Đăng nhập ${driver.email} lỗi ${r.status}: ${JSON.stringify(r.data)}`);
  driver.token = r.data.token;
}

async function authed(driver, url, options = {}) {
  let r = await call(url, { ...options, token: driver.token });
  if (r.status === 401) { await login(driver); r = await call(url, { ...options, token: driver.token }); }
  return r;
}

async function sendLocation(driver) {
  const r = await authed(driver, '/drivers/me/location', { method: 'POST', body: { latitude: driver.position.lat, longitude: driver.position.lng } });
  if (r.status !== 200) throw new Error(`Gửi vị trí ${driver.email} lỗi ${r.status}`);
}

async function prepare(i, center) {
  const driver = {
    email: `sim-driver-${i}@rideflow.test`,
    fullName: NAMES[(i - 1) % NAMES.length],
    phone: `0388${String(100000 + i).slice(-6)}`,
    vehicleType: VEHICLES[(i - 1) % VEHICLES.length],
    licensePlate: `29${String.fromCharCode(65 + ((i - 1) % 26))}-${String(10000 + i * 137).slice(-5)}`,
    position: randomAround(center, RADIUS_KM),
  };
  const reg = await call('/auth/register', { method: 'POST', body: { email: driver.email, password: PASSWORD, fullName: driver.fullName, phone: driver.phone, role: 'ROLE_DRIVER' } });
  if (![200, 201, 400, 409].includes(reg.status)) throw new Error(`Đăng ký ${driver.email} lỗi ${reg.status}: ${JSON.stringify(reg.data)}`);
  await login(driver);
  let profile = await authed(driver, '/drivers/me');
  if (profile.status === 404) {
    const created = await authed(driver, '/drivers', { method: 'POST', body: { licensePlate: driver.licensePlate, vehicleType: driver.vehicleType } });
    // 409: lần gọi trước đã tạo xong nhưng phản hồi bị timeout — hồ sơ đã có, dùng tiếp.
    if (![201, 409].includes(created.status)) throw new Error(`Tạo hồ sơ ${driver.email} lỗi ${created.status}: ${JSON.stringify(created.data)}`);
    profile = await authed(driver, '/drivers/me');
  }
  driver.id = profile.data.id;
  driver.vehicleType = profile.data.vehicleType;
  driver.licensePlate = profile.data.licensePlate;
  // Vị trí trước, bật nhận cuốc sau: giống app tài xế, để có ngay trong chỉ mục tìm kiếm.
  await sendLocation(driver);
  if (profile.data.status === 'OFFLINE') {
    const online = await authed(driver, '/drivers/me/go-online', { method: 'POST' });
    if (online.status !== 200) throw new Error(`Bật nhận cuốc ${driver.email} lỗi ${online.status}`);
  }
  driver.status = (await authed(driver, '/drivers/me')).data.status;
  return driver;
}

async function main() {
  let center;
  if (args.address) center = await geocode(args.address);
  else if (args.lat && args.lng) center = { lat: Number(args.lat), lng: Number(args.lng), label: `${args.lat}, ${args.lng}` };
  else throw new Error('Thiếu vị trí. Dùng --address "<địa chỉ>" hoặc --lat <vĩ độ> --lng <kinh độ>.');
  if (!Number.isFinite(center.lat) || !Number.isFinite(center.lng)) throw new Error('Tọa độ không hợp lệ.');

  console.log(`Tâm: ${center.label} (${center.lat.toFixed(6)}, ${center.lng.toFixed(6)}) · ${COUNT} tài xế trong ${RADIUS_KM} km`);
  const drivers = [];
  for (let i = 1; i <= COUNT; i++) {
    drivers.push(await prepare(i, center));
    await sleep(150); // tránh chạm rate limit của Gateway
  }
  console.table(drivers.map(d => ({ email: d.email, 'họ tên': d.fullName, xe: d.vehicleType, 'biển số': d.licensePlate, 'cách tâm (km)': km(center, d.position).toFixed(2), 'trạng thái': d.status })));

  const visible = (await call(`/drivers/available?lat=${center.lat}&lng=${center.lng}&radius=${Math.max(RADIUS_KM, 1)}`)).data;
  console.log(`Khách đặt xe tại tâm sẽ thấy ${Array.isArray(visible) ? visible.length : '?'} tài xế sẵn sàng.`);
  console.log(`Mật khẩu chung: ${PASSWORD}. Đang giả lập GPS (gửi vị trí mỗi ${HEARTBEAT_MS / 1000} giây) — Ctrl+C để tắt tất cả.`);

  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    console.log('\nĐang tắt nhận cuốc cho tài xế ảo…');
    for (const d of drivers) {
      const r = await authed(d, '/drivers/me/go-offline', { method: 'POST' }).catch(() => null);
      console.log(`  ${d.email}: ${r?.status === 200 ? 'OFFLINE' : `giữ nguyên (đang có cuốc hoặc lỗi ${r?.status ?? 'mạng'})`}`);
    }
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);

  if (args.once === 'true') return console.log('--once: không giả lập GPS; tài xế sẽ rơi khỏi tìm kiếm sau khoảng 5 phút.');
  for (;;) {
    await sleep(HEARTBEAT_MS);
    for (const d of drivers) {
      // Di chuyển nhẹ (tối đa ~80 m) nhưng không ra khỏi vùng quanh tâm.
      const next = randomAround(d.position, 0.08);
      if (km(center, next) <= RADIUS_KM) d.position = next;
      await sendLocation(d).catch(e => console.log(`  ${d.email}: ${e.message}`));
    }
    const states = await Promise.all(drivers.map(d => authed(d, '/drivers/me').then(r => r.data?.status).catch(() => '?')));
    console.log(`${new Date().toLocaleTimeString('vi-VN')} cập nhật GPS · ${states.map((s, i) => `#${i + 1}:${s}`).join(' ')}`);
  }
}

main().catch(error => {
  console.error(error.message);
  process.exit(1);
});
