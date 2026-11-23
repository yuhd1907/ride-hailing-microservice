<#
.SYNOPSIS
    Kiểm thử giai đoạn 2 của Payment Service và Notification Service (Saga thanh toán,
    chống trùng, retry, dead-letter queue, dừng/khởi động lại service, phân quyền).

.DESCRIPTION
    Chạy từ thư mục gốc repo sau khi hệ thống đã healthy:
        powershell -ExecutionPolicy Bypass -File tests\phase2-payment-notification.ps1

    Event trip.completed / matching.driver_assigned / trip.compensated được giả lập bằng
    scripts\publish-event.ps1 (RabbitMQ Management API) vì Trip/Matching chưa publish.
    Kết quả ghi vào docs\evidence\phase2\: results.txt (bảng PASS/FAIL) và logs.txt (log theo
    correlationId của từng test).

    -SkipRestart bỏ qua hai test dừng/khởi động lại service (T10, T11).
#>
param(
    [string]$Gateway = 'http://127.0.0.1:8080',
    [string]$PaymentUrl = 'http://127.0.0.1:8085',
    [string]$NotificationUrl = 'http://127.0.0.1:8086',
    [string]$RabbitUrl = 'http://127.0.0.1:15672',
    [string]$EvidenceDir = 'docs/evidence/phase2',
    [switch]$SkipRestart
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
[System.Net.WebRequest]::DefaultWebProxy = New-Object System.Net.WebProxy

$Root = Split-Path $PSScriptRoot -Parent
Set-Location $Root
$Publish = Join-Path $Root 'scripts\publish-event.ps1'
New-Item -ItemType Directory -Force $EvidenceDir | Out-Null

# Dữ liệu mẫu trong scripts/seed-data.sql
$Rider1 = '26a7f8fe-79a8-49ea-a46a-9529e5c3e381'   # passenger1@ridehail.com
$Driver1 = 'fd699acc-6544-44a9-9634-5396060c61b8'
$SeedPassword = 'Password@123'

$Results = New-Object System.Collections.ArrayList
$LogLines = New-Object System.Collections.ArrayList

function Write-Line([string]$Text) {
    Write-Host $Text
    [void]$LogLines.Add($Text)
}

function Add-Result([string]$Id, [string]$Name, [bool]$Ok, [string]$Detail) {
    $status = if ($Ok) { 'PASS' } else { 'FAIL' }
    [void]$Results.Add([pscustomobject]@{ Test = $Id; Status = $status; Scenario = $Name; Detail = $Detail })
    $color = if ($Ok) { 'Green' } else { 'Red' }
    Write-Host ("[{0}] {1} {2} - {3}" -f $status, $Id, $Name, $Detail) -ForegroundColor $color
}

function Invoke-Compose([string]$Arguments) {
    return cmd /c "docker compose -f deploy/docker-compose.yml --env-file .env $Arguments 2>&1"
}

function Save-Logs([string]$TestId, [string]$CorrelationId, [string]$Services) {
    Write-Line ""
    Write-Line "===== $TestId (correlationId=$CorrelationId) ====="
    $lines = Invoke-Compose "logs --no-color --since 10m $Services" | Select-String -SimpleMatch $CorrelationId
    foreach ($line in $lines) {
        Write-Line $line.Line
    }
}

function Wait-Until([scriptblock]$Condition, [int]$TimeoutSec = 20) {
    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    do {
        try {
            if (& $Condition) {
                return $true
            }
        }
        catch {
        }
        Start-Sleep -Milliseconds 500
    } while ((Get-Date) -lt $deadline)
    return $false
}

function Get-StatusCode([string]$Url, [hashtable]$Headers = @{}) {
    try {
        return [int](Invoke-WebRequest -Uri $Url -Headers $Headers -UseBasicParsing).StatusCode
    }
    catch {
        if ($_.Exception.Response) {
            return [int]$_.Exception.Response.StatusCode
        }
        return -1
    }
}

# PowerShell 5 trả cả mảng JSON thành MỘT đối tượng; foreach tách ra từng phần tử để
# Where-Object lọc đúng. Luôn bọc kết quả trong @(...): PowerShell 5 không có .Count và [0]
# trên một PSCustomObject đơn lẻ.
function Get-Payments([string]$TripId) {
    $response = Invoke-RestMethod -Uri "$PaymentUrl/internal/payments?tripId=$TripId" -UseBasicParsing
    foreach ($item in $response) {
        $item
    }
}

function Get-Notifications([string]$TripId) {
    $response = Invoke-RestMethod -Uri "$NotificationUrl/internal/notifications?tripId=$TripId" -UseBasicParsing
    foreach ($item in $response) {
        $item
    }
}

function Get-PaymentDlqCount {
    return [int](Invoke-RestMethod -Uri "$PaymentUrl/internal/payments/dlq" -UseBasicParsing).messages
}

function Get-RabbitQueueDepth([string]$Queue) {
    $auth = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes('guest:guest'))
    $info = Invoke-RestMethod -Uri "$RabbitUrl/api/queues/%2F/$Queue" -Headers @{ Authorization = "Basic $auth" } -UseBasicParsing
    return [int]$info.messages
}

