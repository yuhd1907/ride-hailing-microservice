param(
    [Parameter(Mandatory=$true)][string]$EventType,
    [hashtable]$Payload = @{},
    [string]$EventId = [guid]::NewGuid().ToString(),
    [string]$CorrelationId = [guid]::NewGuid().ToString(),
    [string]$RawBody,
    [string]$ManagementUrl = 'http://127.0.0.1:15672',
    [PSCredential]$Credential
)
$ErrorActionPreference = 'Stop'
if (-not $Credential) {
    $rabbitUser = if ($env:RABBITMQ_DEFAULT_USER) { $env:RABBITMQ_DEFAULT_USER } else { 'guest' }
    $rabbitPass = if ($env:RABBITMQ_DEFAULT_PASS) { $env:RABBITMQ_DEFAULT_PASS } else { 'guest' }
    $Credential = New-Object PSCredential($rabbitUser, (ConvertTo-SecureString $rabbitPass -AsPlainText -Force))
}
$plain = $Credential.GetNetworkCredential()
$auth = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($plain.UserName + ':' + $plain.Password))
$content = if ($PSBoundParameters.ContainsKey('RawBody')) { $RawBody } else {
    @{eventId=$EventId; eventType=$EventType; correlationId=$CorrelationId; occurredAt=(Get-Date).ToUniversalTime().ToString('o'); payload=$Payload} | ConvertTo-Json -Depth 20 -Compress
}
$body = @{properties=@{delivery_mode=2;content_type='application/json';message_id=$EventId;type=$EventType;correlation_id=$CorrelationId;headers=@{'x-correlation-id'=$CorrelationId}};routing_key=$EventType;payload=$content;payload_encoding='string'} | ConvertTo-Json -Depth 25 -Compress
$result = Invoke-RestMethod -Method Post -Uri "$ManagementUrl/api/exchanges/%2F/rideflow.events/publish" -Headers @{Authorization="Basic $auth"} -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($body))
if (-not $result.routed) { throw 'No queue matched this routing key. Start consumers first.' }
[PSCustomObject]@{eventId=$EventId;correlationId=$CorrelationId;routed=$result.routed}
