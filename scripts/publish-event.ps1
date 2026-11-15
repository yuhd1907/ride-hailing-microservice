<#
.SYNOPSIS
    Publish một event lên exchange rideflow.events qua RabbitMQ Management API.

.DESCRIPTION
    Dùng để kiểm thử Payment/Notification khi Trip/Matching chưa publish event thật.
    Envelope theo docs/event-schema.md: eventId, eventType, correlationId, occurredAt, payload.
    Truyền lại cùng -EventId để giả lập RabbitMQ giao trùng message.

.EXAMPLE
    .\scripts\publish-event.ps1 -EventType trip.completed -Payload @{
        tripId = [guid]::NewGuid().ToString()
        riderId = '26a7f8fe-79a8-49ea-a46a-9529e5c3e381'
        driverId = 'fd699acc-6544-44a9-9634-5396060c61b8'
        fareAmount = 125000
    }
#>
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('trip.completed', 'matching.driver_assigned', 'payment.succeeded', 'payment.failed', 'trip.compensated')]
    [string]$EventType,

    [hashtable]$Payload,

    [string]$EventId = ([guid]::NewGuid().ToString()),

    [string]$CorrelationId = ([guid]::NewGuid().ToString()),

    [string]$RabbitUrl = 'http://127.0.0.1:15672',

    [string]$User = 'guest',

    [string]$Password = 'guest',

    # Gửi body tùy ý (không bọc envelope), dùng để thử message sai định dạng
    [string]$RawBody
)

$ErrorActionPreference = 'Stop'

if ($RawBody) {
    $body = $RawBody
}
elseif (-not $Payload) {
    throw 'Can truyen -Payload (hashtable) hoac -RawBody'
}
else {
    $envelope = [ordered]@{
        eventId       = $EventId
        eventType     = $EventType
        correlationId = $CorrelationId
        occurredAt    = (Get-Date).ToUniversalTime().ToString("yyyy-MM-dd'T'HH:mm:ss'Z'")
        payload       = $Payload
    }
    $body = $envelope | ConvertTo-Json -Depth 10 -Compress
}

$request = [ordered]@{
    properties       = @{
        content_type   = 'application/json'
        delivery_mode  = 2
        message_id     = $EventId
        correlation_id = $CorrelationId
        type           = $EventType
        headers        = @{ 'x-correlation-id' = $CorrelationId }
    }
    routing_key      = $EventType
    payload          = $body
    payload_encoding = 'string'
}
$json = $request | ConvertTo-Json -Depth 10 -Compress
$auth = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes("${User}:${Password}"))
$uri = "$RabbitUrl/api/exchanges/%2F/rideflow.events/publish"

$result = Invoke-RestMethod -Method Post -Uri $uri -Headers @{ Authorization = "Basic $auth" } `
    -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($json))

[pscustomobject]@{
    EventType     = $EventType
    EventId       = $EventId
    CorrelationId = $CorrelationId
    Routed        = $result.routed
}