function Publish-TripCompleted([string]$TripId, [decimal]$Amount, [string]$CorrelationId, [string]$EventId) {
    $payload = @{ tripId = $TripId; riderId = $Rider1; driverId = $Driver1; fareAmount = $Amount;
        completedAt = (Get-Date).ToUniversalTime().ToString("yyyy-MM-dd'T'HH:mm:ss'Z'") }
    if (-not $EventId) {
        $EventId = [guid]::NewGuid().ToString()
    }
    return & $Publish -EventType 'trip.completed' -Payload $payload -CorrelationId $CorrelationId -EventId $EventId -RabbitUrl $RabbitUrl
}

function New-Id {
    return [guid]::NewGuid().ToString()
}

function Get-Token([string]$Email) {
    $body = @{ email = $Email; password = $SeedPassword } | ConvertTo-Json
    return (Invoke-RestMethod -Method Post -Uri "$Gateway/auth/login" -ContentType 'application/json' -Body $body -UseBasicParsing).token
}

Write-Line "Phase 2 test run: $((Get-Date).ToString('yyyy-MM-dd HH:mm:ss'))"
Invoke-RestMethod -Method Delete -Uri "$PaymentUrl/internal/payments/faults" -UseBasicParsing | Out-Null
Invoke-RestMethod -Method Delete -Uri "$NotificationUrl/internal/notifications/faults" -UseBasicParsing | Out-Null
Invoke-RestMethod -Method Delete -Uri "$PaymentUrl/internal/payments/dlq" -UseBasicParsing | Out-Null
Invoke-RestMethod -Method Delete -Uri "$NotificationUrl/internal/notifications/dlq" -UseBasicParsing | Out-Null
# Mỗi lần chạy trừ khoảng 1 triệu đ từ ngân hàng ảo của passenger1. Đặt số dư cố định 2.000.000 đ
# để chạy lại bao nhiêu lần cũng cho cùng kết quả: đủ cho các chuyến 80.000-125.000 đ, còn T2
# (5.000.000 đ) vẫn thất bại vì thiếu tiền.
Invoke-RestMethod -Method Put -Uri "$PaymentUrl/internal/payments/bank/accounts/$Rider1/balance?amount=2000000" -UseBasicParsing | Out-Null

# ---------------------------------------------------------------------------------------
# T1. Luồng thành công: trip.completed -> payment SUCCESS -> payment.succeeded -> thông báo
# ---------------------------------------------------------------------------------------
$t1Trip = New-Id; $t1Corr = "t1-$(New-Id)"
Publish-TripCompleted $t1Trip 125000 $t1Corr | Out-Null
$ok = Wait-Until { $p = @(Get-Payments $t1Trip); $p.Count -eq 1 -and $p[0].status -eq 'SUCCESS' }
$ok = $ok -and (Wait-Until { @(Get-Notifications $t1Trip | Where-Object { $_.type -eq 'PAYMENT_SUCCEEDED' }).Count -eq 1 })
$t1Payment = @(Get-Payments $t1Trip)[0]
Add-Result 'T1' 'Thanh toán thành công và gửi thông báo' $ok "paymentId=$($t1Payment.paymentId), status=$($t1Payment.status)"
Save-Logs 'T1' $t1Corr 'payment_service notification_service'

