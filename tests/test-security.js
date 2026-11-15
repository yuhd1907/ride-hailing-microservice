// Scenario: Kiểm thử bảo mật (RBAC, Ownership, Validation, JWT Blacklist sau Logout)
// Run: node tests/test-security.js

const GATEWAY_URL = process.env.GATEWAY_URL || 'http://localhost:8080';
const DRIVER1_ID = 'fd699acc-6544-44a9-9634-5396060c61b8';
const DRIVER2_ID = '5e11b65c-36ef-47cd-9019-9db767cf8d01';
const PASSENGER1_ID = '26a7f8fe-79a8-49ea-a46a-9529e5c3e381';

async function request(method, path, token, body) {
  const headers = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (body !== undefined && body !== null) headers['Content-Type'] = 'application/json';

  const res = await fetch(`${GATEWAY_URL}${path}`, {
    method,
    headers,
    body: body !== undefined && body !== null ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, body: json || text };
}

async function runSecurityTest() {
  console.log('--- BẮT ĐẦU TEST BẢO MẬT (GATEWAY + USER SERVICE + DRIVER SERVICE) ---');
  const results = [];

  function check(name, actualStatus, expectedStatus, detail) {
    const passed = actualStatus === expectedStatus;
    results.push({
      testCase: name,
      expected: expectedStatus,
      actual: actualStatus,
      result: passed ? 'PASS' : 'FAIL',
      detail,
    });
    if (!passed) {
      throw new Error(`Thất bại ở test case [${name}]: kỳ vọng ${expectedStatus}, nhận được ${actualStatus} (${detail})`);
    }
  }

  // 1. Đăng nhập tài khoản Hành khách (passenger1) và Tài xế (driver1)
  const passengerLogin = await request('POST', '/auth/login', null, {
    email: 'passenger1@ridehail.com',
    password: 'Password@123',
  });
  check('1. Đăng nhập passenger1@ridehail.com', passengerLogin.status, 200, 'Nhận JWT với ROLE_PASSENGER');
  const passengerToken = passengerLogin.body.token;

  const driverLogin = await request('POST', '/auth/login', null, {
    email: 'driver1@ridehail.com',
    password: 'Password@123',
  });
  check('2. Đăng nhập driver1@ridehail.com', driverLogin.status, 200, 'Nhận JWT với ROLE_DRIVER');
  const driverToken = driverLogin.body.token;

  // 2. Hành khách KHÔNG bật được trạng thái tài xế & không tạo được hồ sơ tài xế
  const passengerGoOnline = await request('POST', `/drivers/${DRIVER1_ID}/go-online`, passengerToken);
  check(
    '3. Hành khách bật trạng thái nhận chuyến (POST /drivers/{id}/go-online)',
    passengerGoOnline.status,
    403,
    passengerGoOnline.body?.message || 'Forbidden'
  );

  const passengerGoOnlineMe = await request('POST', '/drivers/me/go-online', passengerToken);
  check(
    '4. Hành khách bật trạng thái qua /drivers/me/go-online',
    passengerGoOnlineMe.status,
    403,
    passengerGoOnlineMe.body?.message || 'Forbidden'
  );

  const passengerCreateDriver = await request('POST', '/drivers', passengerToken, {
    licensePlate: '29A-99999',
    vehicleType: 'MOTORCYCLE',
  });
  check(
    '5. Hành khách tạo hồ sơ tài xế (POST /drivers)',
    passengerCreateDriver.status,
    403,
    passengerCreateDriver.body?.message || 'Forbidden'
  );

  // 3. Tài xế KHÔNG sửa được tài xế khác; Người dùng KHÔNG sửa được hồ sơ người khác
  const driverModifyOtherStatus = await request('POST', `/drivers/${DRIVER2_ID}/go-online`, driverToken);
  check(
    '6. Tài xế 1 bật nhận chuyến của Tài xế 2 (POST /drivers/{otherId}/go-online)',
    driverModifyOtherStatus.status,
    403,
    driverModifyOtherStatus.body?.message || 'Forbidden'
  );

  const driverModifyOtherLocation = await request('POST', `/drivers/${DRIVER2_ID}/location`, driverToken, {
    latitude: 21.0285,
    longitude: 105.8542,
  });
  check(
    '7. Tài xế 1 cập nhật vị trí của Tài xế 2 (POST /drivers/{otherId}/location)',
    driverModifyOtherLocation.status,
    403,
    driverModifyOtherLocation.body?.message || 'Forbidden'
  );

  const userModifyOtherProfile = await request('PUT', `/users/${PASSENGER1_ID}`, driverToken, {
    fullName: 'Tên bị sửa trái phép',
  });
  check(
    '8. Người dùng sửa hồ sơ người dùng khác (PUT /users/{otherId})',
    userModifyOtherProfile.status,
    403,
    userModifyOtherProfile.body?.message || 'Forbidden'
  );

  // 4. Dữ liệu sai bị từ chối (400 Bad Request)
  const invalidLatitude = await request('POST', `/drivers/${DRIVER1_ID}/location`, driverToken, {
    latitude: 95.0,
    longitude: 105.8542,
  });
  check(
    '9. Tọa độ vĩ độ không hợp lệ (latitude = 95.0 > 90)',
    invalidLatitude.status,
    400,
    invalidLatitude.body?.message || 'Bad Request'
  );

  const invalidLongitude = await request('POST', `/drivers/${DRIVER1_ID}/location`, driverToken, {
    latitude: 21.0285,
    longitude: -195.0,
  });
  check(
    '10. Tọa độ kinh độ không hợp lệ (longitude = -195.0 < -180)',
    invalidLongitude.status,
    400,
    invalidLongitude.body?.message || 'Bad Request'
  );

  const invalidUuid = await request('GET', '/drivers/not-a-valid-uuid', driverToken);
  check(
    '11. UUID tài xế sai định dạng (GET /drivers/not-a-valid-uuid)',
    invalidUuid.status,
    400,
    invalidUuid.body?.message || 'Bad Request'
  );

  const invalidProfilePayload = await request('POST', '/drivers', driverToken, {
    licensePlate: '',
    vehicleType: 'INVALID_VEHICLE',
  });
  check(
    '12. Dữ liệu tạo hồ sơ tài xế sai định dạng (biển số rỗng / loại xe sai)',
    invalidProfilePayload.status,
    400,
    invalidProfilePayload.body?.message || 'Bad Request'
  );

  // 5. Token đã đăng xuất không dùng được (401 Unauthorized)
  const beforeLogout = await request('GET', '/users/me', passengerToken);
  check('13. Trước khi đăng xuất: GET /users/me hoạt động bình thường', beforeLogout.status, 200, 'OK');

  const logoutRes = await request('POST', '/auth/logout', passengerToken);
  check('14. Đăng xuất token (POST /auth/logout)', logoutRes.status, 200, logoutRes.body?.message || 'Logged out');

  const afterLogoutUserMe = await request('GET', '/users/me', passengerToken);
  check(
    '15. Sau khi đăng xuất: dùng lại token gọi GET /users/me bị từ chối',
    afterLogoutUserMe.status,
    401,
    'Token nằm trong Redis Blacklist -> Gateway chặn 401 Unauthorized'
  );

  const afterLogoutDriverMe = await request('GET', '/drivers/me', passengerToken);
  check(
    '16. Sau khi đăng xuất: dùng lại token gọi GET /drivers/me bị từ chối',
    afterLogoutDriverMe.status,
    401,
    'Token nằm trong Redis Blacklist -> Gateway chặn 401 Unauthorized'
  );

  console.table(results);
  console.log('\nKẾT LUẬN: TẤT CẢ 16 KỊCH BẢN BẢO MẬT ĐỀU THÀNH CÔNG (PASS)!');
}

runSecurityTest().catch((error) => {
  console.error('\nKẾT LUẬN: THẤT BẠI -', error.message);
  process.exit(1);
});