# ---------------------------------------------------------------------------------------
# T2. Nhánh thất bại của Saga: vượt hạn mức -> FAILED, payment.failed -> thông báo
# ---------------------------------------------------------------------------------------
$t2Trip = New-Id; $t2Corr = "t2-$(New-Id)"
Publish-TripCompleted $t2Trip 5000000 $t2Corr | Out-Null
$ok = Wait-Until { $p = @(Get-Payments $t2Trip); $p.Count -eq 1 -and $p[0].status -eq 'FAILED' -and $p[0].failureReason -eq 'INSUFFICIENT_FUNDS' }
$ok = $ok -and (Wait-Until { @(Get-Notifications $t2Trip | Where-Object { $_.type -eq 'PAYMENT_FAILED' }).Count -eq 1 })
Add-Result 'T2' 'Thanh toán thất bại phát payment.failed' $ok "status=$(@(Get-Payments $t2Trip)[0].status), reason=$(@(Get-Payments $t2Trip)[0].failureReason)"
Save-Logs 'T2' $t2Corr 'payment_service notification_service'

# ---------------------------------------------------------------------------------------
# T3. Deduplication: cùng eventId gửi 2 lần -> 1 payment, 1 thông báo
# ---------------------------------------------------------------------------------------
$t3Trip = New-Id; $t3Corr = "t3-$(New-Id)"; $t3Event = New-Id
Publish-TripCompleted $t3Trip 80000 $t3Corr $t3Event | Out-Null
Publish-TripCompleted $t3Trip 80000 $t3Corr $t3Event | Out-Null
Wait-Until { @(Get-Payments $t3Trip).Count -ge 1 } | Out-Null
Start-Sleep -Seconds 4
$payments = @(Get-Payments $t3Trip)
$notes = @(Get-Notifications $t3Trip | Where-Object { $_.type -eq 'PAYMENT_SUCCEEDED' })
Add-Result 'T3' 'Message trùng eventId chỉ xử lý một lần' ($payments.Count -eq 1 -and $notes.Count -eq 1) "payments=$($payments.Count), notifications=$($notes.Count)"
Save-Logs 'T3' $t3Corr 'payment_service notification_service'

# ---------------------------------------------------------------------------------------
# T4. Idempotency: cùng tripId, eventId khác -> không thu tiền lần hai
# ---------------------------------------------------------------------------------------
$t4Corr = "t4-$(New-Id)"
Publish-TripCompleted $t1Trip 125000 $t4Corr | Out-Null
Publish-TripCompleted $t1Trip 125000 $t4Corr | Out-Null
Start-Sleep -Seconds 4
$payments = @(Get-Payments $t1Trip)
Add-Result 'T4' 'Cùng chuyến, eventId khác không tạo payment mới' ($payments.Count -eq 1) "payments of trip T1=$($payments.Count)"
Save-Logs 'T4' $t4Corr 'payment_service'

# ---------------------------------------------------------------------------------------
# T5. Tương tranh: 10 event cùng tripId được 3 consumer xử lý song song -> đúng 1 payment
# ---------------------------------------------------------------------------------------
$t5Trip = New-Id; $t5Corr = "t5-$(New-Id)"
1..10 | ForEach-Object { Publish-TripCompleted $t5Trip 99000 $t5Corr | Out-Null }
Wait-Until { @(Get-Payments $t5Trip).Count -ge 1 } | Out-Null
Start-Sleep -Seconds 6
$payments = @(Get-Payments $t5Trip)
$notes = @(Get-Notifications $t5Trip | Where-Object { $_.type -eq 'PAYMENT_SUCCEEDED' })
Add-Result 'T5' '10 event đồng thời cho một chuyến chỉ thu tiền một lần' ($payments.Count -eq 1 -and $notes.Count -eq 1) "payments=$($payments.Count), notifications=$($notes.Count)"
Save-Logs 'T5' $t5Corr 'payment_service'

# ---------------------------------------------------------------------------------------
# T6. Retry: cổng thanh toán lỗi tạm thời 2 lần, lần thử thứ 3 thành công
# ---------------------------------------------------------------------------------------
$t6Trip = New-Id; $t6Corr = "t6-$(New-Id)"
Invoke-RestMethod -Method Post -Uri "$PaymentUrl/internal/payments/faults?failNext=2" -UseBasicParsing | Out-Null
$started = Get-Date
Publish-TripCompleted $t6Trip 150000 $t6Corr | Out-Null
$ok = Wait-Until { $p = @(Get-Payments $t6Trip); $p.Count -eq 1 -and $p[0].status -eq 'SUCCESS' } 30
$elapsed = [math]::Round(((Get-Date) - $started).TotalSeconds, 1)
$dlq = Get-PaymentDlqCount
Add-Result 'T6' 'Lỗi tạm thời được retry rồi thành công' ($ok -and $dlq -eq 0) "status=$(@(Get-Payments $t6Trip)[0].status), thoi gian=${elapsed}s, dlq=$dlq"
Save-Logs 'T6' $t6Corr 'payment_service'

# ---------------------------------------------------------------------------------------
# T7. Hết lượt retry -> DLQ; sửa lỗi rồi replay DLQ -> xử lý thành công
# ---------------------------------------------------------------------------------------
$t7Trip = New-Id; $t7Corr = "t7-$(New-Id)"
Invoke-RestMethod -Method Post -Uri "$PaymentUrl/internal/payments/faults?failNext=100" -UseBasicParsing | Out-Null
Publish-TripCompleted $t7Trip 175000 $t7Corr | Out-Null
$inDlq = Wait-Until { (Get-PaymentDlqCount) -eq 1 } 30
$noPayment = @(Get-Payments $t7Trip).Count -eq 0
Invoke-RestMethod -Method Delete -Uri "$PaymentUrl/internal/payments/faults" -UseBasicParsing | Out-Null
$replay = Invoke-RestMethod -Method Post -Uri "$PaymentUrl/internal/payments/dlq/replay" -UseBasicParsing
$recovered = Wait-Until { $p = @(Get-Payments $t7Trip); $p.Count -eq 1 -and $p[0].status -eq 'SUCCESS' } 20
Add-Result 'T7' 'Hết retry vào DLQ, replay sau khi hết lỗi thì xử lý được' ($inDlq -and $noPayment -and $recovered) "vao DLQ=$inDlq, chua thu tien=$noPayment, replayed=$($replay.replayed), sau replay=$recovered"
Save-Logs 'T7' $t7Corr 'payment_service'

# ---------------------------------------------------------------------------------------
# T8. Message sai định dạng vào DLQ ngay, không retry
# ---------------------------------------------------------------------------------------
$t8Corr = "t8-$(New-Id)"
$badBody = (@{ eventId = (New-Id); eventType = 'trip.completed'; correlationId = $t8Corr;
        payload = @{ tripId = (New-Id); riderId = $Rider1; driverId = $Driver1 } } | ConvertTo-Json -Compress)
& $Publish -EventType 'trip.completed' -RawBody $badBody -CorrelationId $t8Corr -RabbitUrl $RabbitUrl | Out-Null
$started = Get-Date
$ok = Wait-Until { (Get-PaymentDlqCount) -eq 1 } 10
$elapsed = [math]::Round(((Get-Date) - $started).TotalSeconds, 1)
Invoke-RestMethod -Method Delete -Uri "$PaymentUrl/internal/payments/dlq" -UseBasicParsing | Out-Null
Add-Result 'T8' 'Message thiếu fareAmount vào DLQ ngay, không retry' ($ok -and $elapsed -lt 3) "vao DLQ sau ${elapsed}s"
Save-Logs 'T8' $t8Corr 'payment_service'

# ---------------------------------------------------------------------------------------
# T9. Notification lỗi tạm thời 2 lần vẫn gửi được thông báo nhờ retry
# ---------------------------------------------------------------------------------------
$t9Trip = New-Id; $t9Corr = "t9-$(New-Id)"
Invoke-RestMethod -Method Post -Uri "$NotificationUrl/internal/notifications/faults?failNext=2" -UseBasicParsing | Out-Null
Publish-TripCompleted $t9Trip 60000 $t9Corr | Out-Null
$ok = Wait-Until { @(Get-Notifications $t9Trip | Where-Object { $_.type -eq 'PAYMENT_SUCCEEDED' }).Count -eq 1 } 30
Invoke-RestMethod -Method Delete -Uri "$NotificationUrl/internal/notifications/faults" -UseBasicParsing | Out-Null
Add-Result 'T9' 'Notification retry khi kênh gửi lỗi tạm thời' $ok "notifications=$(@(Get-Notifications $t9Trip).Count)"
Save-Logs 'T9' $t9Corr 'notification_service'

# ---------------------------------------------------------------------------------------
# T10, T11. Dừng service giữa luồng nghiệp vụ, message chờ trong queue, khởi động lại thì xử lý tiếp
# ---------------------------------------------------------------------------------------
if (-not $SkipRestart) {
    $t10Trip = New-Id; $t10Corr = "t10-$(New-Id)"
    Invoke-Compose 'stop payment_service' | Out-Null
    Publish-TripCompleted $t10Trip 210000 $t10Corr | Out-Null
    $queued = Wait-Until { (Get-RabbitQueueDepth 'payment-service.trip.completed') -ge 1 } 15
    $started = Get-Date
    Invoke-Compose 'start payment_service' | Out-Null
    $ok = Wait-Until { $p = @(Get-Payments $t10Trip); $p.Count -eq 1 -and $p[0].status -eq 'SUCCESS' } 120
    $recovery = [math]::Round(((Get-Date) - $started).TotalSeconds, 1)
    Add-Result 'T10' 'Payment dừng: event chờ trong queue, chạy lại thì xử lý tiếp' ($queued -and $ok) "message cho trong queue=$queued, xu ly sau khi start ${recovery}s"
    Save-Logs 'T10' $t10Corr 'payment_service'

    $t11Trip = New-Id; $t11Corr = "t11-$(New-Id)"
    Invoke-Compose 'stop notification_service' | Out-Null
    Publish-TripCompleted $t11Trip 95000 $t11Corr | Out-Null
    $paid = Wait-Until { $p = @(Get-Payments $t11Trip); $p.Count -eq 1 -and $p[0].status -eq 'SUCCESS' } 20
    $queued = Wait-Until { (Get-RabbitQueueDepth 'notification-service.payment.succeeded') -ge 1 } 15
    $started = Get-Date
    Invoke-Compose 'start notification_service' | Out-Null
    $ok = Wait-Until { @(Get-Notifications $t11Trip | Where-Object { $_.type -eq 'PAYMENT_SUCCEEDED' }).Count -eq 1 } 120
    $recovery = [math]::Round(((Get-Date) - $started).TotalSeconds, 1)
    Add-Result 'T11' 'Notification dừng không chặn thanh toán, chạy lại thì gửi bù' ($paid -and $queued -and $ok) "da thanh toan=$paid, payment.succeeded cho trong queue=$queued, gui sau khi start ${recovery}s"
    Save-Logs 'T11' $t11Corr 'payment_service notification_service'
}

# ---------------------------------------------------------------------------------------
# T12. Các event còn lại của luồng: driver_assigned và trip.compensated
# ---------------------------------------------------------------------------------------
$t12Trip = New-Id; $t12Corr = "t12-$(New-Id)"
& $Publish -EventType 'matching.driver_assigned' -CorrelationId $t12Corr -RabbitUrl $RabbitUrl -Payload @{
    tripId = $t12Trip; riderId = $Rider1; driverId = $Driver1
    assignedAt = (Get-Date).ToUniversalTime().ToString("yyyy-MM-dd'T'HH:mm:ss'Z'") } | Out-Null
& $Publish -EventType 'trip.compensated' -CorrelationId $t12Corr -RabbitUrl $RabbitUrl -Payload @{
    tripId = $t12Trip; riderId = $Rider1; driverId = $Driver1; reason = 'INSUFFICIENT_FUNDS'
    compensatedAt = (Get-Date).ToUniversalTime().ToString("yyyy-MM-dd'T'HH:mm:ss'Z'") } | Out-Null
$ok = Wait-Until { @(Get-Notifications $t12Trip).Count -eq 4 } 20
$notes = @(Get-Notifications $t12Trip)
$roles = ($notes | ForEach-Object { "$($_.type)/$($_.recipientRole)" }) -join ', '
Add-Result 'T12' 'driver_assigned và trip.compensated báo cho khách và tài xế' $ok "$($notes.Count) thong bao: $roles"
Save-Logs 'T12' $t12Corr 'notification_service'

# ---------------------------------------------------------------------------------------
# T13. Bảo mật: thiếu token, xem payment của người khác, ID sai định dạng
# ---------------------------------------------------------------------------------------
try {
    $token1 = Get-Token 'passenger1@ridehail.com'
    $token2 = Get-Token 'passenger2@ridehail.com'
    $h1 = @{ Authorization = "Bearer $token1" }
    $h2 = @{ Authorization = "Bearer $token2" }
    # Payment (T10) và Notification (T11) vừa khởi động lại: Gateway giữ danh sách instance cũ tới ~35s,
    # nên chờ 3 lần gọi liên tiếp đều 200 rồi mới kiểm tra phân quyền.
    $streak = 0
    Wait-Until { if ((Get-StatusCode "$Gateway/payments/me" $h1) -eq 200) { $script:streak++ } else { $script:streak = 0 }; $script:streak -ge 3 } 120 | Out-Null
    $streak = 0
    Wait-Until { if ((Get-StatusCode "$Gateway/notifications/me" $h1) -eq 200) { $script:streak++ } else { $script:streak = 0 }; $script:streak -ge 3 } 120 | Out-Null
    $noToken = Get-StatusCode "$Gateway/payments/me"
    $own = Get-StatusCode "$Gateway/payments/$($t1Payment.paymentId)" $h1
    $other = Get-StatusCode "$Gateway/payments/$($t1Payment.paymentId)" $h2
    $badId = Get-StatusCode "$Gateway/payments/khong-phai-uuid" $h1
    $myNotes = Get-StatusCode "$Gateway/notifications/me" $h1
    $ok = ($noToken -eq 401) -and ($own -eq 200) -and ($other -eq 403) -and ($badId -eq 400) -and ($myNotes -eq 200)
    Add-Result 'T13' 'Phân quyền khi xem payment/thông báo' $ok "khong token=$noToken, chu so huu=$own, nguoi khac=$other, id sai=$badId, /notifications/me=$myNotes"
}
catch {
    Add-Result 'T13' 'Phân quyền khi xem payment/thông báo' $false "khong dang nhap duoc qua Gateway: $($_.Exception.Message)"
}

# ---------------------------------------------------------------------------------------
$table = $Results | Format-Table -AutoSize -Wrap | Out-String -Width 220
$passed = @($Results | Where-Object { $_.Status -eq 'PASS' }).Count
$summary = "Tong ket: $passed/$($Results.Count) PASS"
Write-Host $table
Write-Host $summary
($table + "`r`n" + $summary) | Out-File -Encoding utf8 (Join-Path $EvidenceDir 'results.txt')
$LogLines | Out-File -Encoding utf8 (Join-Path $EvidenceDir 'logs.txt')
Write-Host "Da ghi $EvidenceDir\results.txt va $EvidenceDir\logs.txt"
